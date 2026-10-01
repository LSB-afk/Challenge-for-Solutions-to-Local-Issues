import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioState,analyzeAll,analyzeVillage,extractReport,exportCsv} from '../dist/engine.js';

test('준비 시나리오에서 네 마을은 개방된 시설에 연결된다',()=>{
 assert.deepEqual(analyzeAll(scenarioState(0)).map(r=>r.status),['connected','connected','connected','connected']);
});
test('교량 통제와 미확인 구간은 연결 가능으로 판정하지 않는다',()=>{
 const state=scenarioState(1);
 assert.deepEqual(analyzeAll(state).map(r=>r.status),['unknown','blocked','connected','connected']);
 for(const r of analyzeAll(state))for(const id of r.route?.edges??[])assert.notEqual(state.roads[id],'closed');
});
test('복수 구간 통제는 C의 연결도 차단한다',()=>{
 assert.deepEqual(analyzeAll(scenarioState(2)).map(r=>r.status),['unknown','blocked','blocked','connected']);
});
test('우회 구간 확인은 A의 연결을 회복하지만 B를 임의 복구하지 않는다',()=>{
 const state=scenarioState(1);state.roads['detour-a']='open';
 assert.equal(analyzeVillage('a',state).status,'connected');
 assert.equal(analyzeVillage('b',state).status,'blocked');
});
test('미개방 시설은 제외하고 시설 상태 미확인도 판단 보류한다',()=>{
 const state=scenarioState(1);
 state.shelters.s3='unknown';assert.equal(analyzeVillage('b',state).status,'unknown');
 state.shelters.s3='open';assert.equal(analyzeVillage('b',state).status,'connected');
 assert.equal(analyzeVillage('b',state).route.target,'s3');
});
test('도로 상태가 누락되면 통행 가능으로 해석하지 않는다',()=>{
 const state=scenarioState(0);delete state.roads['road-b'];
 assert.equal(analyzeVillage('b',state).status,'unknown');
});
test('시설이 모두 닫혔을 때 경로를 생성하지 않는다',()=>{
 const state=scenarioState(0);Object.keys(state.shelters).forEach(id=>state.shelters[id]='closed');
 for(const r of analyzeAll(state)){assert.equal(r.status,'blocked');assert.equal(r.route,null);}
});
test('신고 위치는 명확할 때만 선택하고 복수 마을은 보류한다',()=>{
 assert.deepEqual(extractReport('마을 A 진입 교량 통행이 어렵다'),{village:'a',type:'통행 장애',ambiguous:false});
 assert.equal(extractReport('마을 A와 마을 B에 침수').village,'');
 assert.equal(extractReport('마을 앞 침수').village,'');
});
test('인계 CSV는 시연 표시와 기록을 포함하고 수식 실행 문자를 중화한다',()=>{
 const csv=exportCsv(scenarioState(1),[{text:'=1+1',village:'a',type:'기타',status:'미확인',time:'00:10',scenario:0}]);
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('실제 재난정보 아님'));assert.ok(csv.includes("'=1+1"));assert.ok(csv.includes('연결 확인 불가'));
 assert.ok(csv.includes('기록 당시 시나리오'));assert.ok(csv.includes('06:00 상황 확인'));assert.ok(csv.includes('06:30 교량 통제'));
});
