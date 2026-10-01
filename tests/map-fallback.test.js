import test from 'node:test';
import assert from 'node:assert/strict';
import {AccessMap} from '../dist/map.js';
import {scenarioState} from '../dist/engine.js';

async function withBrowserStub(run){
 const keys=['window','document','maplibregl','fetch'];
 const original=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',innerHTML:'',dataset:{}});return elements.get(id);};
 globalThis.document={readyState:'complete',querySelector:element,getElementById:id=>element('#'+id),querySelectorAll:()=>[]};
 globalThis.window={matchMedia:()=>({matches:false})};
 try{await run(element);}finally{for(const key of keys){if(original[key])Object.defineProperty(globalThis,key,original[key]);else delete globalThis[key];}}
}

test('지도 모듈이 없으면 연결 도식과 상태 확인을 제공한다',async()=>{
 await withBrowserStub(async element=>{
  const map=new AccessMap({onSelect(){},onShelter(){}});
  await map.init(scenarioState(1));
  assert.equal(map.fallback,true);
  assert.equal(element('#map').hidden,true);
  assert.equal(element('#map-fallback').hidden,false);
  assert.match(element('#map-fallback').innerHTML,/가상 도로망 연결 도식/);
  assert.equal(element('#view-3d').disabled,true);
  map.update(scenarioState(2),'c');
  assert.match(element('#map-fallback').innerHTML,/고풍리 동측/);
 });
});

test('레이어 구성 실패도 반쯤 준비된 지도 대신 도식으로 전환한다',async()=>{
 await withBrowserStub(async element=>{
  let removed=false;
  class StubMap {addControl(){}on(){}once(name,fn){if(name==='load')fn();}remove(){removed=true;}}
  globalThis.maplibregl=window.maplibregl={Map:StubMap,ScaleControl:class{}};
  globalThis.fetch=async()=>({ok:true,json:async()=>({layers:[]})});
  const map=new AccessMap({onSelect(){},onShelter(){}});
  map.addLayers=()=>{throw new Error('source setup failed');};
  await map.init(scenarioState(1));
  assert.equal(map.ready,false);assert.equal(map.fallback,true);assert.equal(removed,true);
  assert.match(element('#map-error').textContent,/지도 구성에 실패/);
 });
});

test('도식의 신고는 관련 마을에 합산되고 숨김·확인 완료를 반영한다',async()=>{
 await withBrowserStub(async element=>{
  const map=new AccessMap({onSelect(){},onShelter(){}});
  const state={...scenarioState(1),logs:[{village:'c',status:'미확인'},{village:'',status:'미확인'},{village:'c',status:'확인 완료'}]};
  await map.init(state);
  assert.match(element('#map-fallback').innerHTML,/미확인 신고 1건/);
  assert.doesNotMatch(element('#map-fallback').innerHTML,/미확인 신고 2건/);
  map.setLayer('reports',false);
  assert.doesNotMatch(element('#map-fallback').innerHTML,/미확인 신고/);
  map.setLayer('reports',true);
  state.logs[0].status='확인 완료';
  map.update(state);
  assert.doesNotMatch(element('#map-fallback').innerHTML,/미확인 신고/);
 });
});
