import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT=path.join(__dirname,'dist');

const MIME_TYPES=new Map([
 ['.html','text/html; charset=utf-8'],
 ['.css','text/css; charset=utf-8'],
 ['.js','text/javascript; charset=utf-8'],
 ['.json','application/json; charset=utf-8'],
 ['.txt','text/plain; charset=utf-8'],
 ['.svg','image/svg+xml; charset=utf-8'],
 ['.png','image/png'],
 ['.jpg','image/jpeg'],
 ['.jpeg','image/jpeg'],
 ['.webp','image/webp'],
 ['.ico','image/x-icon']
]);

export function getMimeType(filePath){
 return MIME_TYPES.get(path.extname(filePath).toLowerCase())??'application/octet-stream';
}

function sendText(res,status,text,headers={}){
 res.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',...headers});
 res.end(text);
}

function resolveRequestPath(reqUrl,root){
 const rawPath=(reqUrl||'/').split(/[?#]/,1)[0]||'/';
 if(!rawPath.startsWith('/'))return {error:{status:400,message:'Bad request'}};
 let decoded;
 try{decoded=decodeURIComponent(rawPath);}
 catch{return {error:{status:400,message:'Malformed request path'}};}
 if(decoded.includes('\0'))return {error:{status:400,message:'Malformed request path'}};
 if(decoded.split('/').includes('..')){
  return {error:{status:400,message:'Path traversal is not allowed'}};
 }
 const normalized=path.posix.normalize(decoded);
 if(normalized.startsWith('/../')||normalized==='..'||normalized.includes('/../')){
  return {error:{status:400,message:'Path traversal is not allowed'}};
 }
 const relative=normalized==='/'?'index.html':normalized.slice(1);
 const target=path.resolve(root,relative);
 const rootWithSep=root.endsWith(path.sep)?root:root+path.sep;
 if(target!==root&&!target.startsWith(rootWithSep)){
  return {error:{status:400,message:'Path traversal is not allowed'}};
 }
 return {target};
}

export function createStaticHandler(options={}){
 const root=path.resolve(options.root??DEFAULT_ROOT);
 return async function staticHandler(req,res){
  if(req.method!=='GET'&&req.method!=='HEAD'){
   sendText(res,405,'Method not allowed',{'allow':'GET, HEAD'});
   return;
  }

  const resolved=resolveRequestPath(req.url??'/',root);
  if(resolved.error){
   sendText(res,resolved.error.status,resolved.error.message);
   return;
  }

  let filePath=resolved.target;
  let info;
  try{info=await stat(filePath);}
  catch{
   sendText(res,404,'Not found');
   return;
  }
  if(info.isDirectory()){
   filePath=path.join(filePath,'index.html');
   try{info=await stat(filePath);}
   catch{
    sendText(res,404,'Not found');
    return;
   }
  }
  if(!info.isFile()){
   sendText(res,404,'Not found');
   return;
  }

  res.writeHead(200,{
   'content-type':getMimeType(filePath),
   'content-length':String(info.size),
   'cache-control':'no-store'
  });
  if(req.method==='HEAD'){
   res.end();
   return;
  }
  createReadStream(filePath).on('error',()=>res.destroy()).pipe(res);
 };
}

export function createStaticServer(options={}){
 return createServer(createStaticHandler(options));
}

function isCliEntryPoint(){
 if(import.meta.main)return true;
 if(!process.argv[1])return false;
 return import.meta.url===pathToFileURL(process.argv[1]).href;
}

if(isCliEntryPoint()){
 const port=Number.parseInt(process.env.PORT??'4173',10);
 const host=process.env.HOST??'127.0.0.1';
 const server=createStaticServer();
 server.listen(port,host,()=>{
  const address=server.address();
  const shownPort=typeof address==='object'&&address?address.port:port;
  console.log(`운산 연결지도 dev server: http://${host}:${shownPort}`);
 });
}
