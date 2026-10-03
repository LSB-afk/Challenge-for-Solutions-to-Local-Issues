import { DEPTH_BANDS, depthColor, validateDepthCollection, createDemoFlood, analyzeRoadExposure, compareRoutes } from './flood-analysis.js';
import { FloodMap } from './flood-map.js';
import { csvCell } from './engine.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const state = { level:1, depths:null, roads:null, places:[], exposure:null, route:null, imported:false, official:false, fileName:'', threshold:.5, verticalScale:1, view:'3d', buildings:true, building3d:true, water:true, selected:null };
let sourceRevision=0, officialController=null;
const depthLabel = feature => feature.properties.depth_kind==='interval' ? feature.properties.depth_label : `${feature.properties.depth_m.toFixed(2)} m`;
const featureColor = feature => /^#[0-9a-f]{6}$/i.test(feature.properties.depth_color??'')?feature.properties.depth_color:depthColor(feature.properties.depth_m);
function cancelOfficial(){officialController?.abort();officialController=null;$('#f-cancel-official').hidden=true;$('#f-load-official').disabled=!state.roads;}
const asPoint = place => [place.coordinate.lon,place.coordinate.lat];
const distance = value => Number.isFinite(value) ? value < 1000 ? `${Math.round(value)} m` : `${(value/1000).toFixed(2)} km` : '—';
function download(name,text,type='text/plain;charset=utf-8') {
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const map = new FloodMap({container:'#f-map',fallbackContainer:'#f-map-fallback',onDepth:showDepth,onRoad:showRoad,onPlace(id){ if(state.places.some(p=>p.id===id)){ $('#f-destination').value=id;calculate(); }},onStatus(status){
 $('#f-map-status').textContent=status.message;
 const diagram=status.mode==='diagram';
 ['#f-view-2d','#f-view-3d','#f-zoom-in','#f-zoom-out','#f-map-north'].forEach(id=>$(id).disabled=diagram);
 if(diagram){$('#f-map-error').hidden=false;$('#f-map-error').textContent='3D 지도를 표시할 수 없어 도로·수심 도식과 분석표를 제공합니다.';}
},onBuildings(status){
 $('#f-building-status').textContent=status.status==='ready'?`운산면 건물 ${status.count.toLocaleString()}개 · 원본 도형`:(status.message || `건물 ${status.count??0}/${status.total??'…'} 불러오는 중`);
 $('#f-building-retry').hidden=status.status!=='error';
}});
function syncMap(){
 if(!state.depths||!state.exposure)return;
 map.update({depths:state.depths,exposure:state.exposure,route:state.route,verticalScale:state.verticalScale,showFlood:state.water,showBuildings:state.buildings,building3d:state.building3d});
 $('#f-render-note').textContent=`${state.official?'등급 상한 높이':'수심 높이'} ×${state.verticalScale} · ${state.building3d?'건물은 층수×3 m 가정':'건물 원본 윤곽'} · 지형 고도 미적용`;
}
function sourceInfo(){
 const props=state.depths.metadata??{};
 $('#f-data-kind').textContent=state.official?'공식 시나리오 · 지방하천 100년 빈도':state.imported?'사용자 수심 자료 · 출처 검증 전':'예시 수심 · 공식 예측 미연결';
 $('#f-data-description').textContent=state.official?'원본 침수심 등급 · 실시간 예보 아님':state.imported?state.fileName:'공개 도로·건물에 가정 수심을 겹쳐 봅니다.';
 $('#f-scenario-kind').textContent=state.official?'공식 등급':state.imported?'사용자 자료':'합성 예시';
 $('#f-legend-kind').textContent=state.official?'공식 침수심 등급':state.imported?'사용자 자료 · 검증 전':'예시 수심';
 $('#f-scenario-description').textContent=state.official?'공식 범람 시나리오가 포함하는 북동측 일부 구역입니다. 빈도는 재현기간이며 현재 발생 확률·예보가 아닙니다.':state.imported?'불러온 수심을 그대로 사용합니다. 아래 제외 조건은 분석을 위한 가정입니다.':'세 조건은 조작 예시이며 강우·시간에 따른 예보가 아닙니다.';
 $('.f-provenance').classList.toggle('official',state.official);$('.f-official-source').classList.toggle('active',state.official);
 $('#f-export').disabled=state.official;$('#f-export').textContent=state.official?'공식 자료 · 내보내기 제한':'분석표 내려받기 ↓';
 document.querySelectorAll('[data-flood-level]').forEach(b=>{const active=!state.imported&&!state.official&&Number(b.dataset.floodLevel)===state.level;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 const title=props.title||state.fileName||'수심 자료',source=props.source||'출처 미기재',scenario=props.scenario||'조건 미기재';
 let link='';try{const u=new URL(props.source_url);if(u.protocol==='https:')link=`<br><a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">자료에 기재된 출처 ↗</a>`;}catch{}
 $('#f-source-info').innerHTML=`<strong>${esc(title)}</strong><br>출처: ${esc(source)}<br>조건: ${esc(scenario)}${link}<br>${state.official?'공공누리 제4유형 · 원본 등급을 메모리에서 표시. 등급의 상한으로 세운 높이는 정확한 수심이 아닙니다.':state.imported?'사용자 입력 메타데이터이며 공식 인증이 아닙니다.':'형상과 수심은 기능 확인을 위해 만든 합성값입니다.'}`;
 const deepest=state.depths.features.reduce((a,b)=>a.properties.depth_m>b.properties.depth_m?a:b);
 $('#f-max-depth').textContent=depthLabel(deepest);
 $('#f-area-count').textContent=`${state.depths.features.length}개`;
 $('#f-depth-select').innerHTML=state.depths.features.map((f,i)=>`<option value="${i}">${esc(state.official?`공식 구역 ${i+1}`:f.properties.name||`구역 ${i+1}`)} · ${esc(depthLabel(f))}</option>`).join('');
 $('#f-depth-select').disabled=false;
}
function routeRow(label,result,kind){
 const candidate=result?.status==='candidate';
 const text=candidate?distance(result.distanceM):result?.status==='unmatched'?'진입 연결 미확정':'후보 미발견';
 return `<div class="f-route-row ${kind}"><span>${label}<small>${candidate?'도로 형상상 연결 후보':'이 자료·조건 내 결과'}</small></span><strong>${text}</strong></div>`;
}
function renderRoutes(){
 const {before,after,snaps}=state.route;
 let message='현재 통행 가능성과 도착 시설의 개방을 확인한 결과가 아닙니다.';
 if(before.status==='candidate'&&after.status==='candidate'){
  const difference=after.distanceM-before.distanceM;
  message=`제외 전보다 ${Math.abs(difference)<1?'거리 변화 없음':`${distance(Math.abs(difference))} ${difference>0?'증가':'감소'}`}. 실제 통행·시설 개방 확인이 필요합니다.`;
 }else if(before.status==='candidate'&&after.status==='no-path')message='선택 조건을 적용하면 수집 도로망에서 연결 후보를 찾지 못합니다. 실제 고립 확정은 아닙니다.';
 else if(before.status==='unmatched'||after.status==='unmatched')message='시설 중심점에서 200 m 안의 도로 꼭짓점을 찾지 못했습니다. 임의의 긴 진입 경로를 만들지 않습니다.';
 const snapNote=snaps?.origin&&snaps?.destination?`<br>진입 연결 가정: 출발 ${distance(snaps.origin.distanceM)} · 도착 ${distance(snaps.destination.distanceM)}`:'';
 $('#f-route-results').innerHTML=routeRow('제외 전',before,'before')+routeRow('제외 조건 적용',after,'after')+`<p class="f-route-message">${esc(message)}${snapNote}</p>`;
 $('#f-fit-route').disabled=false;
}
function calculate(){
 if(!state.roads||!state.depths)return;
 state.threshold=Number($('#f-threshold').value);
 $('#f-threshold-value').textContent=`${state.threshold.toFixed(1)} m 이상`;
 state.exposure=analyzeRoadExposure(state.roads,state.depths,state.threshold);
 const summary=state.exposure.summary;
 $('#f-overlap').textContent=summary.intersected;
 $('#f-excluded').textContent=summary.excluded;$('#f-excluded').title=`수심 구간 때문에 불확실하여 제외: ${summary.uncertain??0}개`;
 $('#f-bridges').textContent=summary.bridges;
 $('#f-uncertainty-note').hidden=!summary.uncertain;
 $('#f-uncertainty-note').textContent=`제외 가정 중 ${summary.uncertain??0}개는 수심 등급 안에 기준값이 있어 정확한 초과 여부를 확인할 수 없습니다.`;
 const origin=state.places.find(p=>p.id===$('#f-origin').value),destination=state.places.find(p=>p.id===$('#f-destination').value);
 state.route=compareRoutes(state.roads,state.exposure,asPoint(origin),asPoint(destination),{depths:state.depths,threshold:state.threshold});
 renderRoutes();syncMap();
 if(state.selected?.kind==='road'){const f=state.exposure.features.find(r=>r.properties.osmId===state.selected.id);if(f)showRoad(f);}
}
function showDepth(feature){
 if(!feature)return;
 const index=state.depths?.features.findIndex(f=>String(f.id)===String(feature.id));
 if(index>=0)$('#f-depth-select').value=String(index);
 state.selected={kind:'depth',id:feature.id};
 const d=feature.properties.display_height_m??feature.properties.depth_m,interval=feature.properties.depth_kind==='interval';
 $('#f-inspector').innerHTML=`<span class="f-eyebrow">${state.official?'공식 시나리오 · 침수심 등급':state.imported?'사용자 자료 · 검증 전':'합성 예시 수심'}</span><h3>${esc(feature.properties.name||`수심 구역 ${index+1}`)}</h3><span class="f-selected-depth ${interval?'interval':''}">${interval?esc(depthLabel(feature)):`${Number(d).toFixed(2)} <small>m</small>`}</span><div class="f-depth-track"><i style="width:${Math.min(100,d/5*100)}%;background:${featureColor(feature)}"></i></div><p>${interval?'구간값 · 정확한 수심 미제공':'지면 기준 수심 값'}<br>${interval?'등급 상한 표시':'입체 높이'} ${(d*state.verticalScale).toFixed(2)} m · ×${state.verticalScale}<br>실시간 관측·수면 표고가 아닙니다.</p>`;
}
function showRoad(feature){
 const p=feature.properties;state.selected={kind:'road',id:p.osmId};
 const status={outside:'수심 자료와 겹치지 않음',below:'선택한 제외 수심 미만',excluded:'도로 전체 제외 가정','bridge-review':'교량 상판 높이 확인 필요','depth-review':'구간 내 정확한 수심이 없어 제외 가정'}[p.impact]||'형상 정보';
 $('#f-inspector').innerHTML=`<span class="f-eyebrow">공개 도로 · 조건 비교</span><h3>${esc(p.name||'이름 없는 도로')}</h3><span class="f-selected-depth ${p.depth_label?'interval':''}">${p.depth_label?esc(p.depth_label):Number.isFinite(p.depth_m)?p.depth_m.toFixed(2)+' <small>m</small>':'— <small>자료 미포함</small>'}</span><p>${esc(status)}<br>${p.impact==='bridge-review'?'지면 수심으로 교량 상판 침수를 확정하지 않습니다.':p.depth_label?'겹치는 침수심 등급 중 최대 구간입니다.':'겹치는 영역의 최대 수심입니다.'}<br>현재 통행 상태는 미확인입니다.</p><p><a href="https://www.openstreetmap.org/way/${Number(p.osmId)}" target="_blank" rel="noopener">도로 원본 ↗</a></p>`;
}
function setDemo(level){
 sourceRevision++;cancelOfficial();state.level=level;state.depths=createDemoFlood(level);state.imported=false;state.official=false;state.fileName='';state.selected=null;
 sourceInfo();calculate();showDepth(state.depths.features[0]);map.focusDepths?.();$('#f-import-message').textContent='';$('#f-import').value='';
}
async function load(){
 try{
  const responses=await Promise.all([fetch('./data/unsan-osm-roads.geojson'),fetch('./data/regional-evidence.json')]);
  if(responses.some(r=>!r.ok))throw Error('공개 지역 자료 응답 실패');
  const [roads,evidence]=await Promise.all(responses.map(r=>r.json()));
  if(!roads.features?.length||!evidence.places?.length)throw Error('공개 지역 자료 형식 오류');
  state.roads=roads;state.places=evidence.places.filter(p=>p.coordinate);
  if(state.places.length<2)throw Error('좌표가 확인된 시설이 부족합니다');
  const options=state.places.map((p,i)=>`<option value="${esc(p.id)}">${i+1}. ${esc(p.name)}</option>`).join('');
  $('#f-origin').innerHTML=options;$('#f-destination').innerHTML=options;
  $('#f-origin').value=state.places[0].id;$('#f-destination').value=(state.places.find(p=>p.id==='gopung-gosaek-hall')||state.places[1]).id;
  $('#f-origin').disabled=false;$('#f-destination').disabled=false;$('#f-export').disabled=false;
  $('#f-dataset-status').textContent=`도로 객체 ${roads.features.length}개 · 주소 대조 지점 ${state.places.length}/${evidence.places.length}곳 · 공개자료 ${evidence.generatedAt.slice(0,10)}`;
  $('#f-depth-legend').innerHTML=DEPTH_BANDS.map(b=>`<span><i style="background:${b.color}"></i>${esc(b.label)}</span>`).join('');
  setDemo(1);await map.init({roads,places:state.places});syncMap();
 }catch(error){$('#f-dataset-status').textContent=`분석을 시작하지 못했습니다: ${error.message}`;$('#f-route-results').textContent='자료를 확인한 뒤 새로고침해 주세요.';$('#f-map-status').textContent='자료 불러오기 실패';$('#f-map-error').hidden=false;$('#f-map-error').textContent=error.message;}
}
document.querySelectorAll('[data-flood-level]').forEach(b=>b.addEventListener('click',()=>{if(state.roads)setDemo(Number(b.dataset.floodLevel));}));
$('#f-threshold').addEventListener('input',calculate);
['#f-origin','#f-destination'].forEach(id=>$(id).addEventListener('change',calculate));
$('#f-depth-select').addEventListener('change',()=>{const feature=state.depths.features[Number($('#f-depth-select').value)];showDepth(feature);const ring=feature.geometry.type==='Polygon'?feature.geometry.coordinates[0]:feature.geometry.coordinates[0][0];const points=ring.slice(0,-1);map.focus(points.reduce((sum,p)=>[sum[0]+p[0]/points.length,sum[1]+p[1]/points.length],[0,0]),16);});
$('#f-vertical-scale').addEventListener('change',()=>{state.verticalScale=Number($('#f-vertical-scale').value);syncMap();if(state.selected?.kind==='depth')showDepth(state.depths.features.find(f=>f.id===state.selected.id));});
[['#f-show-water','water'],['#f-show-buildings','buildings'],['#f-building-3d','building3d']].forEach(([id,key])=>$(id).addEventListener('change',()=>{state[key]=$(id).checked;syncMap();}));
['2d','3d'].forEach(view=>$(`#f-view-${view}`).addEventListener('click',()=>{state.view=view;map.setView(view);['2d','3d'].forEach(v=>{$(`#f-view-${v}`).classList.toggle('active',v===view);$(`#f-view-${v}`).setAttribute('aria-pressed',String(v===view));});}));
$('#f-map-home').addEventListener('click',()=>map.fit());$('#f-fit-route').addEventListener('click',()=>map.fit());
$('#f-map-north').addEventListener('click',()=>map.north());$('#f-zoom-in').addEventListener('click',()=>map.zoom(1));$('#f-zoom-out').addEventListener('click',()=>map.zoom(-1));$('#f-building-retry').addEventListener('click',()=>map.retryBuildings());
$('#f-demo-reset').addEventListener('click',()=>{if(state.roads)setDemo(1);});
$('#f-load-official').addEventListener('click',async()=>{
 if(!state.roads)return;
 cancelOfficial();const revision=++sourceRevision,controller=new AbortController();officialController=controller;
 $('#f-load-official').disabled=true;$('#f-cancel-official').hidden=false;
 $('#f-official-status').textContent='공식 원본을 조회하고 있습니다. 기존 분석은 유지합니다.';
 try{
  const {loadOfficialFlood}=await import('./flood-official.js');
  const data=await loadOfficialFlood({signal:controller.signal,onProgress:progress=>{
   if(revision!==sourceRevision)return;
   $('#f-official-status').textContent=typeof progress==='string'?progress:progress.message||'공식 원본을 불러오는 중입니다.';
  }});
  if(revision!==sourceRevision)return;
  if(!data.features.length)throw Error('대상 권역에 포함되는 도형이 없습니다.');
  state.depths=data;state.official=true;state.imported=false;state.fileName='';state.selected=null;
  sourceInfo();calculate();showDepth(data.features[0]);map.focusDepths?.();
  $('#f-official-status').textContent=`공식 원자료 ${data.features.length}개 도형 표시 · 침수심 등급 · 원본 갱신 ${data.metadata?.updated||'2025-12'}`;
 }catch(error){
  if(revision===sourceRevision)$('#f-official-status').textContent=error.name==='AbortError'?'조회를 취소했습니다. 기존 분석을 유지합니다.':`조회 실패: ${error.message} 기존 분석을 유지합니다.`;
 }finally{if(revision===sourceRevision)cancelOfficial();}
});
$('#f-cancel-official').addEventListener('click',()=>{sourceRevision++;cancelOfficial();$('#f-official-status').textContent='조회를 취소했습니다. 기존 분석을 유지합니다.';});
$('#f-sample').addEventListener('click',()=>download('unsan-example-depth.geojson',JSON.stringify(createDemoFlood(1),null,2),'application/geo+json'));
$('#f-import').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file||!state.roads)return;
 const revision=++sourceRevision;cancelOfficial();
 try{
  if(file.size>5*1024*1024)throw Error('파일은 5 MB 이하로 준비해 주세요.');
  const parsed=validateDepthCollection(JSON.parse(await file.text()));
  if(revision!==sourceRevision)return;
  state.depths=parsed;state.imported=true;state.official=false;state.fileName=file.name;state.selected=null;
  sourceInfo();calculate();showDepth(parsed.features[0]);map.focusDepths?.();$('#f-import-message').textContent='수심 자료를 불러왔습니다. 입력된 출처와 조건을 확인해 주세요.';
 }catch(error){if(revision===sourceRevision)$('#f-import-message').textContent=`불러오기 실패: ${error.message} 기존 자료를 유지합니다.`;}finally{event.target.value='';}
});
$('#f-export').addEventListener('click',()=>{
 if(!state.exposure||state.official)return;
 const props=state.depths.metadata??{},origin=state.places.find(p=>p.id===$('#f-origin').value),destination=state.places.find(p=>p.id===$('#f-destination').value);
 const rows=[['운산 침수 3D 분석','형상 연결 실험 / 현재 통행·대피시설 개방 미확인'],['자료 종류',state.imported?'사용자 자료 · 출처 검증 전':'합성 예시 · 공식 예측 아님'],['자료',props.title||state.fileName],['출처',props.source||'미기재'],['시나리오',props.scenario||'미기재'],['제외 수심(m)',state.threshold],['수직 표시 배율(분석에 미적용)',state.verticalScale],['교량 처리','양의 수심과 겹치면 상판 미확인으로 제외'],['출발',origin.name],['도착',destination.name],['시설 상태','대피시설 지정·개방·출입구 미확인'],['제외 전 후보',state.route.before.status,'거리(m)',state.route.before.distanceM??''],['제외 후 후보',state.route.after.status,'거리(m)',state.route.after.distanceM??''],['한계','양방향 형상·200m 이내 꼭짓점 연결 가정·객체 전체 제외·자료 밖 안전 판정 불가'],[],['OSM ID','도로명','최대 교차 수심(m)','제외 가정 상태']];
 for(const f of state.exposure.features)rows.push([f.properties.osmId,f.properties.name||'이름 없는 도로',f.properties.depth_m??'자료 미포함',f.properties.impact]);
 download('운산_침수조건_연결비교.csv','\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
});
load();
