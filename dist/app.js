import {VILLAGES,SHELTERS,ROADS,SCENARIOS,SOURCES} from './data.js';
import {scenarioState,analyzeAll,analyzeVillage,extractReport,exportCsv,csvCell} from './engine.js';
import {scenarioMinute,getOperationalContext,getVillageEvidence,confirmEvidence} from './operations.js';
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
    for(const [checks,items] of [['roadChecks',base.roads],['shelterChecks',base.shelters]]){
      base[checks]={};
      for(const id of Object.keys(items)){const value=saved[checks]?.[id];if(Number.isInteger(value)&&value>=0&&value<=scenarioMinute(base.scenario))base[checks][id]=value;}
    }
    const logs=Array.isArray(saved.logs)?saved.logs.filter(l=>l&&typeof l.id==='string'&&typeof l.text==='string'&&typeof l.time==='string').slice(0,100).map(l=>({id:l.id,text:l.text.slice(0,1000),time:l.time.slice(0,40),village:VILLAGES.some(v=>v.id===l.village)?l.village:'',type:String(l.type??'기타').slice(0,30),status:l.status==='확인 완료'?'확인 완료':'미확인',scenario:Number.isInteger(l.scenario)&&SCENARIOS[l.scenario]?l.scenario:base.scenario})):[];
    return {...base,logs};
  }catch{storageAvailable=false;return null;}
}
const initial=restore();
let state=initial??{...scenarioState(1),logs:[]};
let selected='a',tab='overview',query='',detailMode='route',toastTimer;
const map=new AccessMap({onSelect:id=>selectVillage(id,false),onShelter:id=>{switchTab('shelters');const el=$(`[data-facility-card="${id}"]`);el?.scrollIntoView({behavior:'smooth',block:'nearest'});}});
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));storageAvailable=true;}catch{storageAvailable=false;toast('저장 공간에 접근할 수 없어 이번 화면에서만 기록을 유지합니다.');}}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function stamp(){return new Date().toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
function addLog(text,{village=selected,type='상황 확인',status='확인 완료'}={}){
  state.logs.unshift({id:crypto.randomUUID(),text,village,type,status,time:stamp(),scenario:state.scenario});state.logs=state.logs.slice(0,100);persist();
}
function statusLabel(result){return `<span class="status-label ${result.status}">${result.label}</span>`;}
function header(title,description,extra=''){return `<div class="sidebar-header"><span class="eyebrow">운산면 비상근무</span><div class="sidebar-title"><h2>${title}</h2>${extra}</div><p class="sidebar-description">${description}</p></div>`;}
function renderBriefing(context){
 const priority=context.priorities[0],village=VILLAGES.find(v=>v.id===priority.id);
 return `<section class="briefing-card" aria-label="대응 브리핑"><div class="briefing-meta"><span>${icon('log')}대응 브리핑</span><small>훈련 ${context.clock}</small></div><button class="briefing-priority" data-select-village="${village.id}"><strong>${village.name}부터 확인</strong>${icon('arrow')}</button><p>${escape(priority.nextAction)}</p><div class="briefing-bottom"><span>규칙 기반 · 시연</span><button data-open-tab="log">미확인 신고 ${context.pendingReportCount}건 ↗</button></div></section>`;
}
function renderComparison(context){
 const comparison=context.comparison,labels={worsened:'확인 우선도 ↑',improved:'연결 상태 개선',same:'변화 없음'};
 return header('시나리오 비교','이전 기본 시나리오와 현재 입력 상태를 비교합니다.',`<span class="count">${comparison.changedCount}곳 변화</span>`)+
 `<div class="comparison-heading"><span>${escape(comparison.title)}</span><strong>현재 ${context.clock}</strong><p>현재 도로·시설의 수동 변경도 반영됩니다. 실제 재난의 시간별 관측 자료가 아닙니다.</p></div>`+
 comparison.rows.map(row=>{const village=VILLAGES.find(v=>v.id===row.id);return `<button class="comparison-card ${row.id===selected?'active':''}" data-select-village="${row.id}" aria-pressed="${row.id===selected}"><div><strong>${village.code} · ${village.name}</strong><small class="change-${row.change}">${labels[row.change]}</small></div><span class="comparison-status"><span class="${row.before.status}">${comparison.baselineScenario===null?'기준 없음':row.before.label}</span>${icon('arrow')}<span class="${row.after.status}">${row.after.label}</span></span></button>`;}).join('')+
 `<div class="sidebar-action"><p>‘연결 경로 있음’은 가상 도로망 계산 결과입니다. 실제 통행 안전을 보장하지 않습니다.</p><button class="button secondary full" data-open-tab="overview">대응 현황으로 돌아가기</button></div>`;
}
function renderSidebar(){
  const panel=$('#sidebar-content');
  if(tab==='overview'){
    const context=getOperationalContext(state,state.logs),counts=context.counts;
    panel.innerHTML=header('마을별 접근 현황','어느 마을을 먼저 확인해야 할까요?',`<span class="count">${VILLAGES.length}개 마을</span>`)+
    `<div class="summary-strip"><div class="summary-item blocked"><strong>${counts.blocked}</strong><span>연결 확인 불가</span></div><div class="summary-item unknown"><strong>${counts.unknown}</strong><span>추가 확인</span></div><div class="summary-item connected"><strong>${counts.connected}</strong><span>연결 경로 있음</span></div></div>`+renderBriefing(context)+`<div class="list-tools"><div class="search-box">${icon('search')}<input id="village-search" type="search" aria-label="마을 검색" placeholder="마을 이름 또는 A–D 검색" value="${escape(query)}"></div><div class="list-caption"><span>확인할 마을</span><small>확인 우선순</small></div></div><div class="village-list" id="village-list"></div><div class="sidebar-action"><button class="button primary full" data-report>${icon('plus')}현장 신고 기록</button><p>시연용 도로망 기준입니다.<br>마을을 선택해 판단 근거를 확인하세요.</p></div>`;
    renderVillageList();
    $('#village-search').addEventListener('input',e=>{query=e.target.value;renderVillageList();});
  }else if(tab==='comparison'){
    panel.innerHTML=renderComparison(getOperationalContext(state,state.logs));
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
  const q=query.trim().toLowerCase();
  const items=getOperationalContext(state,state.logs).priorities.map(r=>({...r,village:VILLAGES.find(v=>v.id===r.id)})).filter(r=>`${r.village.name} ${r.village.code} ${r.village.subtitle}`.toLowerCase().includes(q));
  $('#village-list').innerHTML=items.length?items.map(r=>`<button class="village-item ${r.id===selected?'active':''}" data-village="${r.id}" aria-pressed="${r.id===selected}"><span class="village-code">${r.village.code}</span><span class="village-copy"><strong>${r.village.name}</strong><small>${r.village.subtitle}${r.pendingReports?` · 신고 ${r.pendingReports}건 대기`:''}</small>${statusLabel(r)}</span><span class="chevron" aria-hidden="true">›</span></button>`).join(''):'<div class="empty-state">검색 결과가 없습니다.<br>원평리, 고풍리 또는 A–D를 입력하세요.</div>';
}
function renderEvidence(evidence){
 return `<div class="evidence-caption">훈련 기준 ${getOperationalContext(state).clock} · 확인 후 30분 초과 시 재확인</div><ol class="evidence-list">${evidence.items.map(item=>`<li><div class="evidence-title"><span>${icon(item.kind==='road'?'route':'home')}${escape(item.name)}</span><small class="${item.status}">${escape(item.label)}</small></div><p>${escape(item.source)}</p><div class="evidence-meta"><span>${item.checkedAt==='미확인'?'확인 시각 없음':`확인 ${item.checkedAt} · ${item.ageMinutes}분 전`}</span><strong class="freshness-${item.freshness}">${{recent:'최근 확인',stale:'재확인 필요',unknown:'판단 보류'}[item.freshness]}</strong></div>${item.status!=='unknown'?`<button class="reconfirm-button" data-reconfirm-id="${item.id}" data-reconfirm-kind="${item.kind}" aria-label="${escape(item.name)} 같은 상태로 재확인">같은 상태로 재확인 ${icon('check')}</button>`:''}</li>`).join('')}</ol><details class="checklist"><summary>현장 확인 체크리스트</summary><ul>${evidence.checklist.map(line=>`<li>${escape(line)}</li>`).join('')}</ul></details><p class="evidence-disclaimer">시각과 출처는 훈련 데이터입니다. 실제 관측 자료의 갱신 시각이 아닙니다.</p>`;
}
function renderDetail(){
 const village=VILLAGES.find(v=>v.id===selected),result=analyzeVillage(selected,state),shelter=SHELTERS.find(s=>s.id===result.route?.target),evidence=getVillageEvidence(selected,state,state.logs);
 const adjacent=ROADS.filter(r=>r.from===selected||r.to===selected);
 const route=`<div class="route-result ${result.status}"><strong>${result.route?`${shelter.name} 연결 ${result.status==='unknown'?'후보':'경로'}`:'개방 시설 연결 확인 불가'}</strong><small>${result.route?`시연 선형 기준 ${(result.route.distance/1000).toFixed(1)} km · ${result.route.edges.length}개 구간`:'도로·시설 상태를 추가로 확인하세요.'}</small></div><p>${result.reason}</p><details class="road-controls"><summary>관련 도로 ${adjacent.length}개 · 상태 바꾸기</summary>${adjacent.map(r=>`<div class="road-control"><label for="road-${r.id}">${r.name} · 시연</label><select id="road-${r.id}" data-road="${r.id}" aria-label="${r.name} 상태"><option value="open" ${state.roads[r.id]==='open'?'selected':''}>통행 가능 · 시연</option><option value="unknown" ${state.roads[r.id]==='unknown'?'selected':''}>미확인</option><option value="closed" ${state.roads[r.id]==='closed'?'selected':''}>통제 · 시연</option></select></div>`).join('')}</details>`;
 $('#detail-panel').innerHTML=`<div class="detail-head"><div class="detail-topline"><span>${icon('pin')}선택 마을 · ${village.code}</span><button id="expand-detail" aria-expanded="${$('#detail-panel').classList.contains('expanded')}" aria-label="마을 상세 펼치기 또는 접기">상세 ↕</button></div><h2>${village.name}</h2>${statusLabel(result)}</div><div class="detail-tabs" role="group" aria-label="마을 상세 보기"><button data-detail="route" class="${detailMode==='route'?'active':''}" aria-pressed="${detailMode==='route'}">접근 경로</button><button data-detail="evidence" class="${detailMode==='evidence'?'active':''}" aria-pressed="${detailMode==='evidence'}">확인 근거 <span>${evidence.items.length}</span></button></div><div class="detail-body">${detailMode==='evidence'?renderEvidence(evidence):route}<div class="next-action"><small>다음 확인</small><p>${escape(evidence.nextAction)}</p>${evidence.pendingReports?`<button data-open-tab="log">미확인 신고 ${evidence.pendingReports}건 보기 ↗</button>`:''}</div><div class="detail-footer"><button class="button secondary" id="record-check">${icon('check')}검토 기록</button><button class="button primary" data-report>${icon('plus')}신고 추가</button></div><small class="detail-note">시연 시설·도로 기준입니다. 실제 이동 전 현장 확인이 필요합니다.</small></div>`;
}
function renderMapContext(){
 const context=getOperationalContext(state,state.logs);
 $('#map-context').innerHTML=`<span>훈련 기준 <strong>${context.clock}</strong></span><span class="context-divider"></span><span>신고 확인 대기 <strong>${context.pendingReportCount}</strong>건</span>${icon('arrow')}`;
}
function render(){renderSidebar();renderDetail();renderMapContext();map.update(state,selected);document.querySelectorAll('[data-scenario]').forEach(el=>{const active=Number(el.dataset.scenario)===state.scenario;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});}
function switchTab(next){tab=next;document.querySelectorAll('[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===tab);el.setAttribute('aria-pressed',String(el.dataset.tab===tab));});renderSidebar();$('#sidebar-content').scrollTop=0;if(window.innerWidth<=760)setMobile('list');}
function selectVillage(id,move=true){if(!VILLAGES.some(v=>v.id===id))return;selected=id;renderDetail();$('#detail-panel').scrollTop=0;if(tab==='overview')renderVillageList();if(tab==='comparison')renderSidebar();map.update(state,selected);if(move)map.focus(id);if(window.innerWidth<=760)setMobile('map');}
function setMobile(mode){$('#workspace').classList.toggle('show-map',mode==='map');document.querySelectorAll('[data-mobile]').forEach(el=>{el.classList.toggle('active',el.dataset.mobile===mode);el.setAttribute('aria-pressed',String(el.dataset.mobile===mode));});requestAnimationFrame(()=>map.resize());}
function changeScenario(id){if(!Number.isInteger(id)||!SCENARIOS[id])throw Error('유효하지 않은 시나리오입니다.');state={...scenarioState(id),logs:state.logs};persist();render();toast(`${SCENARIOS[id].time} ${SCENARIOS[id].title} 시나리오를 적용했습니다.`);}
function openReport(){const form=$('#report-form');form.reset();$('#report-village').value=selected;$('#extract-result').hidden=true;$('#report-dialog').showModal();$('#report-text').focus();}
function changeRoad(id,value){if(!ROADS.some(r=>r.id===id)||!ALLOWED.includes(value))return;state.roads[id]=value;(state.roadChecks??={})[id]=scenarioMinute(state.scenario);const names={open:'통행 가능',closed:'통제',unknown:'미확인'};addLog(`${ROADS.find(r=>r.id===id).name}의 시연 상태를 '${names[value]}'으로 변경했습니다.`,{type:'도로 상태 변경'});render();toast('도로 상태를 반영해 연결을 다시 계산했습니다.');}
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
 const village=event.target.closest('.village-item,[data-select-village]');if(village)selectVillage(village.dataset.village??village.dataset.selectVillage);
 const reconfirm=event.target.closest('[data-reconfirm-id]');
 if(reconfirm){const kind=reconfirm.dataset.reconfirmKind,id=reconfirm.dataset.reconfirmId;const updated=confirmEvidence(kind,id,state);if(updated!==state){state=updated;const item=(kind==='road'?ROADS:SHELTERS).find(item=>item.id===id);addLog(`${item.name}: 같은 시연 상태로 재확인했습니다. 훈련 확인 시각 ${getOperationalContext(state).clock}`,{type:'근거 재확인'});render();toast('선택한 근거의 훈련 확인 시각을 갱신했습니다.');}}
 const tabButton=event.target.closest('[data-open-tab]');if(tabButton)switchTab(tabButton.dataset.openTab);
 const detailButton=event.target.closest('[data-detail]');if(detailButton){detailMode=detailButton.dataset.detail;renderDetail();}
 if(event.target.closest('#expand-detail')){const expanded=$('#detail-panel').classList.toggle('expanded');$('#expand-detail').setAttribute('aria-expanded',String(expanded));}
 const log=event.target.closest('[data-confirm-log]');if(log){const entry=state.logs.find(l=>l.id===log.dataset.confirmLog);if(entry){entry.status='확인 완료';entry.text+=' [사용자가 확인 완료로 표시]';persist();render();toast('확인 완료로 기록했습니다. 도로 상태는 별도로 확인해 주세요.');}}
 if(event.target.closest('#record-check')){const result=analyzeVillage(selected,state);addLog(`시연 시나리오에서 '${result.label}' 상태를 검토했습니다. ${result.reason}`);render();toast('검토 기록을 저장했습니다. 개별 근거의 확인 시각은 재확인 버튼으로 갱신하세요.');}
});
document.addEventListener('change',event=>{
 const road=event.target.dataset.road;if(road)changeRoad(road,event.target.value);
 const shelter=event.target.dataset.shelter;if(SHELTERS.some(s=>s.id===shelter)&&ALLOWED.includes(event.target.value)){state.shelters[shelter]=event.target.value;(state.shelterChecks??={})[shelter]=scenarioMinute(state.scenario);addLog(`${SHELTERS.find(s=>s.id===shelter).name}의 시연 운영 상태를 변경했습니다.`,{village:'',type:'시설 상태 변경'});render();toast('시설 상태를 반영해 연결을 다시 계산했습니다.');}
});
for(const view of ['2d','3d'])$('#view-'+view).addEventListener('click',()=>{map.setView(view);['2d','3d'].forEach(v=>{$('#view-'+v).classList.toggle('active',v===view);$('#view-'+v).setAttribute('aria-pressed',String(v===view));});});
$('#map-zoom-in').addEventListener('click',()=>map.zoom(1));$('#map-zoom-out').addEventListener('click',()=>map.zoom(-1));$('#map-north').addEventListener('click',()=>map.north());$('#map-reset').addEventListener('click',()=>map.reset());
$('#building-retry').addEventListener('click',()=>map.loadBuildings());
$('#building-focus').addEventListener('click',()=>{map.setLayer('buildings',true);$('[data-layer="buildings"]').checked=true;map.focusBuildings();$('#layer-panel').hidden=true;$('#layer-button').setAttribute('aria-expanded','false');});
$('#layer-button').addEventListener('click',()=>{const panel=$('#layer-panel');panel.hidden=!panel.hidden;$('#layer-button').setAttribute('aria-expanded',String(!panel.hidden));});
document.querySelectorAll('[data-layer]').forEach(el=>el.addEventListener('change',()=>{map.setLayer(el.dataset.layer,el.checked);document.querySelectorAll('[data-preset]').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-pressed','false');});}));
const layerPresets={field:{flood:false,roads:true,shelters:true,buildings:true,reports:true},connection:{flood:true,roads:true,shelters:true,buildings:true,reports:true},terrain:{flood:false,roads:false,shelters:false,buildings:true,reports:false}};
document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>{
 for(const [key,enabled] of Object.entries(layerPresets[button.dataset.preset])){map.setLayer(key,enabled);$(`[data-layer="${key}"]`).checked=enabled;}
 document.querySelectorAll('[data-preset]').forEach(el=>{el.classList.toggle('active',el===button);el.setAttribute('aria-pressed',String(el===button));});
}));
$('#data-note').addEventListener('click',()=>switchTab('sources'));
let exportUrl;
$('#export').addEventListener('click',()=>{
 if(exportUrl)URL.revokeObjectURL(exportUrl);
 const context=getOperationalContext(state,state.logs);
 const extra=[[],['대응 브리핑 · 규칙 기반 시연',context.clock],...context.briefing.lines.map(line=>[line]),[],['마을','다음 확인','근거 이름','시연 상태','출처','훈련 확인 시각','최신성']];
 for(const village of VILLAGES){const evidence=getVillageEvidence(village.id,state,state.logs);for(const item of evidence.items)extra.push([village.name,evidence.nextAction,item.name,item.label,item.source,item.checkedAt,{recent:'최근 확인',stale:'재확인 필요',unknown:'판단 보류'}[item.freshness]]);}
 const csv=exportCsv(state,state.logs)+'\r\n'+extra.map(row=>row.map(csvCell).join(',')).join('\r\n');$('#export-csv').value=csv;
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
 addLog(text,{village:$('#report-village').value,type:$('#report-type').value,status:'미확인'});$('#report-dialog').close();switchTab('log');render();toast('미확인 신고로 저장했습니다. 도로 상태는 자동 변경되지 않습니다.');
});
window.addEventListener('resize',()=>map.resize());
render();map.init(state);registerTools();
if(!storageAvailable)toast('브라우저 저장 공간을 사용할 수 없어 이번 화면에서만 기록합니다.');
