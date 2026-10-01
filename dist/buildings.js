export const BUILDING_SERVICE='https://portal.esrikr.com/arcgis/rest/services/MOIS_KR_Buildings_v2/FeatureServer/0/query';
export const BUILDING_SOURCE_URL='https://www.arcgis.com/home/item.html?id=b2c7a37bac8d4e40a85435b3f3d96d05';
export const BUILDING_AREA="sig_cd='44210' AND emd_cd='380'"; // 서산시 운산면
const FIELDS='objectid,building_id,building_name,gro_flo_co,und_flo_co,street_name,house_number';

// Load the source inventory first, then verify every requested ID before rendering.
// Geometry stays in memory for online visualization; it is not exported or cached offline.
export async function loadOfficialBuildings({fetcher=globalThis.fetch,onProgress=()=>{}}={}){
 async function query(params){
  const response=await fetcher(BUILDING_SERVICE,{method:'POST',body:new URLSearchParams(params),signal:AbortSignal.timeout(30000),credentials:'omit'});
  if(!response.ok)throw Error('Building service unavailable');
  const result=await response.json();
  if(result.error||result.exceededTransferLimit||result.properties?.exceededTransferLimit)throw Error('Incomplete building response');
  return result;
 }
 const inventory=await query({f:'json',where:BUILDING_AREA,returnIdsOnly:'true'});
 const ids=inventory.objectIds;
 if(!Array.isArray(ids)||!ids.length||ids.some(id=>!Number.isSafeInteger(id))||new Set(ids).size!==ids.length)throw Error('Invalid building inventory');
 onProgress(0,ids.length);
 const features=[];
 for(let offset=0;offset<ids.length;offset+=1000){
  const batch=ids.slice(offset,offset+1000),expected=new Set(batch);
  const result=await query({f:'geojson',where:BUILDING_AREA,objectIds:batch.join(','),outFields:FIELDS,outSR:'4326',returnGeometry:'true'});
  buildingSummary(result);
  if(result.features.length!==batch.length||result.features.some(feature=>!expected.has(feature.id)))throw Error('Missing building geometry');
  features.push(...result.features);
  onProgress(features.length,ids.length);
 }
 const data={type:'FeatureCollection',features};
 buildingSummary(data);
 return data;
}

// Keep every source footprint visible at every supported zoom; floor counts are not heights.
export function buildingLayers(){
 return [
  {id:'actual-buildings-fill',type:'fill',source:'actual-buildings',paint:{'fill-color':'#8297a6','fill-opacity':.85}},
  {id:'actual-buildings-line',type:'line',source:'actual-buildings',paint:{'line-color':'#4d6576','line-width':['interpolate',['linear'],['zoom'],10,.5,16,1]}}
 ];
}

export function buildingSummary(data){
 if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||!data.features.length)throw Error('Empty building dataset');
 const ids=new Set();
 for(const feature of data.features){
  if(!Number.isSafeInteger(feature.id)||ids.has(feature.id)||!['Polygon','MultiPolygon'].includes(feature.geometry?.type))throw Error('Invalid building dataset');
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  if(!Array.isArray(polygons)||!polygons.length)throw Error('Missing building polygon');
  for(const polygon of polygons){
   if(!Array.isArray(polygon)||!polygon.length)throw Error('Missing building ring');
   for(const ring of polygon){
    if(!Array.isArray(ring)||ring.length<4||ring.some(point=>!Array.isArray(point)||point.length<2||!Number.isFinite(point[0])||!Number.isFinite(point[1])||Math.abs(point[0])>180||Math.abs(point[1])>90))throw Error('Invalid building coordinates');
    if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error('Unclosed building ring');
   }
  }
  ids.add(feature.id);
 }
 return {count:data.features.length};
}

export function nearestBuildingCenter(data,point){
 let best=null,distance=Infinity;
 for(const feature of data.features){
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  const ring=polygons[0][0];
  const center=ring.slice(0,-1).reduce((sum,p)=>[sum[0]+p[0]/(ring.length-1),sum[1]+p[1]/(ring.length-1)],[0,0]);
  const d=((center[0]-point[0])*Math.cos(point[1]*Math.PI/180))**2+(center[1]-point[1])**2;
  if(d<distance){distance=d;best=center;}
 }
 return best;
}
