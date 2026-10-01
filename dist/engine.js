import { NODES, ROADS, VILLAGES, SHELTERS, SCENARIOS } from './data.js';

export function segmentDistance(a,b) {
  const rad=x=>x*Math.PI/180, p=rad(b[1]-a[1]), q=rad(b[0]-a[0]);
  const h=Math.sin(p/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(q/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function roadLength(road) {return road.coordinates.slice(1).reduce((n,p,i)=>n+segmentDistance(road.coordinates[i],p),0);}
export function scenarioState(id) {
  const s=SCENARIOS.find(s=>s.id===id)??SCENARIOS[1];
  return {scenario:s.id,roads:Object.fromEntries(ROADS.map(r=>[r.id,s.roads[r.id]??'open'])),shelters:{...s.shelters}};
}
export function findPath(start, targets, states, allowUnknown=false) {
  if(!NODES[start]||targets.length===0)return null;
  const distances={[start]:0},previous={},visited=new Set();
  while(true){
    const current=Object.keys(distances).filter(x=>!visited.has(x)).sort((a,b)=>distances[a]-distances[b])[0];
    if(!current)return null;
    if(targets.includes(current)) {
      const nodes=[current],edges=[]; let c=current;
      while(previous[c]) {edges.unshift(previous[c].edge);c=previous[c].from;nodes.unshift(c);}
      return {target:current,nodes,edges,distance:distances[current]};
    }
    visited.add(current);
    for(const r of ROADS) {
      const status=states[r.id]??'unknown';
      if(status==='closed'||(!allowUnknown&&status!=='open'))continue;
      const next=r.from===current?r.to:r.to===current?r.from:null;
      if(!next||visited.has(next))continue;
      const d=distances[current]+roadLength(r);
      if(d<(distances[next]??Infinity)){distances[next]=d;previous[next]={from:current,edge:r.id};}
    }
  }
}
export function analyzeVillage(id,state) {
  const open=SHELTERS.filter(s=>state.shelters[s.id]==='open').map(s=>s.id);
  const route=findPath(id,open,state.roads);
  if(route)return {id,status:'connected',label:'연결 경로 있음',route,reason:'통제·미확인 구간을 제외한 시연 경로입니다.'};
  const possible=SHELTERS.filter(s=>state.shelters[s.id]!=='closed').map(s=>s.id);
  const candidate=findPath(id,possible,state.roads,true);
  if(candidate)return {id,status:'unknown',label:'추가 확인 필요',route:candidate,reason:'후보 경로의 도로 또는 시설 상태가 확인되지 않았습니다.'};
  return {id,status:'blocked',label:'연결 확인 불가',route:null,reason:'입력된 도로망에서 개방 시설까지 연결을 찾지 못했습니다.'};
}
export function analyzeAll(state){return VILLAGES.map(v=>analyzeVillage(v.id,state));}
export function extractReport(text) {
  const matched=VILLAGES.filter(v=>new RegExp(`마을\\s*${v.code}|${v.name}`).test(text));
  const type=/침수|물[이가]?\s*찼|물에/.test(text)?'침수 제보':/대피|시설|개방/.test(text)?'시설 확인':/통제|교량|다리|통행/.test(text)?'통행 장애':'기타';
  return {village:matched.length===1?matched[0].id:'',type,ambiguous:matched.length!==1};
}
export function csvCell(value){let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function exportCsv(state,logs) {
 const scenarioLabel=id=>{const s=SCENARIOS.find(s=>s.id===id);return s?`${s.time} ${s.title}`:'미기록';};
 const rows=[['시연용 인계표 — 실제 재난정보 아님'],['시나리오',scenarioLabel(state.scenario)],['마을','연결 상태','시설','경로','확인 기록 (전체 시나리오)']];
 for(const v of VILLAGES){const a=analyzeVillage(v.id,state);rows.push([v.name+' (시연)',a.label,a.route?SHELTERS.find(s=>s.id===a.route.target).name:'확인 불가',a.route?a.route.edges.map(id=>ROADS.find(r=>r.id===id).name).join(' / '):'',logs.filter(l=>l.village===v.id).map(l=>`${l.time} [${scenarioLabel(l.scenario)}] ${l.status}: ${l.text}`).join(' | ')]);}
 rows.push([],['전체 기록','마을','유형','상태','기록 시각','기록 당시 시나리오']);
 for(const l of logs)rows.push([l.text,VILLAGES.find(v=>v.id===l.village)?.name??'위치 미확정',l.type,l.status,l.time,scenarioLabel(l.scenario)]);
 return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}
