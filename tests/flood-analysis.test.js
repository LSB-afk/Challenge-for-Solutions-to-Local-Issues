import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPTH_BANDS,
  analyzeRoadExposure,
  compareRoutes,
  createDemoFlood,
  depthColor,
  pointDepth,
  validateDepthCollection
} from '../dist/flood-analysis.js';

const fc = features => ({type:'FeatureCollection',features});
const poly = (ring, depth = 1, properties = {}) => ({
  type:'Feature',
  properties:{depth_m:depth,...properties},
  geometry:{type:'Polygon',coordinates:[ring]}
});
const road = (id, coordinates, properties = {}) => ({
  type:'Feature',
  properties:{osmId:id,highway:'residential',...properties},
  geometry:{type:'LineString',coordinates}
});

const metadata = {
  title:'테스트 수심',
  source:'unit-test',
  scenario:'synthetic',
  kind:'imported',
  source_url:'https://example.test/depth.geojson'
};
const emptyDepths = {type:'FeatureCollection',metadata:{...metadata,kind:'imported',official:false},features:[]};
const square = (x1,y1,x2,y2) => [[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]];

test('수심 GeoJSON을 복제·정규화하고 구멍과 메타데이터 신뢰 경계를 보존한다', () => {
  const input = fc([{
    type:'Feature',
    properties:{depth_m:1.4,name:'sample'},
    geometry:{type:'Polygon',coordinates:[
      square(126.626,36.764,126.632,36.77),
      square(126.628,36.766,126.629,36.767)
    ]}
  }]);
  input.metadata = metadata;

  const result = validateDepthCollection(input);
  assert.notEqual(result, input);
  assert.notEqual(result.features[0], input.features[0]);
  assert.equal(result.metadata.kind, 'imported');
  assert.equal(result.metadata.official, false);
  assert.match(result.features[0].id, /^depth-1$/);
  assert.deepEqual(result.features[0].geometry.coordinates[1], input.features[0].geometry.coordinates[1]);

  input.features[0].properties.depth_m = 29;
  assert.equal(result.features[0].properties.depth_m, 1.4);
});

test('사용자 수심 업로드는 구간·표시 속성 주입을 분석 속성으로 보존하지 않는다', () => {
  const input = fc([poly(square(126.626,36.764,126.632,36.77),0.3,{
    name:'display label',
    depth_kind:'interval',
    depth_min_m:0.3,
    depth_max_m:null,
    depth_label:'5 이상',
    depth_color:'#5b218c',
    display_height_m:99,
    SEG_CODE:'forged'
  })]);
  input.metadata = metadata;
  const result = validateDepthCollection(input);
  assert.deepEqual(result.features[0].properties,{name:'display label',depth_m:0.3});

  const exposure = analyzeRoadExposure(fc([road('forged-user-depth',[[126.627,36.765],[126.628,36.766]])]), result, 0.5);
  assert.equal(exposure.features[0].properties.impact, 'below');
  assert.equal(exposure.features[0].properties.depth_uncertain, false);
  assert.equal(exposure.features[0].properties.depth_label, undefined);
});

test('잘못된 수심·좌표·도형·자가 교차 입력을 거부한다', () => {
  for (const bad of [
    fc([]),
    fc([{...poly(square(126.626,36.764,126.632,36.77),'1.2')}]),
    fc([poly(square(126.4,36.764,126.632,36.77),1)]),
    fc([{...poly(square(126.626,36.764,126.632,36.77),1),geometry:{type:'Polygon',coordinates:[square(126.626,36.764,126.632,36.77).slice(0,-1)]}}]),
    fc([poly([[126.626,36.764],[126.632,36.77],[126.626,36.77],[126.632,36.764],[126.626,36.764]],1)]),
    fc([{type:'Feature',properties:{depth_m:1},geometry:{type:'Point',coordinates:[126.626,36.764]}}]),
    fc([{...poly(square(126.626,36.764,126.632,36.77),1),geometry:{type:'Polygon',coordinates:[Array.from({length:2001},()=>[126.626,36.764])]}}])
  ]) {
    bad.metadata ??= metadata;
    assert.throws(() => validateDepthCollection(bad));
  }

  const claimedOfficial = validateDepthCollection({...fc([poly(square(126.626,36.764,126.632,36.77),1)]),metadata:{...metadata,kind:'official'}});
  assert.equal(claimedOfficial.metadata.kind, 'imported');
  assert.equal(claimedOfficial.metadata.official, false);
});

test('합성 시나리오는 결정적이고 단계가 커질수록 범위와 수심이 커진다', () => {
  const low = createDemoFlood(0);
  const mid = createDemoFlood(1);
  const high = createDemoFlood(2);
  assert.deepEqual(createDemoFlood(1), mid);
  assert.equal(mid.metadata.kind, 'demo');
  assert.equal(mid.metadata.source, '기능 검증용 합성 도형·수심');
  assert.equal(mid.metadata.scenario, '중간 수심 예시');
  assert.ok(mid.features.length >= 30 && mid.features.length <= 60);
  assert.ok(low.features.length < mid.features.length);
  assert.ok(mid.features.length < high.features.length);
  assert.ok(Math.max(...high.features.map(f => f.properties.depth_m)) > Math.max(...low.features.map(f => f.properties.depth_m)));
});

test('포인트 수심은 구멍을 제외하고 다중 도형 중 가장 깊은 값을 반환한다', () => {
  const depths = validateDepthCollection({
    ...fc([
      {type:'Feature',properties:{depth_m:0.8},geometry:{type:'Polygon',coordinates:[square(126.626,36.764,126.632,36.77),square(126.628,36.766,126.629,36.767)]}},
      {type:'Feature',properties:{depth_m:1.6},geometry:{type:'MultiPolygon',coordinates:[[square(126.631,36.768,126.634,36.771)],[square(126.6265,36.7645,126.627,36.765)]]}}
    ]),
    metadata
  });
  assert.equal(pointDepth([126.6285,36.7665], depths), null);
  assert.equal(pointDepth([126.6268,36.7648], depths), 1.6);
  assert.equal(pointDepth([126.62,36.764], depths), null);
});

test('도로 노출은 꼭짓점이 밖에 있는 교차와 구멍, 다중 도형, 교량 미확인을 처리한다', () => {
  const depths = validateDepthCollection({
    ...fc([
      {type:'Feature',properties:{depth_m:1.1},geometry:{type:'Polygon',coordinates:[square(126.626,36.764,126.632,36.77),square(126.628,36.766,126.629,36.767)]}},
      {type:'Feature',properties:{depth_m:0.4},geometry:{type:'MultiPolygon',coordinates:[[square(126.633,36.764,126.634,36.765)]]}}
    ]),
    metadata
  });
  const roads = fc([
    road('crosses', [[126.624,36.765],[126.634,36.765]]),
    road('hole-only', [[126.6282,36.7662],[126.6288,36.7668]]),
    road('shallow', [[126.6332,36.7642],[126.6338,36.7648]]),
    road('bridge', [[126.63,36.763],[126.63,36.771]], {bridge:'yes'})
  ]);

  const exposure = analyzeRoadExposure(roads, depths, 0.5);
  const byId = Object.fromEntries(exposure.features.map(f => [f.properties.osmId, f.properties]));
  assert.equal(byId.crosses.impact, 'excluded');
  assert.equal(byId.crosses.depth_m, 1.1);
  assert.equal(byId['hole-only'].impact, 'outside');
  assert.equal(byId.shallow.impact, 'below');
  assert.equal(byId.bridge.impact, 'bridge-review');
  assert.deepEqual(exposure.excludedIds.sort(), ['bridge','crosses']);
  assert.deepEqual(exposure.summary, {total:4,intersected:3,excluded:2,bridges:1,uncertain:0});
  assert.deepEqual(roads.features[0].properties, {osmId:'crosses',highway:'residential'});
});

test('수심 구간 노출은 상한 배타와 경계 불확실성을 보수적으로 처리한다', () => {
  const officialIntervals = fc([
    {type:'Feature',properties:{depth_kind:'interval',depth_min_m:0,depth_max_m:0.5,depth_m:0.5,depth_label:'0–<0.5',SEG_CODE:'01',depth_color:'#d7f2ff'},geometry:{type:'Polygon',coordinates:[square(126.626,36.764,126.627,36.765)]}},
    {type:'Feature',properties:{depth_kind:'interval',depth_min_m:0.5,depth_max_m:1,depth_m:1,depth_label:'0.5–<1',SEG_CODE:'02',depth_color:'#5fb8ea'},geometry:{type:'Polygon',coordinates:[square(126.628,36.764,126.629,36.765)]}},
    {type:'Feature',properties:{depth_kind:'interval',depth_min_m:0.2,depth_max_m:0.8,depth_m:0.8,depth_label:'0.2–<0.8',SEG_CODE:'x'},geometry:{type:'Polygon',coordinates:[square(126.63,36.764,126.631,36.765)]}},
    {type:'Feature',properties:{depth_kind:'interval',depth_min_m:5,depth_max_m:null,depth_m:5,depth_label:'5 이상',SEG_CODE:'05'},geometry:{type:'Polygon',coordinates:[square(126.632,36.764,126.633,36.765)]}}
  ]);
  const roads = fc([
    road('below-upper-boundary', [[126.6262,36.7642],[126.6268,36.7648]]),
    road('at-min-threshold', [[126.6282,36.7642],[126.6288,36.7648]]),
    road('threshold-inside', [[126.6302,36.7642],[126.6308,36.7648]]),
    road('open-ended', [[126.6322,36.7642],[126.6328,36.7648]]),
    road('bridge-interval', [[126.63,36.7638],[126.63,36.7652]], {bridge:'yes'})
  ]);

  const beforeRoads = structuredClone(roads);
  const exposure = analyzeRoadExposure(roads, officialIntervals, 0.5);
  const byId = Object.fromEntries(exposure.features.map(f => [f.properties.osmId, f.properties]));
  assert.equal(byId['below-upper-boundary'].impact, 'below');
  assert.equal(byId['below-upper-boundary'].depth_uncertain, true);
  assert.equal(byId['below-upper-boundary'].depth_label, '0–<0.5');
  assert.equal(byId['at-min-threshold'].impact, 'excluded');
  assert.equal(byId['threshold-inside'].impact, 'depth-review');
  assert.equal(byId['open-ended'].impact, 'excluded');
  assert.equal(byId['open-ended'].depth_max_m, null);
  assert.equal(byId['bridge-interval'].impact, 'bridge-review');
  assert.deepEqual(exposure.excludedIds.sort(), ['at-min-threshold','bridge-interval','open-ended','threshold-inside']);
  assert.equal(exposure.summary.uncertain, 5);
  assert.deepEqual(roads, beforeRoads);
});

test('도로와 수심 도형 bbox가 겹치지 않으면 정밀 교차 없이 노출 밖으로 남긴다', () => {
  const depths = fc([
    {type:'Feature',properties:{depth_kind:'interval',depth_min_m:5,depth_max_m:null,depth_m:5,depth_label:'5 이상'},geometry:{type:'Polygon',coordinates:[square(126.626,36.764,126.627,36.765)]}},
    {type:'Feature',properties:{depth_kind:'interval',depth_min_m:0.5,depth_max_m:1,depth_m:1,depth_label:'0.5–<1'},geometry:{type:'Polygon',coordinates:[square(126.64,36.79,126.641,36.791)]}}
  ]);
  const roads = fc([
    road('far', [[126.633,36.764],[126.634,36.765]]),
    road('hit', [[126.6262,36.7642],[126.6268,36.7648]])
  ]);
  const exposure = analyzeRoadExposure(roads, depths, 0.5);
  const byId = Object.fromEntries(exposure.features.map(f => [f.properties.osmId, f.properties]));
  assert.equal(byId.far.impact, 'outside');
  assert.equal(byId.hit.impact, 'excluded');
});

test('경로 비교는 침수 전 직접 연결과 침수 후 우회 후보를 같은 스냅 노드 기준으로 산출한다', () => {
  const n1 = [126.626,36.766], n2 = [126.629,36.766], n3 = [126.632,36.766];
  const n4 = [126.629,36.769];
  const roads = fc([
    road('west', [n1,n2]),
    road('direct', [n2,n3]),
    road('north-a', [n2,n4]),
    road('north-b', [n4,n3])
  ]);
  const depths = validateDepthCollection({...fc([poly(square(126.6292,36.7655,126.6305,36.7665),1.2)]),metadata});
  const exposure = analyzeRoadExposure(roads, depths, 0.5);

  const result = compareRoutes(roads, exposure, [126.6259,36.766], [126.6321,36.766], {depths,threshold:0.5});
  assert.equal(result.before.status, 'candidate');
  assert.deepEqual(result.before.roadIds, ['west','direct']);
  assert.equal(result.after.status, 'candidate');
  assert.deepEqual(result.after.roadIds, ['west','north-a','north-b']);
  assert.deepEqual(result.before.coordinates.at(0), [126.6259,36.766]);
  assert.deepEqual(result.after.coordinates.at(-1), [126.6321,36.766]);
  assert.deepEqual(result.snaps.origin.point, n1);
  assert.deepEqual(result.snaps.destination.point, n3);
});

test('스냅 실패·단절·침수 연결부는 후보 없음으로 구분한다', () => {
  const a = [126.626,36.766], b = [126.628,36.766], c = [126.63,36.766], d = [126.632,36.766];
  const roads = fc([road('ab',[a,b]), road('cd',[c,d])]);
  const exposure = analyzeRoadExposure(roads, emptyDepths, 0.5);

  assert.equal(compareRoutes(roads, exposure, [126.7,36.8], d).before.status, 'unmatched');
  assert.equal(compareRoutes(roads, exposure, a, d).before.status, 'no-path');

  const connectorDepths = validateDepthCollection({...fc([poly(square(126.6258,36.7658,126.6262,36.7662),1)]),metadata});
  assert.equal(compareRoutes(roads, exposure, [126.6257,36.766], b, {depths:connectorDepths,threshold:0.5}).after.status, 'no-path');

  const connectorInterval = fc([{type:'Feature',properties:{depth_kind:'interval',depth_min_m:0.2,depth_max_m:0.8,depth_m:0.8,depth_label:'0.2–<0.8'},geometry:{type:'Polygon',coordinates:[square(126.6258,36.7658,126.6262,36.7662)]}}]);
  assert.equal(compareRoutes(roads, exposure, [126.6257,36.766], b, {depths:connectorInterval,threshold:0.5}).after.status, 'no-path');
});

test('같은 위치를 비교하면 0m 후보로 반환하고 수심 색상 경계를 안정적으로 고른다', () => {
  const roads = fc([road('a',[[126.626,36.766],[126.628,36.766]])]);
  const exposure = analyzeRoadExposure(roads, emptyDepths, 0.5);
  const result = compareRoutes(roads, exposure, [126.626,36.766], [126.626,36.766]);
  assert.equal(result.before.status, 'candidate');
  assert.equal(result.before.distanceM, 0);
  assert.deepEqual(result.after, result.before);
  assert.equal(DEPTH_BANDS.length, 5);
  assert.deepEqual(DEPTH_BANDS.map(band => band.color), ['#d7f2ff','#5fb8ea','#2677d8','#5c4ac8','#5b218c']);
  assert.equal(depthColor(0.5), DEPTH_BANDS[1].color);
  assert.equal(depthColor(6), DEPTH_BANDS[4].color);
});
