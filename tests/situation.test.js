import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioState} from '../dist/engine.js';
import {ROADS,SHELTERS} from '../dist/data.js';
import {getSituationSummary,searchPlaces,sourceLayerVisible,roadCenter} from '../dist/situation.js';

test('상황 요약은 겹치는 경로를 중복 집계하지 않고 도로·시설 13개를 센다',()=>{
 const state={...scenarioState(1),logs:[]};
 const {counts,evidence,incidents}=getSituationSummary(state);
 assert.equal(evidence.length,ROADS.length+SHELTERS.length);
 assert.equal(new Set(evidence.map(item=>`${item.kind}:${item.id}`)).size,13);
 assert.equal(counts.closedRoads,2);assert.equal(counts.unknown,1);
 assert.deepEqual(incidents.map(item=>item.status),['closed','closed','unknown']);
});
test('오래된 근거와 위치 미확정 신고를 보존하고 시나리오 전체 기록을 집계한다',()=>{
 const state={...scenarioState(1),roadChecks:{[ROADS[0].id]:350},logs:[{status:'미확인',village:'a',scenario:0},{status:'미확인',village:'',scenario:1},{status:'확인 완료',village:'b',scenario:1}]};
 const before=structuredClone(state),summary=getSituationSummary(state);
 assert.equal(summary.counts.stale,1);assert.equal(summary.counts.pending,2);assert.equal(summary.counts.unlocated,1);
 assert.deepEqual(state,before);
});
test('출처 필터는 레이어 설정과 교차 적용되며 건물은 항상 독립적이다',()=>{
 assert.equal(sourceLayerVisible('roads',true,'reports'),false);
 assert.equal(sourceLayerVisible('reports',true,'evidence'),false);
 assert.equal(sourceLayerVisible('reports',false,'reports'),false);
 for(const mode of ['all','evidence','reports'])assert.equal(sourceLayerVisible('buildings',true,mode),true);
 assert.equal(sourceLayerVisible('buildings',false,'reports'),false);
});
test('검색은 등록된 시연 장소만 반환하고 도로 위치는 원래 선형에서 가져온다',()=>{
 assert.deepEqual(searchPlaces('  '),[]);assert.deepEqual(searchPlaces('없는 주소 999'),[]);
 const roads=searchPlaces('교량');assert.equal(roads.length,2);assert.ok(roads.every(item=>item.kind==='road'));
 assert.equal(searchPlaces('시설').filter(item=>item.kind==='shelter').length,3);
 assert.equal(searchPlaces('a').find(item=>item.kind==='village').id,'a');
 for(const road of ROADS)assert.deepEqual(roadCenter(road.id),road.coordinates[Math.floor(road.coordinates.length/2)]);
 assert.equal(roadCenter('missing'),undefined);
});
