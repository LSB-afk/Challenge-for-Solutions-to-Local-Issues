import {VILLAGES,SHELTERS,ROADS,SCENARIOS,SOURCES} from './data.js';
import {scenarioState,analyzeAll,analyzeVillage,extractReport,exportCsv} from './engine.js';
import {AccessMap} from './map.js';

const $=s=>document.querySelector(s);
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORAGE_KEY='unsan-access-demo-v1';
const ALLOWED=['open','closed','unknown'];
let storageAvailable=true;
function restore(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(!saved||!Number.isInteger(saved.scenario)||!SCENARIOS[saved.scenario])return null;
    const base=scenarioState(saved.scenario);
    for(const key of Object.keys(base.roads))if(ALLOWED.includes(saved.roads?.[key]))base.roads[key]=saved.roads[key];
    for(const key of Object.keys(base.shelters))if(ALLOWED.includes(saved.shelters?.[key]))base.shelters[key]=saved.shelters[key];
    const logs=Array.isArray(saved.logs)?saved.logs.filter(l=>l&&typeof l.id==='string'&&typeof l.text==='string'&&typeof l.time==='string').slice(0,100).map(l=>({id:l.id,text:l.text.slice(0,1000),time:l.time.slice(0,40),village:VILLAGES.some(v=>v.id===l.village)?l.village:'',type:String(l.type??'기타').slice(0,30),status:l.status==='확인 완료'?'확인 완료':'미확인',scenario:Number.isInteger(l.scenario)&&SCENARIOS[l.scenario]?l.scenario:base.scenario})):[];
    return {...base,logs};
  }catch{storageAvailable=false;return null;}
}
const initial=restore();
let state=initial??{...scenarioState(1),logs:[]};
let selected='a',tab='overview',query='',toastTimer;
const map=new AccessMap({onSelect:id=>selectVillage(id,false),onShelter:id=>{switchTab('shelters');const el=$(`[data-facility-card="${id}"]`);el?.scrollIntoView({behavior:'smooth',block:'nearest'});}});
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));storageAvailable=true;}catch{storageAvailable=false;toast('저장 공간에 접근할 수 없어 이번 화면에서만 기록을 유지합니다.');}}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function stamp(){return new Date().toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
function addLog(text,{village=selected,type='상황 확인',status='확인 완료'}={}){
  state.logs.unshift({id:crypto.randomUUID(),text,village,type,status,time:stamp(),scenario:state.scenario});state.logs=state.logs.slice(0,100);persist();
}
function statusLabel(result){return `<span class="status-label ${result.status}">${result.label}</span>`;}
function header(title,description,extra=''){return `<div class="sidebar-header"><span class="eyebrow">운산면 비상근무</span><div class="sidebar-title"><h2>${title}</h2>${extra}</div><p class="sidebar-description">${description}</p></div>`;}
function renderSidebar(){
  const panel=$('#sidebar-content');
  if(tab==='overview'){
    const results=analyzeAll(state),counts={blocked:0,unknown:0,connected:0};results.forEach(r=>counts[r.status]++);
    panel.innerHTML=header('마을별 접근 현황','어느 마을을 먼저 확인해야 할까요?',`<span class="count">${VILLAGES.length}개 마을</span>`)+
    `<div class="summary-strip"><div class="summary-item blocked"><strong>${counts.blocked}</strong><span>연결 확인 불가</span></div><div class="summary-item unknown"><strong>${counts.unknown}</strong><span>추가 확인</span></div><div class="summary-item connected"><strong>${counts.connected}</strong><span>연결 경로 있음</span></div></div><div class="list-tools"><div class="search-box">${icon('search')}<input id="village-search" type="search" aria-label="마을 검색" placeholder="마을 이름 또는 A–D 검색" value="${escape(query)}"></div><div class="list-caption"><span>확인할 마을</span><small>확인 우선순</small></div></div><div class="village-list" id="village-list"></div><div class="sidebar-action"><button class="button primary full" data-report>${icon('plus')}현장 신고 기록</button><p>시연용 도로망 기준입니다.<br>마을을 선택해 판단 근거를 확인하세요.</p></div>`;
    renderVillageList();
    $('#village-search').addEventListener('input',e=>{query=e.target.value;renderVillageList();});
  }else if(tab==='shelters'){
    panel.innerHTML=header('대피시설 확인','시설 개방 상태를 바꾸면 연결 결과도 달라집니다.')+SHELTERS.map(s=>`<section class="facility-card" data-facility-card="${s.id}"><div class="facility-title">${icon('home')}<h3>${s.name}</h3></div><p>${s.subtitle}<br>실제 지정 대피시설이 아닙니다.</p><label for="facility-${s.id}" class="tiny muted">시연 운영 상태</label><select id="facility-${s.id}" data-shelter="${s.id}" aria-label="${s.name} 운영 상태"><option value="open" ${state.shelters[s.id]==='open'?'selected':''}>개방 확인 · 시연</option><option value="unknown" ${state.shelters[s.id]==='unknown'?'selected':''}>개방 여부 미확인</option><option value="closed" ${state.shelters[s.id]==='closed'?'selected':''}>미개방 · 시연</option></select></section>`).join('');
  }else if(tab==='log'){
    const pending=state.logs.filter(l=>l.status==='미확인').length;
    panel.innerHTML=header('확인·인계 기록',`총 ${state.logs.length}건 · 미확인 ${pending}건`, `<span class="count">브라우저 저장</span>`)+
    `<div class="sidebar-action" style="padding-top:0"><button class="button primary full" data-report>${icon('plus')}현장 신고 기록</button></div>`+
    (state.logs.length?state.logs.map(l=>`<article class="log-card"><div class="log-meta"><span>${escape(l.time)}</span><span>${SCENARIOS[l.scenario].time} 시나리오</span></div><strong>${escape(VILLAGES.find(v=>v.id===l.village)?.name??'위치 미확정')} · ${escape(l.type)}</strong><p>${escape(l.text)}</p><div class="log-meta"><span class="log-status ${l.status==='확인 완료'?'done':''}">${l.status}</span>${l.status==='미확인'?`<button class="button secondary" data-confirm-log="${escape(l.id)}">확인 완료로 기록</button>`:''}</div></article>`).join(''):`<div class="empty-state">아직 기록이 없습니다.<br>마을을 확인하거나 현장 신고를 남겨 보세요.</div>`)+`<div class="sidebar-action"><p>${storageAvailable?'이 브라우저에만 저장됩니다.':'현재 저장 공간을 사용할 수 없습니다.'}<br>실제 기관에 전송되는 기록이 아닙니다.</p></div>`;
  }else{
    panel.innerHTML=header('자료와 시연 범위','확인된 지리적 배경과 가상 운영 데이터를 구분합니다.')+SOURCES.map(s=>`<section class="source-card"><h3>${s.title}</h3><small>${s.status}</small><p>${s.text}</p>${s.url?`<a href="${s.url}" target="_blank" rel="noopener noreferrer">출처 보기 ↗</a>`:''}</section>`).join('')+`<section class="source-card"><h3>신고 정리 기능</h3><small>규칙 기반 시연</small><p>지명과 위험 키워드를 추출합니다. 외부 AI나 실시간 센서는 연결하지 않았습니다. 자동 대피명령이나 경로 안전 판정은 수행하지 않습니다.</p></section>`;
  }
  $('#log-count').hidden=!state.logs.some(l=>l.status==='미확인');
}
function renderVillageList(){
  const rank={blocked:0,unknown:1,connected:2};const q=query.trim().toLowerCase();
  const items=analyzeAll(state).map(r=>({...r,village:VILLAGES.find(v=>v.id===r.id)})).filter(r=>`${r.village.name} ${r.village.code} ${r.village.subtitle}`.toLowerCase().includes(q)).sort((a,b)=>rank[a.status]-rank[b.status]);
  $('#village-list').innerHTML=items.length?items.map(r=>`<button class="village-item ${r.id===selected?'active':''}" data-village="${r.id}" aria-pressed="${r.id===selected}"><span class="village-code">${r.village.code}</span><span class="village-copy"><strong>${r.village.name}</strong><small>${r.village.subtitle}</small>${statusLabel(r)}</span><span class="chevron" aria-hidden="true">›</span></button>`).join(''):'<div class="empty-state">검색 결과가 없습니다.<br>원평리, 고풍리 또는 A–D를 입력하세요.</div>';
}
function renderDetail(){
 const village=VILLAGES.find(v=>v.id===selected),result=analyzeVillage(selected,state),shelter=SHELTERS.find(s=>s.id===result.route?.target);
 const adjacent=ROADS.filter(r=>r.from===selected||r.to===selected);
 $('#detail-panel').innerHTML=`<div class="detail-head"><div class="detail-topline"><span>${icon('pin')}선택한 마을 · ${village.code}</span><span>시연 데이터</span></div><h2>${village.name}</h2>${statusLabel(result)}</div><div class="detail-body"><p>${village.note}</p><div class="route-result ${result.status}"><strong>${result.route?`${shelter.name} 연결 ${result.status==='unknown'?'후보':'경로'}`:'개방 시설 연결 확인 불가'}</strong><small>${result.route?`시연 선형 기준 ${(result.route.distance/1000).toFixed(1)} km · ${result.route.edges.length}개 구간`:'도로·시설 상태를 추가로 확인하세요.'}</small></div><p>${result.reason}</p><details class="road-controls"><summary>관련 도로 ${adjacent.length}개 · 상태 바꾸기</summary>${adjacent.map(r=>`<div class="road-control"><label for="road-${r.id}">${r.name} · 시연</label><select id="road-${r.id}" data-road="${r.id}" aria-label="${r.name} 상태"><option value="open" ${state.roads[r.id]==='open'?'selected':''}>통행 가능 · 시연</option><option value="unknown" ${state.roads[r.id]==='unknown'?'selected':''}>미확인</option><option value="closed" ${state.roads[r.id]==='closed'?'selected':''}>통제 · 시연</option></select></div>`).join('')}</details><div class="detail-footer"><button class="button secondary" id="record-check">${icon('check')}확인 기록</button><button class="button primary" data-report>${icon('plus')}신고 추가</button></div><small class="detail-note">실제 이동 경로 안내가 아닙니다. 현장 확인이 필요합니다.</small></div>`;
}
function render(){renderSidebar();renderDetail();map.update(state,selected);document.querySelectorAll('[data-scenario]').forEach(el=>{const active=Number(el.dataset.scenario)===state.scenario;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});}
function switchTab(next){tab=next;document.querySelectorAll('[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===tab);el.setAttribute('aria-pressed',String(el.dataset.tab===tab));});renderSidebar();if(window.innerWidth<=760)setMobile('list');}
function selectVillage(id,move=true){if(!VILLAGES.some(v=>v.id===id))return;selected=id;renderDetail();if(tab==='overview')renderVillageList();map.update(state,selected);if(move)map.focus(id);if(window.innerWidth<=760)setMobile('map');}
function setMobile(mode){$('#workspace').classList.toggle('show-map',mode==='map');document.querySelectorAll('[data-mobile]').forEach(el=>{el.classList.toggle('active',el.dataset.mobile===mode);el.setAttribute('aria-pressed',String(el.dataset.mobile===mode));});requestAnimationFrame(()=>map.resize());}
function changeScenario(id){if(!Number.isInteger(id)||!SCENARIOS[id])throw Error('유효하지 않은 시나리오입니다.');state={...scenarioState(id),logs:state.logs};persist();render();toast(`${SCENARIOS[id].time} ${SCENARIOS[id].title} 시나리오를 적용했습니다.`);}
function openReport(){const form=$('#report-form');form.reset();$('#report-village').value=selected;$('#extract-result').hidden=true;$('#report-dialog').showModal();$('#report-text').focus();}
function changeRoad(id,value){if(!ROADS.some(r=>r.id===id)||!ALLOWED.includes(value))return;state.roads[id]=value;const names={open:'통행 가능',closed:'통제',unknown:'미확인'};addLog(`${ROADS.find(r=>r.id===id).name}의 시연 상태를 '${names[value]}'으로 변경했습니다.`,{type:'도로 상태 변경'});render();toast('도로 상태를 반영해 연결을 다시 계산했습니다.');}
function registerTools(){
 const context=document.modelContext;if(!context?.registerTool)return;
 const tools=[
 {name:'read_demo_access_status',title:'시연 마을 연결 상태 읽기',description:'현재 가상 시나리오의 마을별 연결 상태를 읽습니다. 실제 재난정보가 아닙니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({demo:true,scenario:state.scenario,villages:analyzeAll(state).map(({id,status,label})=>({id,status,label}))})},
 {name:'set_demo_scenario',title:'가상 시나리오 선택',description:'시연 상태를 0 상황 확인, 1 교량 통제, 2 복수 통제로 바꾸고 이 브라우저에 저장합니다. 외부 발송은 없습니다.',inputSchema:{type:'object',properties:{scenario:{type:'integer',enum:[0,1,2]}},required:['scenario'],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{if(!input||Object.keys(input).some(k=>k!=='scenario'))throw Error('scenario만 지정하세요.');changeScenario(input.scenario);return {demo:true,scenario:state.scenario};}}
 ];
 for(const tool of tools){try{Promise.resolve(context.registerTool(tool)).catch(()=>{});}catch{}}
}

document.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>switchTab(el.dataset.tab)));
document.querySelectorAll('[data-scenario]').forEach(el=>el.addEventListener('click',()=>changeScenario(Number(el.dataset.scenario))));
document.querySelectorAll('[data-mobile]').forEach(el=>el.addEventListener('click',()=>setMobile(el.dataset.mobile)));
document.querySelectorAll('[data-close-dialog]').forEach(el=>el.addEventListener('click',()=>el.closest('dialog').close()));
document.addEventListener('click',event=>{
 const report=event.target.closest('[data-report]');if(report)openReport();
 const village=event.target.closest('.village-item');if(village)selectVillage(village.dataset.village);
 const log=event.target.closest('[data-confirm-log]');if(log){const entry=state.logs.find(l=>l.id===log.dataset.confirmLog);if(entry){entry.status='확인 완료';entry.text+=' [사용자가 확인 완료로 표시]';persist();renderSidebar();toast('확인 완료로 기록했습니다. 도로 상태는 별도로 확인해 주세요.');}}
 if(event.target.closest('#record-check')){const result=analyzeVillage(selected,state);addLog(`시연 시나리오에서 '${result.label}' 상태를 검토했습니다. ${result.reason}`);renderSidebar();toast('선택 마을의 확인 기록을 저장했습니다.');}
});
document.addEventListener('change',event=>{
 const road=event.target.dataset.road;if(road)changeRoad(road,event.target.value);
 const shelter=event.target.dataset.shelter;if(SHELTERS.some(s=>s.id===shelter)&&ALLOWED.includes(event.target.value)){state.shelters[shelter]=event.target.value;addLog(`${SHELTERS.find(s=>s.id===shelter).name}의 시연 운영 상태를 변경했습니다.`,{village:'',type:'시설 상태 변경'});render();toast('시설 상태를 반영해 연결을 다시 계산했습니다.');}
});
for(const view of ['2d','3d'])$('#view-'+view).addEventListener('click',()=>{map.setView(view);['2d','3d'].forEach(v=>{$('#view-'+v).classList.toggle('active',v===view);$('#view-'+v).setAttribute('aria-pressed',String(v===view));});});
$('#map-zoom-in').addEventListener('click',()=>map.zoom(1));$('#map-zoom-out').addEventListener('click',()=>map.zoom(-1));$('#map-north').addEventListener('click',()=>map.north());$('#map-reset').addEventListener('click',()=>map.reset());
$('#layer-button').addEventListener('click',()=>{const panel=$('#layer-panel');panel.hidden=!panel.hidden;$('#layer-button').setAttribute('aria-expanded',String(!panel.hidden));});
document.querySelectorAll('[data-layer]').forEach(el=>el.addEventListener('change',()=>map.setLayer(el.dataset.layer,el.checked)));
$('#data-note').addEventListener('click',()=>switchTab('sources'));
let exportUrl;
$('#export').addEventListener('click',()=>{
 if(exportUrl)URL.revokeObjectURL(exportUrl);
 const csv=exportCsv(state,state.logs);$('#export-csv').value=csv;
 exportUrl=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
 $('#download-csv').href=exportUrl;$('#download-csv').download=`운산_시연_인계표_${new Date().toISOString().slice(0,10)}.csv`;
 $('#export-dialog').showModal();
});
$('#copy-csv').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText($('#export-csv').value);toast('인계표를 복사했습니다. 스프레드시트에 붙여넣을 수 있습니다.');}
 catch{$('#export-csv').focus();$('#export-csv').select();toast('아래 인계표를 선택했습니다. 복사 단축키를 사용해 주세요.');}
});
$('#scenario-reset').addEventListener('click',()=>$('#reset-dialog').showModal());
$('#confirm-reset').addEventListener('click',()=>{state={...scenarioState(1),logs:[]};selected='a';query='';persist();$('#reset-dialog').close();switchTab('overview');render();map.reset();toast('시연 상태와 기록을 초기화했습니다.');});
$('#report-village').required=false;
$('#report-village').insertAdjacentHTML('beforeend',VILLAGES.map(v=>`<option value="${v.id}">${v.name} · 마을 ${v.code}</option>`).join(''));
$('#extract-report').addEventListener('click',()=>{
 const text=$('#report-text').value.trim();if(!text){$('#report-text').focus();toast('먼저 신고 내용을 입력하세요.');return;}
 const result=extractReport(text);$('#report-village').value=result.village;$('#report-type').value=result.type;
 $('#extract-result').hidden=false;$('#extract-result').innerHTML=`<strong>${result.ambiguous?'위치를 확인해 주세요.':VILLAGES.find(v=>v.id===result.village).name+' 후보'}</strong><br>위험 유형: ${result.type}<br>${result.ambiguous?'명확한 마을을 찾지 못했습니다. 아래에서 선택하거나 위치 미확정으로 저장하세요.':'원문과 위치를 확인한 뒤 저장하세요.'}`;
});
$('#report-form').addEventListener('submit',event=>{
 event.preventDefault();const text=$('#report-text').value.trim();if(!text){toast('신고 내용을 입력하세요.');return;}
 addLog(text,{village:$('#report-village').value,type:$('#report-type').value,status:'미확인'});$('#report-dialog').close();switchTab('log');toast('미확인 신고로 저장했습니다. 도로 상태는 자동 변경되지 않습니다.');
});
window.addEventListener('resize',()=>map.resize());
render();map.init(state);registerTools();
if(!storageAvailable)toast('브라우저 저장 공간을 사용할 수 없어 이번 화면에서만 기록합니다.');
