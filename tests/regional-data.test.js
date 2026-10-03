import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const evidence = JSON.parse(await readFile(new URL('../dist/data/regional-evidence.json',import.meta.url)));
const roads = JSON.parse(await readFile(new URL('../dist/data/unsan-osm-roads.geojson',import.meta.url)));

test('지역 도로 객체 수·원본 ID·교량 태그 수가 근거목록과 일치한다', () => {
  assert.equal(roads.type,'FeatureCollection');
  assert.equal(roads.features.length,evidence.roads.featureCount);
  assert.equal(new Set(roads.features.map(f=>f.properties.osmId)).size,roads.features.length);
  assert.equal(roads.features.filter(f=>f.properties.bridge && f.properties.bridge!=='no').length,evidence.roads.bridgeTaggedWayCount);
  for (const f of roads.features) {
    assert.equal(f.geometry.type,'LineString');
    assert.ok(f.geometry.coordinates.length>1);
    assert.ok(f.geometry.coordinates.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x)<=180&&Math.abs(y)<=90));
    assert.equal(f.properties.trafficStatus,'unknown');
    assert.equal(f.properties.verificationLevel,'public-map-geometry-only');
  }
  assert.equal(evidence.roads.license,'ODbL');
});

test('시설은 공식주소와 좌표 근거를 구별하고 대피시설로 확정하지 않는다', () => {
  const sourceIds=new Set(evidence.sources.map(s=>s.id));
  assert.equal(evidence.places.length,6);
  assert.equal(evidence.places.filter(p=>p.coordinate).length,5);
  for(const place of evidence.places){
    assert.ok(sourceIds.has(place.officialSourceId));
    assert.equal(place.floodUseStatus,'not_verified_as_flood_shelter');
    if(place.coordinate){
      assert.ok(Number.isFinite(place.coordinate.lon)&&Number.isFinite(place.coordinate.lat));
      assert.ok(sourceIds.has(place.coordinateSource.sourceId));
      assert.ok(place.coordinateSource.objectid);
    }else{
      assert.equal(place.coordinateSource,null);
      assert.equal(place.verificationLevel,'official-address-only');
    }
  }
  for(const item of evidence.eventEvidence)assert.ok(sourceIds.has(item.sourceId));
});

test('부분 도로망 연결성은 행정구역 전체 또는 현장 안전 판정으로 표현하지 않는다',()=>{
  const topology=evidence.roads.topology;
  assert.equal(topology.verificationLevel,'public-map-topology-only');
  assert.ok(topology.includedWayCount<=roads.features.length);
  assert.equal(topology.componentSizesTop10.reduce((a,b)=>a+b,0),topology.includedWayCount);
  assert.equal(topology.componentCount,topology.componentSizesTop10.length);
  assert.ok(evidence.unresolved.some(text=>text.includes('풍수해')));
});
