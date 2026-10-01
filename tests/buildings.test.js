import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingLayers,buildingSummary,nearestBuildingCenter,loadOfficialBuildings,BUILDING_AREA} from '../dist/buildings.js';
import {AccessMap} from '../dist/map.js';

// Synthetic fixture only. No government source geometries are stored offline.
const ring=[[126.6,36.7],[126.601,36.7],[126.601,36.701],[126.6,36.7]];
const feature=id=>({type:'Feature',id,properties:{objectid:id,gro_flo_co:2},geometry:{type:'Polygon',coordinates:[ring]}});
const collection=features=>({type:'FeatureCollection',features});
function mockService(ids,transform=value=>value){
 const requests=[];
 return {requests,fetcher:async(url,options)=>{
  const params=options.body;requests.push(params);
  assert.equal(params.get('where'),BUILDING_AREA);
  assert.equal(options.credentials,'omit');
  const payload=params.has('returnIdsOnly')?{objectIds:ids}:collection(params.get('objectIds').split(',').map(Number).map(feature));
  return {ok:true,json:async()=>transform(payload,params)};
 }};
}

test('운산면 전체 ID를 나눠 조회하고 마지막 배치까지 누락 없이 검증한다',async()=>{
 const ids=Array.from({length:2003},(_,i)=>i+1),service=mockService(ids),progress=[];
 const data=await loadOfficialBuildings({...service,onProgress:(loaded,total)=>progress.push([loaded,total])});
 assert.deepEqual(data.features.map(f=>f.id),ids);
 assert.deepEqual(progress,[[0,2003],[1000,2003],[2000,2003],[2003,2003]]);
 assert.equal(service.requests.length,4);
 for(const request of service.requests.slice(1)){
  assert.equal(request.get('outSR'),'4326');
  assert.equal(request.has('maxAllowableOffset'),false);
  assert.equal(request.has('geometryPrecision'),false);
 }
});

test('일부 누락·중복·다른 ID·전송 제한을 전체 자료로 표시하지 않는다',async()=>{
 for(const alter of [
  data=>({...data,features:data.features.slice(1)}),
  data=>({...data,features:[data.features[0],data.features[0]]}),
  data=>({...data,features:[data.features[0],feature(99)]}),
  data=>({...data,exceededTransferLimit:true}),
  data=>({...data,properties:{exceededTransferLimit:true}}),
  ()=>({error:{code:500}})
 ]){
  const service=mockService([1,2],(value,params)=>params.has('returnIdsOnly')?value:alter(value));
  await assert.rejects(loadOfficialBuildings(service));
 }
});

test('빈 목록·중복 목록·후속 배치 오류는 성공으로 처리하지 않는다',async()=>{
 for(const ids of [[],[1,1],[1,'2']])await assert.rejects(loadOfficialBuildings(mockService(ids)));
 const service=mockService(Array.from({length:1001},(_,i)=>i));
 const base=service.fetcher;
 service.fetcher=async(...args)=>service.requests.length===2?{ok:false}:base(...args);
 await assert.rejects(loadOfficialBuildings(service));
});

test('다중 도형과 내부 구멍은 보존하며 층수를 임의의 높이로 바꾸지 않는다',async()=>{
 const source=feature(0);source.geometry={type:'MultiPolygon',coordinates:[[ring,ring.map(([x,y])=>[x+.0001,y+.0001])],[ring]]};
 const service=mockService([0],(value,params)=>params.has('returnIdsOnly')?value:collection([source]));
 const data=await loadOfficialBuildings(service);
 assert.deepEqual(data.features[0],source);
 assert.equal(data.features[0].properties.height,undefined);
 assert.deepEqual(buildingSummary(data),{count:1});
 for(const layer of buildingLayers()){
  assert.equal(layer.filter,undefined);assert.equal(layer.minzoom,undefined);assert.equal(layer.maxzoom,undefined);
  assert.notEqual(layer.type,'fill-extrusion');
 }
 assert.ok(nearestBuildingCenter(data,[126.6,36.7]).every(Number.isFinite));
});

test('빈 도형·닫히지 않은 도형·잘못된 좌표를 거부한다',()=>{
 for(const geometry of [null,{type:'Polygon',coordinates:[]},{type:'Polygon',coordinates:[[]]},{type:'Polygon',coordinates:[ring.slice(0,-1)]},{type:'Polygon',coordinates:[ring.map(()=>[Infinity,36])]}]){
  assert.throws(()=>buildingSummary(collection([{...feature(1),geometry}])));
 }
});

test('건물 서비스 오류는 배경지도·시연 연결 분석을 중단시키지 않고 재시도를 허용한다',async()=>{
 const oldFetch=globalThis.fetch,oldDocument=globalThis.document;
 const elements=new Map();globalThis.document={querySelector:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
 globalThis.fetch=async()=>({ok:false});
 try{
  const map=new AccessMap({});map.ready=true;const originalMap={};map.map=originalMap;
  await map.loadBuildings();
  assert.equal(map.ready,true);assert.equal(map.fallback,false);assert.equal(map.map,originalMap);
  assert.equal(map.loadingBuildings,false);assert.equal(elements.get('#building-retry').hidden,false);
  assert.match(elements.get('#building-status').textContent,/불러오지 못/);
 }finally{globalThis.fetch=oldFetch;globalThis.document=oldDocument;}
});
