import {NODES,ROADS,SHELTERS,VILLAGES} from './data.js';
import {getSituationEvidence} from './operations.js';

export const SOURCE_MODES=['all','evidence','reports'];
export function sourceLayerVisible(key,enabled,mode='all'){
 if(!enabled)return false;
 if(key==='reports')return mode!=='evidence';
 if(['roads','shelters','flood'].includes(key))return mode!=='reports';
 return true;
}

export function getSituationSummary(state){
 const evidence=getSituationEvidence(state),logs=state.logs??[];
 const reports=logs.filter(log=>log.status==='미확인');
 const counts={closedRoads:0,unknownRoads:0,openShelters:0,stale:0,unknown:0,pending:reports.length,unlocated:reports.filter(log=>!VILLAGES.some(v=>v.id===log.village)).length};
 for(const item of evidence){
  if(item.kind==='road'&&item.status==='closed')counts.closedRoads++;
  if(item.kind==='road'&&item.status==='unknown')counts.unknownRoads++;
  if(item.kind==='shelter'&&item.status==='open')counts.openShelters++;
  if(item.freshness==='stale')counts.stale++;
  if(item.freshness==='unknown')counts.unknown++;
 }
 const incidents=evidence.filter(item=>item.kind==='road'&&(item.status!=='open'||item.freshness==='stale'));
 incidents.sort((a,b)=>({closed:0,unknown:1,open:2}[a.status]-{closed:0,unknown:1,open:2}[b.status])||a.id.localeCompare(b.id));
 return {counts,evidence,incidents};
}

export function roadCenter(id){
 const points=ROADS.find(road=>road.id===id)?.coordinates;
 return points?.[Math.floor(points.length/2)];
}

// Search the prototype's named places only; no live geocoder or precise report location is inferred.
export function searchPlaces(query){
 const q=String(query).trim().toLocaleLowerCase('ko-KR');
 if(!q)return [];
 const places=[
  ...VILLAGES.map(v=>({id:v.id,kind:'village',name:v.name,type:'시연 마을',detail:`마을 ${v.code}`,center:NODES[v.id],terms:`${v.name} ${v.code} ${v.subtitle}`})),
  ...ROADS.map(r=>({id:r.id,kind:'road',name:r.name,type:'시연 도로',detail:'상태·확인 근거',center:roadCenter(r.id),terms:r.name})),
  ...SHELTERS.map(s=>({id:s.id,kind:'shelter',name:s.name,type:'시연 시설',detail:s.subtitle,center:NODES[s.id],terms:`${s.name} ${s.subtitle}`}))
 ];
 return places.filter(place=>place.terms.toLocaleLowerCase('ko-KR').includes(q));
}
