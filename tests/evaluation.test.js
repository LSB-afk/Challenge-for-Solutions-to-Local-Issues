import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVALUATION_CASES,
  exportEvaluationCsv,
  firstValidRecords,
  normalizeTrialRecord,
  normalizeTrialRecords,
  pairedMetrics,
  scoreTrial
} from '../dist/evaluation-engine.js';
import { analyzeAll } from '../dist/engine.js';

test('평가 사례 정답은 연결 분석 엔진의 현재 결과와 일치한다', () => {
  assert.equal(EVALUATION_CASES.length, 6);
  for (const evalCase of EVALUATION_CASES) {
    const actual = Object.fromEntries(analyzeAll(evalCase.state).map(item => [item.id, item.status]));
    assert.deepEqual(actual, evalCase.expected.villages, evalCase.id);
  }
});

test('무응답 제출과 잘못된 평가 코드를 막는다', () => {
  const score = scoreTrial({
    participantCode: '=bad',
    caseId: 'case-basic',
    methodId: 'table',
    elapsedMs: 1200,
    answers: { a: 'connected' },
    unknownRoads: [],
    unknownShelters: []
  });
  assert.equal(score.ok, false);
  assert.ok(score.errors.some(message => message.includes('평가 코드')));
  assert.ok(score.errors.some(message => message.includes('원평리 남측')));
});

test('마을 오류와 미확인 항목 누락을 분리해 채점한다', () => {
  const score = scoreTrial({
    participantCode: 'TEAM01',
    caseId: 'case-bridge-control',
    methodId: 'assist',
    elapsedMs: 43000,
    answers: { a: 'connected', b: 'blocked', c: 'connected', d: 'connected' },
    unknownRoads: [],
    unknownShelters: []
  });
  assert.equal(score.ok, true);
  assert.equal(score.villageErrors, 1);
  assert.equal(score.missedUnknownVillages, 1);
  assert.equal(score.missingUnknownItems, 1);
  assert.equal(score.extraUnknownItems, 0);
  assert.deepEqual(score.missingRoads, ['detour-a']);
});

test('중복 조합은 최초 유효값만 성과 계산에 사용한다', () => {
  const records = [
    rawRecord('TEAM01', 'case-basic', 'table', 10000, allAnswers('blocked')),
    rawRecord('TEAM01', 'case-basic', 'table', 7000, allAnswers('connected')),
    rawRecord('TEAM01', 'case-basic', 'assist', 6000, { a: 'blocked', b: 'connected', c: 'connected', d: 'connected' })
  ];
  const deduped = firstValidRecords(records);
  assert.equal(deduped.accepted.length, 2);
  assert.equal(deduped.retries.length, 1);
  assert.equal(pairedMetrics(records).pairCount, 1);
  assert.equal(pairedMetrics(records).medianDeltaMs, 4000);
});

test('CSV 내보내기는 수식 시작 문자를 중화하고 재시도를 표시한다', () => {
  const csv = exportEvaluationCsv([
    { ...rawRecord('TEAM01', 'case-basic', 'table', 10000, allAnswers('connected')), submittedAt: '=2026' },
    { ...rawRecord('TEAM01', 'case-basic', 'table', 9000, allAnswers('connected')), submittedAt: '+2026' }
  ]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=2026"'));
  assert.ok(csv.includes('"\'+2026"'));
  assert.ok(csv.includes('재시도'));
});

test('미확인 항목은 배열, 허용 ID, 중복을 검증한다', () => {
  const score = scoreTrial({
    participantCode: 'TEAM01',
    caseId: 'case-basic',
    methodId: 'table',
    elapsedMs: 1200,
    answers: allAnswers('connected'),
    unknownRoads: ['road-b', 'road-b', 'bad-road'],
    unknownShelters: 's1'
  });
  assert.equal(score.ok, false);
  assert.ok(score.errors.some(message => message.includes('미확인 도로에 중복')));
  assert.ok(score.errors.some(message => message.includes('미확인 도로에 허용')));
  assert.ok(score.errors.some(message => message.includes('미확인 시설 선택값 형식')));
});

test('시간은 반올림 후 0이 되는 값과 비정상 장시간을 거부한다', () => {
  const tiny = scoreTrial({
    participantCode: 'TEAM01',
    caseId: 'case-basic',
    methodId: 'table',
    elapsedMs: 0.2,
    answers: allAnswers('connected'),
    unknownRoads: [],
    unknownShelters: []
  });
  assert.equal(tiny.ok, false);
  assert.ok(tiny.errors.some(message => message.includes('시작 후 제출')));

  const huge = scoreTrial({
    participantCode: 'TEAM01',
    caseId: 'case-basic',
    methodId: 'table',
    elapsedMs: 60 * 60 * 1000 + 1,
    answers: allAnswers('connected'),
    unknownRoads: [],
    unknownShelters: []
  });
  assert.equal(huge.ok, false);
  assert.ok(huge.errors.some(message => message.includes('1시간')));
});

test('저장 기록은 집계 필드를 믿지 않고 원응답으로 재채점한다', () => {
  const recordWithTamperedScore = {
    valid: true,
    rawInput: {
      participantCode: 'TEAM01',
      caseId: 'case-bridge-control',
      methodId: 'table',
      elapsedMs: 1000,
      answers: allAnswers('connected'),
      unknownRoads: [],
      unknownShelters: []
    },
    villageErrors: 0,
    totalErrors: 0,
    order: 'AB',
    submittedAt: '2026-10-03T00:00:00.000Z'
  };
  const normalized = normalizeTrialRecord(recordWithTamperedScore);
  assert.equal(normalized.valid, true);
  assert.equal(normalized.villageErrors, 2);
  assert.equal(normalized.totalErrors, 3);
  assert.equal(normalized.order, 'AB');
});

test('조작되거나 깨진 저장 기록은 로드 집계에서 제외한다', () => {
  const normalized = normalizeTrialRecords([
    { rawInput: { participantCode: 'x', caseId: 'missing', methodId: 'table', elapsedMs: 1, answers: {}, unknownRoads: [], unknownShelters: [] } },
    { rawInput: { participantCode: 'TEAM01', caseId: 'case-basic', methodId: 'table', elapsedMs: 1000, answers: allAnswers('connected'), unknownRoads: [], unknownShelters: [] } }
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].totalErrors, 0);
});

test('paired 지표는 시간 변화와 오류 변화량을 함께 계산한다', () => {
  const metrics = pairedMetrics([
    rawRecord('TEAM01', 'case-basic', 'table', 10000, allAnswers('blocked')),
    rawRecord('TEAM01', 'case-basic', 'assist', 7000, allAnswers('connected'))
  ]);
  assert.equal(metrics.pairCount, 1);
  assert.equal(metrics.medianDeltaMs, 3000);
  assert.equal(metrics.medianErrorDelta, 4);
});

test('연결 분석 보조가 더 오래 걸린 경우 음수 시간 차이를 보존한다', () => {
  const metrics = pairedMetrics([
    rawRecord('TEAM01', 'case-basic', 'table', 7000, allAnswers('connected')),
    rawRecord('TEAM01', 'case-basic', 'assist', 10000, allAnswers('connected'))
  ]);
  assert.equal(metrics.medianDeltaMs, -3000);
  assert.equal(metrics.medianPercentChange.toFixed(1), '-42.9');
});

function record(participantCode, caseId, methodId, elapsedMs, totalErrors) {
  return {
    valid: true,
    participantCode,
    caseId,
    methodId,
    elapsedMs,
    villageErrors: totalErrors,
    missedUnknownVillages: 0,
    missingUnknownItems: 0,
    extraUnknownItems: 0,
    totalErrors,
    submittedAt: '2026-10-03T00:00:00.000Z'
  };
}

function allAnswers(status) {
  return { a: status, b: status, c: status, d: status };
}

function rawRecord(participantCode, caseId, methodId, elapsedMs, answers) {
  return {
    rawInput: { participantCode, caseId, methodId, elapsedMs, answers, unknownRoads: [], unknownShelters: [] },
    order: 'AB',
    submittedAt: '2026-10-03T00:00:00.000Z'
  };
}
