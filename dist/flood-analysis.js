export const DEPTH_BANDS = [
  {min:0,max:0.5,color:'#d7f2ff',label:'0–<0.5'},
  {min:0.5,max:1,color:'#5fb8ea',label:'0.5–<1'},
  {min:1,max:2,color:'#2677d8',label:'1–<2'},
  {min:2,max:5,color:'#5c4ac8',label:'2–<5'},
  {min:5,max:Infinity,color:'#5b218c',label:'5 이상'}
];

const EXTENDED_BBOX = [126.55,36.70,126.70,36.85];
const DEMO_BBOX = {minLon:126.627,maxLon:126.633,minLat:36.763,maxLat:36.769};
const EPS = 1e-10;
const MAX_RING_COORDINATES = 2000;
const ALLOWED_HIGHWAYS = new Set([
  'primary','secondary','tertiary','unclassified','residential','service',
  'living_street','road','track','primary_link','secondary_link','tertiary_link'
]);

export function depthColor(depth){
  const value = Number(depth);
  const band = DEPTH_BANDS.find(item => value >= item.min && value < item.max) ?? DEPTH_BANDS.at(-1);
  return band.color;
}

export function validateDepthCollection(input){
  if(!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) throw Error('GeoJSON FeatureCollection 형식이어야 합니다');
  if(input.features.length === 0) throw Error('수심 도형이 1개 이상 필요합니다');
  if(input.features.length > 1000) throw Error('수심 도형은 1000개 이하만 처리합니다');
  const metadata = normalizeMetadata(input.metadata);
  let coordinateCount = 0;
  const features = input.features.map((feature,index) => {
    if(!feature || feature.type !== 'Feature') throw Error(`${index+1}번째 항목이 Feature 형식이 아닙니다`);
    const depth = feature.properties?.depth_m;
    if(typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0 || depth > 30) throw Error(`${index+1}번째 항목의 depth_m은 0 이상 30 이하 숫자여야 합니다`);
    const geometry = validateDepthGeometry(feature.geometry,index+1);
    coordinateCount += countCoordinates(geometry);
    if(coordinateCount > 50000) throw Error('수심 좌표는 전체 50000개 이하만 처리합니다');
    return {
      type:'Feature',
      id:`depth-${index+1}`,
      properties:normalizeExactDepthProperties(feature.properties,depth),
      geometry
    };
  });
  return {type:'FeatureCollection',metadata,features};
}

export function createDemoFlood(level=1){
  const scenarioLevel = Math.max(0,Math.min(2,Number.isFinite(Number(level)) ? Math.trunc(Number(level)) : 1));
  const cols = 8;
  const rows = 6;
  const lonStep = (DEMO_BBOX.maxLon - DEMO_BBOX.minLon) / cols;
  const latStep = (DEMO_BBOX.maxLat - DEMO_BBOX.minLat) / rows;
  const centerCol = 3.5;
  const centerRow = 2.5;
  const radius = [2.95,3.25,3.85][scenarioLevel];
  const features = [];

  for(let row=0; row<rows; row++){
    for(let col=0; col<cols; col++){
      const dx = (col - centerCol) / 1.25;
      const dy = row - centerRow;
      if(Math.hypot(dx,dy) > radius) continue;
      const lon1 = roundCoord(DEMO_BBOX.minLon + col * lonStep);
      const lon2 = roundCoord(DEMO_BBOX.minLon + (col + 1) * lonStep);
      const lat1 = roundCoord(DEMO_BBOX.minLat + row * latStep);
      const lat2 = roundCoord(DEMO_BBOX.minLat + (row + 1) * latStep);
      const depth = roundDepth(0.2 + scenarioLevel * 0.35 + Math.max(0,radius - Math.hypot(dx,dy)) * 0.42 + ((col + row) % 3) * 0.12);
      features.push({
        type:'Feature',
        id:`demo-depth-${features.length+1}`,
        properties:{depth_m:Math.min(2.5,depth),scenario_level:scenarioLevel},
        geometry:{type:'Polygon',coordinates:[[[lon1,lat1],[lon2,lat1],[lon2,lat2],[lon1,lat2],[lon1,lat1]]]}
      });
    }
  }

  return {
    type:'FeatureCollection',
    metadata:{
      title:'운산면 합성 침수 시나리오',
      source:'기능 검증용 합성 도형·수심',
      scenario:['낮은 수심 예시','중간 수심 예시','높은 수심 예시'][scenarioLevel],
      kind:'demo',
      official:false
    },
    features
  };
}

export function pointDepth(point,fc){
  const depths = [];
  for(const feature of fc?.features ?? []){
    const depth = feature.properties?.depth_m;
    if(typeof depth !== 'number') continue;
    if(pointInGeometry(point,feature.geometry)) depths.push(depth);
  }
  return depths.length ? Math.max(...depths) : null;
}

export function analyzeRoadExposure(roads,depths,threshold=0.5){
  const excludedIds = [];
  let intersected = 0;
  let bridges = 0;
  let uncertain = 0;
  const depthCandidates = (depths?.features ?? []).map(feature => ({
    feature,
    bounds:geometryBounds(feature.geometry)
  }));
  const features = (roads?.features ?? []).map(feature => {
    const copied = clone(feature);
    const roadId = roadIdentity(copied);
    const bridge = isBridge(copied);
    let exposure = null;
    const roadBounds = geometryBounds(copied.geometry);
    for(const {feature:depthFeature,bounds:depthBounds} of depthCandidates){
      if(!boundsIntersect(roadBounds,depthBounds)) continue;
      if(lineIntersectsGeometry(copied.geometry,depthFeature.geometry,roadBounds,depthBounds)){
        exposure = mergeExposure(exposure,depthFeature.properties);
      }
    }
    let impact = 'outside';
    if(exposure){
      intersected++;
      if(exposure.uncertain) uncertain++;
      if(bridge){
        impact = 'bridge-review';
        bridges++;
      }else{
        impact = intervalImpact(exposure,threshold);
      }
    }
    if(impact === 'excluded' || impact === 'bridge-review') excludedIds.push(roadId);
    if(impact === 'depth-review') excludedIds.push(roadId);
    copied.properties = {...copied.properties,...exposureProperties(exposure),impact};
    return copied;
  });
  return {
    type:'FeatureCollection',
    features,
    excludedIds,
    summary:{total:features.length,intersected,excluded:excludedIds.length,bridges,uncertain}
  };
}

export function compareRoutes(roads,exposure,originPoint,destinationPoint,options={}){
  const graph = buildGraph(roads);
  const originSnap = snapPoint(originPoint,graph.nodes);
  const destinationSnap = snapPoint(destinationPoint,graph.nodes);
  const snaps = {
    origin: originSnap ? {point:originSnap.point,distanceM:roundMeters(originSnap.distanceM)} : {point:null,distanceM:null},
    destination: destinationSnap ? {point:destinationSnap.point,distanceM:roundMeters(destinationSnap.distanceM)} : {point:null,distanceM:null}
  };
  if(!originSnap || !destinationSnap) return {before:emptyRoute('unmatched'),after:emptyRoute('unmatched'),snaps};

  const sameSnap = originSnap.key === destinationSnap.key;
  const before = sameSnap
    ? samePointRoute(originPoint,destinationPoint,originSnap.key,originSnap.point)
    : shortestRoute(graph,originSnap,destinationSnap,new Set(),originPoint,destinationPoint);

  const excluded = new Set(exposure?.excludedIds ?? []);
  const afterBlocked = connectorsBlocked(originPoint,originSnap.point,destinationPoint,destinationSnap.point,options);
  const after = sameSnap && !afterBlocked
    ? samePointRoute(originPoint,destinationPoint,originSnap.key,originSnap.point)
    : afterBlocked ? emptyRoute('no-path') : shortestRoute(graph,originSnap,destinationSnap,excluded,originPoint,destinationPoint);

  return {before,after,snaps};
}

function normalizeMetadata(metadata){
  if(!metadata || typeof metadata !== 'object') throw Error('수심 자료 메타데이터가 필요합니다');
  const {title,source,scenario,kind,source_url} = metadata;
  if(typeof title !== 'string' || !title.trim()) throw Error('metadata.title이 필요합니다');
  if(typeof source !== 'string' || !source.trim()) throw Error('metadata.source가 필요합니다');
  if(typeof scenario !== 'string' || !scenario.trim()) throw Error('metadata.scenario가 필요합니다');
  const normalized = {title,source,scenario,kind:'imported',official:false};
  if(source_url !== undefined){
    if(typeof source_url !== 'string' || !source_url.trim()) throw Error('metadata.source_url은 문자열이어야 합니다');
    normalized.source_url = source_url;
  }
  return normalized;
}

function normalizeExactDepthProperties(properties={},depth){
  const {name} = properties;
  const normalized = {depth_m:depth};
  if(typeof name === 'string' && name.trim()) normalized.name = name;
  return name in normalized ? {name:normalized.name,depth_m:normalized.depth_m} : normalized;
}

function validateDepthGeometry(geometry,featureNumber){
  if(!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) throw Error(`${featureNumber}번째 도형은 Polygon 또는 MultiPolygon이어야 합니다`);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if(!Array.isArray(polygons) || !polygons.length) throw Error(`${featureNumber}번째 도형에 폴리곤이 없습니다`);
  const normalized = polygons.map((polygon,polygonIndex) => {
    if(!Array.isArray(polygon) || !polygon.length) throw Error(`${featureNumber}번째 도형의 ${polygonIndex+1}번째 폴리곤에 링이 없습니다`);
    return polygon.map((ring,ringIndex) => validateRing(ring,featureNumber,ringIndex));
  });
  return geometry.type === 'Polygon'
    ? {type:'Polygon',coordinates:normalized[0]}
    : {type:'MultiPolygon',coordinates:normalized};
}

function validateRing(ring,featureNumber,ringIndex){
  if(!Array.isArray(ring) || ring.length < 4) throw Error(`${featureNumber}번째 도형의 ${ringIndex+1}번째 링은 좌표가 너무 적습니다`);
  if(ring.length > MAX_RING_COORDINATES) throw Error(`${featureNumber}번째 도형의 ${ringIndex+1}번째 링은 좌표가 너무 많습니다`);
  const normalized = ring.map((coordinate,coordinateIndex) => {
    if(!Array.isArray(coordinate) || coordinate.length < 2) throw Error(`${featureNumber}번째 도형의 ${coordinateIndex+1}번째 좌표가 잘못됐습니다`);
    const [lon,lat] = coordinate;
    if(typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) throw Error('수심 좌표는 유한한 숫자여야 합니다');
    if(lon < EXTENDED_BBOX[0] || lon > EXTENDED_BBOX[2] || lat < EXTENDED_BBOX[1] || lat > EXTENDED_BBOX[3]) throw Error('수심 좌표가 지원 지역 범위를 벗어났습니다');
    return [lon,lat];
  });
  if(!sameCoord(normalized[0],normalized.at(-1))) throw Error('수심 도형 링은 닫혀 있어야 합니다');
  if(Math.abs(ringArea(normalized)) < EPS) throw Error('수심 도형 링은 면적을 가져야 합니다');
  if(ringSelfIntersects(normalized)) throw Error('수심 도형 링은 스스로 교차하면 안 됩니다');
  return normalized;
}

function countCoordinates(geometry){
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  return rings.reduce((sum,ring) => sum + ring.length,0);
}

function pointInGeometry(point,geometry){
  if(!geometry) return false;
  if(geometry.type === 'Polygon') return pointInPolygon(point,geometry.coordinates);
  if(geometry.type === 'MultiPolygon') return geometry.coordinates.some(polygon => pointInPolygon(point,polygon));
  return false;
}

function pointInPolygon(point,polygon){
  if(!polygon?.length || !pointInRing(point,polygon[0])) return false;
  return !polygon.slice(1).some(ring => pointInRing(point,ring));
}

function pointInRing(point,ring){
  let inside = false;
  for(let i=0,j=ring.length-1; i<ring.length; j=i++){
    const a = ring[i], b = ring[j];
    if(pointOnSegment(point,a,b)) return true;
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]);
    if(crosses){
      const x = (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0];
      if(point[0] < x) inside = !inside;
    }
  }
  return inside;
}

function lineIntersectsGeometry(lineGeometry,polygonGeometry,lineBounds=geometryBounds(lineGeometry),polygonBounds=geometryBounds(polygonGeometry)){
  if(!boundsIntersect(lineBounds,polygonBounds)) return false;
  for(const line of lineStrings(lineGeometry)){
    for(let i=1; i<line.length; i++){
      const segmentBounds = segmentBoundsFor(line[i-1],line[i]);
      if(!boundsIntersect(segmentBounds,polygonBounds)) continue;
      if(segmentIntersectsGeometry(line[i-1],line[i],polygonGeometry,segmentBounds)) return true;
    }
  }
  return false;
}

function segmentIntersectsGeometry(a,b,geometry,segmentBounds=segmentBoundsFor(a,b)){
  if(!geometry) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(polygon => {
    const polygonBounds = polygonRingsBounds(polygon);
    return boundsIntersect(segmentBounds,polygonBounds) && segmentIntersectsPolygon(a,b,polygon,segmentBounds);
  });
}

function segmentIntersectsPolygon(a,b,polygon,segmentBounds=segmentBoundsFor(a,b)){
  if(!boundsIntersect(segmentBounds,polygonRingsBounds(polygon))) return false;
  if(pointInPolygon(a,polygon) || pointInPolygon(b,polygon) || pointInPolygon(midpoint(a,b),polygon)) return true;
  const intersections = [];
  for(let r=0; r<polygon.length; r++){
    const ring = polygon[r];
    for(let i=1; i<ring.length; i++){
      if(!boundsIntersect(segmentBounds,segmentBoundsFor(ring[i-1],ring[i]))) continue;
      if(segmentsIntersect(a,b,ring[i-1],ring[i])){
        intersections.push(r);
      }
    }
  }
  if(!intersections.length) return false;
  if(intersections.some(r => r === 0)) return true;
  return false;
}

function lineStrings(geometry){
  if(!geometry) return [];
  if(geometry.type === 'LineString') return [geometry.coordinates ?? []];
  if(geometry.type === 'MultiLineString') return geometry.coordinates ?? [];
  return [];
}

function geometryBounds(geometry){
  const coordinates = [];
  if(!geometry) return null;
  if(geometry.type === 'LineString') coordinates.push(...(geometry.coordinates ?? []));
  else if(geometry.type === 'MultiLineString') for(const line of geometry.coordinates ?? []) coordinates.push(...line);
  else if(geometry.type === 'Polygon') for(const ring of geometry.coordinates ?? []) coordinates.push(...ring);
  else if(geometry.type === 'MultiPolygon') for(const polygon of geometry.coordinates ?? []) for(const ring of polygon) coordinates.push(...ring);
  return coordinatesBounds(coordinates);
}

function polygonRingsBounds(polygon){
  return coordinatesBounds((polygon ?? []).flat());
}

function coordinatesBounds(coordinates){
  if(!coordinates.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for(const coordinate of coordinates){
    if(!Array.isArray(coordinate) || coordinate.length < 2) continue;
    const [x,y] = coordinate;
    if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX,x);
    minY = Math.min(minY,y);
    maxX = Math.max(maxX,x);
    maxY = Math.max(maxY,y);
  }
  return minX === Infinity ? null : [minX,minY,maxX,maxY];
}

function segmentBoundsFor(a,b){
  return [
    Math.min(a[0],b[0]),
    Math.min(a[1],b[1]),
    Math.max(a[0],b[0]),
    Math.max(a[1],b[1])
  ];
}

function boundsIntersect(a,b){
  if(!a || !b) return false;
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function buildGraph(roads){
  const nodes = new Map();
  const adjacency = new Map();
  const edges = [];
  for(const feature of roads?.features ?? []){
    if(!isAllowedRoad(feature)) continue;
    const roadId = roadIdentity(feature);
    for(const line of lineStrings(feature.geometry)){
      for(let i=1; i<line.length; i++){
        const a = normalizeNode(line[i-1]);
        const b = normalizeNode(line[i]);
        if(!a || !b || a.key === b.key) continue;
        nodes.set(a.key,a.point);
        nodes.set(b.key,b.point);
        addEdge(adjacency,a.key,b.key,roadId,distanceMeters(a.point,b.point),edges);
      }
    }
  }
  return {nodes,adjacency,edges};
}

function addEdge(adjacency,a,b,roadId,distanceM,edges){
  const edge = {a,b,roadId,distanceM};
  edges.push(edge);
  if(!adjacency.has(a)) adjacency.set(a,[]);
  if(!adjacency.has(b)) adjacency.set(b,[]);
  adjacency.get(a).push({to:b,roadId,distanceM});
  adjacency.get(b).push({to:a,roadId,distanceM});
}

function snapPoint(point,nodes){
  let best = null;
  for(const [key,nodePoint] of nodes){
    const distanceM = distanceMeters(point,nodePoint);
    if(distanceM <= 200 && (!best || distanceM < best.distanceM)){
      best = {key,point:nodePoint,distanceM};
    }
  }
  return best;
}

function shortestRoute(graph,originSnap,destinationSnap,blockedRoads,originPoint,destinationPoint){
  const distances = new Map([[originSnap.key,0]]);
  const previous = new Map();
  const queue = new Set(graph.nodes.keys());
  while(queue.size){
    let current = null;
    let currentDistance = Infinity;
    for(const key of queue){
      const value = distances.get(key) ?? Infinity;
      if(value < currentDistance){
        current = key;
        currentDistance = value;
      }
    }
    if(current === null || currentDistance === Infinity) break;
    queue.delete(current);
    if(current === destinationSnap.key) break;
    for(const edge of graph.adjacency.get(current) ?? []){
      if(blockedRoads.has(edge.roadId)) continue;
      const next = currentDistance + edge.distanceM;
      if(next < (distances.get(edge.to) ?? Infinity)){
        distances.set(edge.to,next);
        previous.set(edge.to,{from:current,roadId:edge.roadId});
      }
    }
  }
  if(!distances.has(destinationSnap.key)) return emptyRoute('no-path');
  const keys = [destinationSnap.key];
  const roadIds = [];
  let cursor = destinationSnap.key;
  while(cursor !== originSnap.key){
    const step = previous.get(cursor);
    if(!step) return emptyRoute('no-path');
    roadIds.unshift(step.roadId);
    cursor = step.from;
    keys.unshift(cursor);
  }
  const coordinates = [clonePoint(originPoint),...keys.map(key => graph.nodes.get(key)),clonePoint(destinationPoint)];
  const distanceM = distanceMeters(originPoint,originSnap.point) + distances.get(destinationSnap.key) + distanceMeters(destinationPoint,destinationSnap.point);
  return {status:'candidate',distanceM:roundMeters(distanceM),coordinates:dedupeAdjacent(coordinates),roadIds};
}

function connectorsBlocked(originPoint,originSnap,destinationPoint,destinationSnap,{depths,threshold=0.5}={}){
  if(!depths) return false;
  const connectorFc = {type:'FeatureCollection',features:[
    {type:'Feature',properties:{osmId:'origin-connector',highway:'service'},geometry:{type:'LineString',coordinates:[originPoint,originSnap]}},
    {type:'Feature',properties:{osmId:'destination-connector',highway:'service'},geometry:{type:'LineString',coordinates:[destinationSnap,destinationPoint]}}
  ]};
  return analyzeRoadExposure(connectorFc,depths,threshold).features.some(feature => feature.properties.impact === 'excluded' || feature.properties.impact === 'depth-review');
}

function mergeExposure(current,properties={}){
  const interval = readDepthInterval(properties);
  if(!interval) return current;
  if(!current) return interval;
  const currentMaxRank = intervalRank(current);
  const nextMaxRank = intervalRank(interval);
  const chosenLabel = nextMaxRank >= currentMaxRank ? interval : current;
  return {
    depth_m: Math.max(current.depth_m ?? 0,interval.depth_m ?? 0),
    depth_min_m: Math.max(current.depth_min_m ?? 0,interval.depth_min_m ?? 0),
    depth_max_m: maxUpper(current.depth_max_m,interval.depth_max_m),
    depth_label: chosenLabel.depth_label,
    depth_color: chosenLabel.depth_color,
    SEG_CODE: chosenLabel.SEG_CODE,
    depth_kind: current.uncertain || interval.uncertain ? 'interval' : 'exact',
    uncertain: current.uncertain || interval.uncertain
  };
}

function readDepthInterval(properties={}){
  if(properties.depth_kind === 'interval' || typeof properties.depth_min_m === 'number' || properties.depth_max_m === null || typeof properties.depth_max_m === 'number'){
    const min = finiteOr(properties.depth_min_m,0);
    const max = properties.depth_max_m === null ? null : finiteOr(properties.depth_max_m,null);
    const upperForViz = max === null ? finiteOr(properties.depth_m,min) : max;
    if(!Number.isFinite(min) || min < 0) return null;
    if(max !== null && (!Number.isFinite(max) || max <= 0 || max <= min)) return null;
    return {
      depth_m: finiteOr(properties.depth_m,upperForViz),
      depth_min_m:min,
      depth_max_m:max,
      depth_label:properties.depth_label,
      depth_color:properties.depth_color,
      SEG_CODE:properties.SEG_CODE,
      depth_kind:'interval',
      uncertain:true
    };
  }
  const exact = properties.depth_m;
  if(typeof exact !== 'number' || !Number.isFinite(exact) || exact <= 0) return null;
  return {
    depth_m:exact,
    depth_min_m:exact,
    depth_max_m:exact,
    depth_kind:'exact',
    uncertain:false
  };
}

function intervalImpact(exposure,threshold){
  if(!exposure.uncertain) return exposure.depth_m >= threshold ? 'excluded' : 'below';
  if(exposure.depth_max_m !== null && exposure.depth_max_m <= threshold) return 'below';
  if(exposure.depth_min_m >= threshold) return 'excluded';
  return 'depth-review';
}

function exposureProperties(exposure){
  if(!exposure) return {depth_m:null};
  const result = {
    depth_m:exposure.depth_m,
    depth_min_m:exposure.depth_min_m,
    depth_max_m:exposure.depth_max_m,
    depth_uncertain:exposure.uncertain
  };
  for(const key of ['depth_label','depth_color','SEG_CODE','depth_kind']){
    if(exposure[key] !== undefined) result[key] = exposure[key];
  }
  return result;
}

function intervalRank(exposure){
  return exposure.depth_max_m === null ? Infinity : exposure.depth_max_m;
}

function maxUpper(a,b){
  if(a === null || b === null) return null;
  return Math.max(a,b);
}

function finiteOr(value,fallback){
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function samePointRoute(originPoint,destinationPoint,key,nodePoint){
  const distanceM = distanceMeters(originPoint,nodePoint) + distanceMeters(destinationPoint,nodePoint);
  return {status:'candidate',distanceM:roundMeters(distanceM),coordinates:dedupeAdjacent([clonePoint(originPoint),nodePoint,clonePoint(destinationPoint)]),roadIds:[]};
}

function emptyRoute(status){
  return {status,distanceM:null,coordinates:[],roadIds:[]};
}

function isAllowedRoad(feature){
  const highway = String(feature?.properties?.highway ?? '');
  return ALLOWED_HIGHWAYS.has(highway);
}

function isBridge(feature){
  const value = feature?.properties?.bridge;
  return value === true || (typeof value === 'string' && value !== 'no' && value !== 'false');
}

function roadIdentity(feature){
  return String(feature?.properties?.osmId ?? feature?.properties?.id ?? feature?.id ?? '');
}

function normalizeNode(coordinate){
  if(!Array.isArray(coordinate) || coordinate.length < 2) return null;
  const [lon,lat] = coordinate;
  if(!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const point = [roundNode(lon),roundNode(lat)];
  return {key:point.join(','),point};
}

function ringArea(ring){
  let area = 0;
  for(let i=1; i<ring.length; i++){
    area += ring[i-1][0] * ring[i][1] - ring[i][0] * ring[i-1][1];
  }
  return area / 2;
}

function ringSelfIntersects(ring){
  for(let i=0; i<ring.length-1; i++){
    for(let j=i+1; j<ring.length-1; j++){
      if(Math.abs(i-j) <= 1) continue;
      if(i === 0 && j === ring.length - 2) continue;
      if(segmentsIntersect(ring[i],ring[i+1],ring[j],ring[j+1])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a,b,c,d){
  if(pointOnSegment(a,c,d) || pointOnSegment(b,c,d) || pointOnSegment(c,a,b) || pointOnSegment(d,a,b)) return true;
  const o1 = orientation(a,b,c);
  const o2 = orientation(a,b,d);
  const o3 = orientation(c,d,a);
  const o4 = orientation(c,d,b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function pointOnSegment(point,a,b){
  const cross = (point[1]-a[1]) * (b[0]-a[0]) - (point[0]-a[0]) * (b[1]-a[1]);
  if(Math.abs(cross) > EPS) return false;
  return point[0] >= Math.min(a[0],b[0]) - EPS &&
    point[0] <= Math.max(a[0],b[0]) + EPS &&
    point[1] >= Math.min(a[1],b[1]) - EPS &&
    point[1] <= Math.max(a[1],b[1]) + EPS;
}

function orientation(a,b,c){
  const value = (b[0]-a[0]) * (c[1]-a[1]) - (b[1]-a[1]) * (c[0]-a[0]);
  if(Math.abs(value) < EPS) return 0;
  return value > 0 ? 1 : -1;
}

function distanceMeters(a,b){
  const lat = ((a[1]+b[1])/2) * Math.PI / 180;
  const dx = (b[0]-a[0]) * 111320 * Math.cos(lat);
  const dy = (b[1]-a[1]) * 110540;
  return Math.hypot(dx,dy);
}

function dedupeAdjacent(coordinates){
  const result = [];
  for(const point of coordinates){
    if(!result.length || !sameCoord(result.at(-1),point)) result.push(clonePoint(point));
  }
  return result;
}

function midpoint(a,b){
  return [(a[0]+b[0])/2,(a[1]+b[1])/2];
}

function sameCoord(a,b){
  return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
}

function clonePoint(point){
  return [point[0],point[1]];
}

function clone(value){
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function roundCoord(value){
  return Number(value.toFixed(7));
}

function roundNode(value){
  return Number(value.toFixed(7));
}

function roundDepth(value){
  return Number(value.toFixed(2));
}

function roundMeters(value){
  return Number(value.toFixed(1));
}
