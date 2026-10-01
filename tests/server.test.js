import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {createStaticServer} from '../server.mjs';

async function withServer(run){
 const server=createStaticServer();
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 const address=server.address();
 const base=`http://127.0.0.1:${address.port}`;
 try{await run(base);}
 finally{await new Promise(resolve=>server.close(resolve));}
}

function waitForDevServer(child){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const chunks=[];
  const timer=setTimeout(()=>{
   if(!settled){
    settled=true;
    reject(new Error(`dev server did not start. stdout: ${chunks.join('')}`));
   }
  },5000);
  child.stdout.on('data',chunk=>{
   const text=chunk.toString('utf8');
   chunks.push(text);
   const match=chunks.join('').match(/http:\/\/127\.0\.0\.1:(\d+)/);
   if(match&&!settled){
    settled=true;
    clearTimeout(timer);
    resolve(`http://127.0.0.1:${match[1]}`);
   }
  });
  child.once('exit',(code,signal)=>{
   if(!settled){
    settled=true;
    clearTimeout(timer);
    reject(new Error(`dev server exited before listening: code ${code}, signal ${signal}`));
   }
  });
  child.once('error',error=>{
   if(!settled){
    settled=true;
    clearTimeout(timer);
    reject(error);
   }
  });
 });
}

async function stopChild(child){
 if(child.exitCode!==null)return;
 if(process.platform==='win32')child.kill('SIGTERM');
 else{
  try{process.kill(-child.pid,'SIGTERM');}
  catch(error){if(error.code!=='ESRCH')throw error;}
 }
 await Promise.race([
  once(child,'exit'),
  new Promise(resolve=>setTimeout(resolve,1500))
 ]);
 if(child.exitCode===null){
  if(process.platform==='win32')child.kill('SIGKILL');
  else{
   try{process.kill(-child.pid,'SIGKILL');}
   catch(error){if(error.code!=='ESRCH')throw error;}
  }
 }
}

function rawStatus(base,requestPath){
 const url=new URL(base);
 return new Promise((resolve,reject)=>{
  const socket=connect(Number(url.port),url.hostname,()=>{
   socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`);
  });
  let response='';
  socket.setEncoding('utf8');
  socket.on('data',chunk=>{response+=chunk;});
  socket.on('end',()=>{
   const match=response.match(/^HTTP\/1\.1 (\d{3})/);
   if(!match)reject(new Error(`No HTTP status in response: ${response.slice(0,80)}`));
   else resolve(Number(match[1]));
  });
  socket.on('error',reject);
 });
}

test('정적 서버는 index와 정확한 MIME, 개발용 no-store 캐시를 제공한다',async()=>{
 await withServer(async base=>{
  const index=await fetch(`${base}/`);
  assert.equal(index.status,200);
  assert.match(index.headers.get('content-type'),/text\/html/);
  assert.equal(index.headers.get('cache-control'),'no-store');
  assert.match(await index.text(),/운산 연결지도/);

  const script=await fetch(`${base}/engine.js`);
  assert.equal(script.status,200);
  assert.match(script.headers.get('content-type'),/text\/javascript/);
 });
});

test('HEAD 요청은 본문 없이 파일 헤더만 돌려준다',async()=>{
 await withServer(async base=>{
  const res=await fetch(`${base}/styles.css`,{method:'HEAD'});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('cache-control'),'no-store');
  assert.equal(await res.text(),'');
 });
});

test('정적 서버는 없는 파일과 허용하지 않는 메서드를 명확히 거부한다',async()=>{
 await withServer(async base=>{
  assert.equal((await fetch(`${base}/missing.js`)).status,404);
  const post=await fetch(`${base}/`,{method:'POST'});
  assert.equal(post.status,405);
  assert.equal(post.headers.get('allow'),'GET, HEAD');
 });
});

test('정적 서버는 잘못된 인코딩과 경로 이탈 시도를 차단한다',async()=>{
 await withServer(async base=>{
  assert.equal((await fetch(`${base}/%E0%A4%A`)).status,400);
  assert.equal(await rawStatus(base,'/%2e%2e/package.json'),400);
 });
});

test('서버 CLI는 한글과 공백이 있는 현재 경로에서도 기동한다',async()=>{
 const child=spawn(process.execPath,['server.mjs'],{
  cwd:process.cwd(),
  env:{...process.env,HOST:'127.0.0.1',PORT:'0'},
  stdio:['ignore','pipe','pipe'],
  detached:process.platform!=='win32'
 });
 try{
  const base=await waitForDevServer(child);
  const res=await fetch(base);
  assert.equal(res.status,200);
  assert.match(await res.text(),/운산 연결지도/);
 }finally{
  await stopChild(child);
 }
});
