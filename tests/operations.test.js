import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVillage, scenarioState } from '../dist/engine.js';
import { confirmEvidence, getOperationalContext, getVillageEvidence, scenarioMinute } from '../dist/operations.js';

test('시나리오 시각을 분 단위로 변환한다', () => {
  assert.equal(scenarioMinute(0), 360);
  assert.equal(scenarioMinute(1), 390);
  assert.equal(scenarioMinute(2), 420);
});

test('0번 시나리오는 비교 기준 없이 모든 행을 same으로 둔다', () => {
  const context = getOperationalContext(scenarioState(0));
  assert.equal(context.clock, '06:00');
  assert.deepEqual(context.counts, {blocked:0, unknown:0, connected:4});
  assert.equal(context.comparison.baselineScenario, null);
  assert.equal(context.comparison.changedCount, 0);
  assert.deepEqual(context.comparison.rows.map(row => row.change), ['same', 'same', 'same', 'same']);
});

test('1번 시나리오는 직전 시나리오 대비 A와 B 악화를 표시한다', () => {
  const context = getOperationalContext(scenarioState(1));
  assert.equal(context.clock, '06:30');
  assert.deepEqual(context.counts, {blocked:1, unknown:1, connected:2});
  assert.equal(context.comparison.baselineScenario, 0);
  assert.equal(context.comparison.changedCount, 2);
  assert.deepEqual(context.comparison.rows.map(row => row.change), ['worsened', 'worsened', 'same', 'same']);
});

test('2번 시나리오는 직전 시나리오 대비 C 악화를 표시한다', () => {
  const context = getOperationalContext(scenarioState(2));
  assert.equal(context.clock, '07:00');
  assert.deepEqual(context.counts, {blocked:2, unknown:1, connected:1});
  assert.equal(context.comparison.baselineScenario, 1);
  assert.equal(context.comparison.changedCount, 1);
  assert.deepEqual(context.comparison.rows.map(row => row.change), ['same', 'same', 'worsened', 'same']);
});

test('수동 개방 확인은 복구 판정을 보여주되 신고는 판정을 바꾸지 않는다', () => {
  const state = scenarioState(1);
  state.roads['detour-a'] = 'open';
  state.roadChecks = {'detour-a':390};
  const logs = [{id:'log-1', village:'a', status:'미확인', text:'우회로 확인 요청', time:'06:32', scenario:1}];
  const context = getOperationalContext(state, logs);
  const evidence = getVillageEvidence('a', state, logs);
  assert.equal(analyzeVillage('a', state).status, 'connected');
  assert.equal(context.pendingReportCount, 1);
  assert.equal(context.priorities.find(item => item.id === 'a').pendingReports, 1);
  assert.equal(evidence.pendingReports, 1);
  assert.ok(evidence.nextAction.includes('미확인 신고 1건'));
  assert.equal(analyzeVillage('b', state).status, 'blocked');
});

test('미확인 구간은 센서처럼 보이지 않는 출처와 확인 불가 신선도를 가진다', () => {
  const evidence = getVillageEvidence('a', scenarioState(1));
  const detour = evidence.items.find(item => item.id === 'detour-a');
  assert.equal(detour.status, 'unknown');
  assert.equal(detour.source, '훈련 상황표 · 미확인');
  assert.equal(detour.checkedAt, '미확인');
  assert.equal(detour.ageMinutes, null);
  assert.equal(detour.freshness, 'unknown');
  assert.ok(evidence.summary.includes('확인이 비어 있습니다'));
});

test('30분을 넘긴 수동 확인은 stale로 표시하지만 연결 판정은 바꾸지 않는다', () => {
  const state = scenarioState(1);
  state.roadChecks = {'road-b':350};
  const before = analyzeVillage('b', state);
  const evidence = getVillageEvidence('b', state);
  const road = evidence.items.find(item => item.id === 'road-b');
  assert.equal(before.status, 'blocked');
  assert.equal(road.checkedAt, '05:50');
  assert.equal(road.ageMinutes, 40);
  assert.equal(road.freshness, 'stale');
  assert.equal(analyzeVillage('b', state).status, 'blocked');
  assert.ok(evidence.nextAction.includes('재확인 버튼'));
});

test('잘못된 수동 확인 시각은 훈련 관측 시각으로 대체한다', () => {
  const future = scenarioState(1);
  future.roadChecks = {'road-b':391};
  const negative = scenarioState(1);
  negative.roadChecks = {'road-b':-1};
  const decimal = scenarioState(1);
  decimal.roadChecks = {'road-b':389.5};
  for (const state of [future, negative, decimal]) {
    const road = getVillageEvidence('b', state).items.find(item => item.id === 'road-b');
    assert.equal(road.source, '훈련 상황표 · 시연');
    assert.equal(road.checkedAt, '06:25');
    assert.equal(road.ageMinutes, 5);
    assert.equal(road.freshness, 'recent');
  }
});

test('known evidence 재확인은 원본을 바꾸지 않고 stale을 recent로 갱신한다', () => {
  const state = scenarioState(1);
  state.roadChecks = {'road-b':350};
  const updated = confirmEvidence('road', 'road-b', state);
  assert.notEqual(updated, state);
  assert.deepEqual(state.roadChecks, {'road-b':350});
  assert.equal(updated.roadChecks['road-b'], 390);
  assert.equal(analyzeVillage('b', updated).status, 'blocked');
  const road = getVillageEvidence('b', updated).items.find(item => item.id === 'road-b');
  assert.equal(road.source, '도로 수동 확인 · 시연');
  assert.equal(road.checkedAt, '06:30');
  assert.equal(road.ageMinutes, 0);
  assert.equal(road.freshness, 'recent');
});

test('시설 evidence 재확인은 새 shelterChecks만 갱신한다', () => {
  const state = scenarioState(1);
  const updated = confirmEvidence('shelter', 's1', state);
  assert.notEqual(updated, state);
  assert.equal(updated.shelterChecks.s1, 390);
  assert.equal(state.shelterChecks, undefined);
  assert.equal(updated.shelters.s1, state.shelters.s1);
});

test('unknown evidence는 재확인 버튼으로 자동 확정하지 않는다', () => {
  const state = scenarioState(1);
  const updated = confirmEvidence('road', 'detour-a', state);
  assert.equal(updated, state);
  assert.equal(state.roadChecks, undefined);
  assert.equal(analyzeVillage('a', state).status, 'unknown');
});

test('invalid evidence id와 kind는 상태를 변경하지 않는다', () => {
  const state = scenarioState(1);
  assert.equal(confirmEvidence('road', 'missing-road', state), state);
  assert.equal(confirmEvidence('shelter', 'missing-shelter', state), state);
  assert.equal(confirmEvidence('camera', 'road-b', state), state);
  assert.equal(state.roadChecks, undefined);
  assert.equal(state.shelterChecks, undefined);
});

test('미확인 신고는 우선순위와 체크리스트에만 반영되고 연결 판정은 바꾸지 않는다', () => {
  const state = scenarioState(2);
  const logs = [
    {id:'log-c', village:'c', status:'미확인', text:'교량 주변 물 고임', time:'07:02', scenario:2},
    {id:'log-done', village:'c', status:'확인 완료', text:'기록 확인', time:'07:03', scenario:2}
  ];
  const evidence = getVillageEvidence('c', state, logs);
  const context = getOperationalContext(state, logs);
  assert.equal(analyzeVillage('c', state).status, 'blocked');
  assert.equal(evidence.pendingReports, 1);
  assert.ok(evidence.checklist.some(item => item.includes('미확인 신고 1건')));
  assert.equal(context.priorities[0].id, 'c');
  assert.equal(context.priorities[0].pendingReports, 1);
});
