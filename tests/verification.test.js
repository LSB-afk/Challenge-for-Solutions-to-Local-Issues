import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioState } from '../dist/engine.js';
import { getConfirmationPriorities } from '../dist/verification.js';

test('미확인 우회로의 양쪽 결과를 비교하고 현재 상태는 보존한다', () => {
  const state = scenarioState(1), before = structuredClone(state);
  const rows = getConfirmationPriorities(state);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'detour-a');
  assert.deepEqual(rows[0].villages, [{id:'a', before:'unknown', whenOpen:'connected', whenClosed:'blocked'}]);
  assert.deepEqual(state, before);
});

test('공통 시설의 개방 여부는 여러 마을 판단에 영향을 주므로 먼저 표시한다', () => {
  const state = scenarioState(0);
  state.roads['bridge-c'] = 'unknown';
  state.shelters.s1 = 'unknown';
  const rows = getConfirmationPriorities(state);
  assert.equal(rows[0].id, 's1');
  assert.equal(rows[0].affectedCount, 4);
  assert.equal(rows[1].id, 'bridge-c');
  assert.equal(rows[1].affectedCount, 1);
});

test('동시에 여러 확인이 필요하면 단일 확인의 한계를 보존한다', () => {
  const state = scenarioState(0);
  state.roads['bridge-a'] = 'unknown';
  state.roads['detour-a'] = 'unknown';
  const rows = getConfirmationPriorities(state);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.villages[0].whenOpen, 'connected');
    assert.equal(row.villages[0].whenClosed, 'unknown');
  }
});

test('확인한 최신 자료는 제외하고 오래된 자료만 재확인 대상으로 둔다', () => {
  const state = scenarioState(2);
  state.roadChecks = {'main-north': 360};
  const rows = getConfirmationPriorities(state);
  assert.equal(rows.find(row => row.id === 'main-north').freshness, 'stale');
  assert.equal(rows.some(row => row.id === 'bridge-a'), false);
  assert.deepEqual(getConfirmationPriorities(scenarioState(0)), []);
});

test('영향 0건과 누락 상태도 감추지 않고 확인 대상으로 남긴다', () => {
  const state = scenarioState(2);
  delete state.roads['facility-b'];
  const row = getConfirmationPriorities(state).find(row => row.id === 'facility-b');
  assert.equal(row.freshness, 'unknown');
  assert.equal(row.affectedCount, 0);
});
