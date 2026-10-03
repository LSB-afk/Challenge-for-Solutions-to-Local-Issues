import { ROADS, SHELTERS, VILLAGES } from './data.js';
import { analyzeAll, scenarioState, csvCell } from './engine.js';

export const VILLAGE_STATUS = {
  connected: '연결',
  unknown: '추가 확인',
  blocked: '연결 불가'
};

const cloneState = state => ({
  scenario: state.scenario,
  roads: { ...state.roads },
  shelters: { ...state.shelters }
});

const baseState = scenarioId => cloneState(scenarioState(scenarioId));
const MAX_ELAPSED_MS = 60 * 60 * 1000;

function stateWith(scenarioId, mutate) {
  const state = baseState(scenarioId);
  mutate(state);
  return state;
}

export const EVALUATION_CASES = [
  {
    id: 'case-basic',
    title: '기본 연결 확인',
    summary: '통제 구간이 접수되기 전, 네 마을이 개방 시설로 이어지는지 판단합니다.',
    state: baseState(0),
    expected: {
      villages: { a: 'connected', b: 'connected', c: 'connected', d: 'connected' },
      unknownRoads: [],
      unknownShelters: []
    }
  },
  {
    id: 'case-bridge-control',
    title: '교량 통제와 우회 미확인',
    summary: '마을 A 진입 교량과 마을 B 진입로가 통제되고, 마을 A 우회 구간은 아직 확인되지 않았습니다.',
    state: baseState(1),
    expected: {
      villages: { a: 'unknown', b: 'blocked', c: 'connected', d: 'connected' },
      unknownRoads: ['detour-a'],
      unknownShelters: []
    }
  },
  {
    id: 'case-unknown-road',
    title: '진입로 상태 미확인',
    summary: '마을 B 진입로 상태가 누락되어, 표만 보면 열려 있는지 닫힌지 알 수 없습니다.',
    state: stateWith(0, state => {
      state.roads['road-b'] = 'unknown';
    }),
    expected: {
      villages: { a: 'connected', b: 'unknown', c: 'connected', d: 'connected' },
      unknownRoads: ['road-b'],
      unknownShelters: []
    }
  },
  {
    id: 'case-facility-closed',
    title: '서측 시설 폐쇄',
    summary: '서측 시설은 폐쇄되었고, 남측 시설은 개방되어 있습니다. 남측으로 우회 가능한지 확인합니다.',
    state: stateWith(0, state => {
      state.shelters.s1 = 'closed';
      state.shelters.s2 = 'closed';
      state.shelters.s3 = 'open';
    }),
    expected: {
      villages: { a: 'connected', b: 'connected', c: 'connected', d: 'connected' },
      unknownRoads: [],
      unknownShelters: []
    }
  },
  {
    id: 'case-multi-cut',
    title: '복수 단절',
    summary: '남측과 동측 진입 축이 동시에 끊겨, 마을별 영향이 서로 달라집니다.',
    state: baseState(2),
    expected: {
      villages: { a: 'unknown', b: 'blocked', c: 'blocked', d: 'connected' },
      unknownRoads: ['detour-a'],
      unknownShelters: []
    }
  },
  {
    id: 'case-unknown-facility',
    title: '시설 상태 미확인',
    summary: '모든 개방 확인 시설이 없고, 서측 시설의 상태만 확인되지 않았습니다.',
    state: stateWith(0, state => {
      state.shelters.s1 = 'unknown';
      state.shelters.s2 = 'closed';
      state.shelters.s3 = 'closed';
    }),
    expected: {
      villages: { a: 'unknown', b: 'unknown', c: 'unknown', d: 'unknown' },
      unknownRoads: [],
      unknownShelters: ['s1']
    }
  }
];

export const METHOD_DEFINITIONS = [
  {
    id: 'table',
    label: '자료표 방식',
    note: '실제 현행업무 대용입니다. 같은 도로·시설 상태를 표로만 제공합니다.'
  },
  {
    id: 'assist',
    label: '연결 분석 보조',
    note: '같은 입력에 연결 분석 결과와 근거 경로를 함께 제공합니다.'
  }
];

export function caseById(caseId) {
  const found = EVALUATION_CASES.find(item => item.id === caseId);
  if (!found) throw new Error(`Unknown evaluation case: ${caseId}`);
  return found;
}

export function methodById(methodId) {
  const found = METHOD_DEFINITIONS.find(item => item.id === methodId);
  if (!found) throw new Error(`Unknown evaluation method: ${methodId}`);
  return found;
}

export function roadRows(state) {
  return ROADS.map(road => ({
    id: road.id,
    name: road.name,
    from: nodeName(road.from),
    to: nodeName(road.to),
    status: state.roads[road.id] ?? 'unknown'
  }));
}

export function shelterRows(state) {
  return SHELTERS.map(shelter => ({
    id: shelter.id,
    name: shelter.name,
    status: state.shelters[shelter.id] ?? 'unknown'
  }));
}

export function assistedRows(state) {
  return analyzeAll(state).map(result => ({
    id: result.id,
    village: VILLAGES.find(village => village.id === result.id)?.name ?? result.id,
    status: result.status,
    label: result.label,
    evidence: result.route ? result.route.edges.map(id => ROADS.find(road => road.id === id)?.name ?? id) : [],
    reason: result.reason
  }));
}

function nodeName(id) {
  return VILLAGES.find(village => village.id === id)?.name
    ?? SHELTERS.find(shelter => shelter.id === id)?.name
    ?? id.toUpperCase();
}

export function validateParticipantCode(code) {
  const value = String(code ?? '').trim();
  if (!/^[A-Za-z0-9가-힣_-]{2,24}$/.test(value)) {
    return { ok: false, value, message: '평가 코드는 2~24자의 한글, 영문, 숫자, -, _만 사용할 수 있습니다.' };
  }
  return { ok: true, value, message: '' };
}

export function validateTrialInput(input) {
  const errors = [];
  const code = validateParticipantCode(input?.participantCode);
  if (!code.ok) errors.push(code.message);
  if (!EVALUATION_CASES.some(item => item.id === input?.caseId)) errors.push('사례를 선택해야 합니다.');
  if (!METHOD_DEFINITIONS.some(item => item.id === input?.methodId)) errors.push('방식을 선택해야 합니다.');
  if (!Number.isFinite(input?.elapsedMs) || Math.round(input.elapsedMs) <= 0) errors.push('시작 후 제출해야 합니다.');
  if (Number.isFinite(input?.elapsedMs) && input.elapsedMs > MAX_ELAPSED_MS) errors.push('평가 시간은 1시간 이하여야 합니다.');
  const answers = input?.answers ?? {};
  for (const village of VILLAGES) {
    if (!['connected', 'unknown', 'blocked'].includes(answers[village.id])) {
      errors.push(`${village.name} 판단을 선택해야 합니다.`);
    }
  }
  const roadValidation = validateIdList(input?.unknownRoads, new Set(ROADS.map(road => road.id)), '미확인 도로');
  const shelterValidation = validateIdList(input?.unknownShelters, new Set(SHELTERS.map(shelter => shelter.id)), '미확인 시설');
  errors.push(...roadValidation.errors, ...shelterValidation.errors);
  return { ok: errors.length === 0, errors, participantCode: code.value };
}

function validateIdList(value, allowedIds, label) {
  if (!Array.isArray(value)) return { errors: [`${label} 선택값 형식이 올바르지 않습니다.`] };
  const errors = [];
  const seen = new Set();
  for (const id of value) {
    if (typeof id !== 'string' || !allowedIds.has(id)) {
      errors.push(`${label}에 허용되지 않은 항목이 있습니다.`);
      continue;
    }
    if (seen.has(id)) errors.push(`${label}에 중복 항목이 있습니다.`);
    seen.add(id);
  }
  return { errors };
}

export function scoreTrial(input) {
  const validation = validateTrialInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const evalCase = caseById(input.caseId);
  const selectedRoads = new Set(input.unknownRoads ?? []);
  const selectedShelters = new Set(input.unknownShelters ?? []);
  const expectedRoads = new Set(evalCase.expected.unknownRoads);
  const expectedShelters = new Set(evalCase.expected.unknownShelters);

  const villageResults = VILLAGES.map(village => {
    const expected = evalCase.expected.villages[village.id];
    const actual = input.answers[village.id];
    return {
      id: village.id,
      name: village.name,
      expected,
      actual,
      correct: expected === actual,
      missedUnknown: expected === 'unknown' && actual !== 'unknown'
    };
  });

  const missingRoads = [...expectedRoads].filter(id => !selectedRoads.has(id));
  const extraRoads = [...selectedRoads].filter(id => !expectedRoads.has(id));
  const missingShelters = [...expectedShelters].filter(id => !selectedShelters.has(id));
  const extraShelters = [...selectedShelters].filter(id => !expectedShelters.has(id));

  const villageErrors = villageResults.filter(item => !item.correct).length;
  const missedUnknownVillages = villageResults.filter(item => item.missedUnknown).length;
  const missingUnknownItems = missingRoads.length + missingShelters.length;
  const extraUnknownItems = extraRoads.length + extraShelters.length;

  return {
    ok: true,
    participantCode: validation.participantCode,
    caseId: input.caseId,
    methodId: input.methodId,
    elapsedMs: Math.round(input.elapsedMs),
    villageResults,
    villageErrors,
    missedUnknownVillages,
    missingUnknownItems,
    extraUnknownItems,
    missingRoads,
    extraRoads,
    missingShelters,
    extraShelters,
    totalErrors: villageErrors + missingUnknownItems + extraUnknownItems
  };
}

export function normalizeTrialRecord(record) {
  const raw = record?.rawInput ?? record;
  const score = scoreTrial(raw);
  if (!score.ok) return { valid: false, errors: score.errors, rawInput: raw, submittedAt: record?.submittedAt ?? '' };
  return {
    ...score,
    valid: true,
    order: ['AB', 'BA'].includes(record?.order) ? record.order : '',
    submittedAt: typeof record?.submittedAt === 'string' ? record.submittedAt : '',
    rawInput: {
      participantCode: score.participantCode,
      caseId: raw.caseId,
      methodId: raw.methodId,
      elapsedMs: score.elapsedMs,
      answers: { ...raw.answers },
      unknownRoads: [...raw.unknownRoads],
      unknownShelters: [...raw.unknownShelters]
    }
  };
}

export function normalizeTrialRecords(records) {
  return (records ?? []).map(normalizeTrialRecord).filter(record => record.valid);
}

export function firstValidRecords(records) {
  const normalized = normalizeTrialRecords(records);
  const seen = new Set();
  const accepted = [];
  const retries = [];
  for (const record of normalized) {
    const key = recordKey(record);
    if (seen.has(key)) {
      retries.push(record);
      continue;
    }
    seen.add(key);
    accepted.push(record);
  }
  return { accepted, retries };
}

export function recordKey(record) {
  return `${record.participantCode}::${record.caseId}::${record.methodId}`;
}

export function pairedMetrics(records) {
  const { accepted, retries } = firstValidRecords(records);
  const byPair = new Map();
  for (const record of accepted) {
    const pairKey = `${record.participantCode}::${record.caseId}`;
    const pair = byPair.get(pairKey) ?? {};
    pair[record.methodId] = record;
    byPair.set(pairKey, pair);
  }
  const pairs = [...byPair.values()].filter(pair => pair.table && pair.assist);
  const timeDeltas = pairs.map(pair => pair.table.elapsedMs - pair.assist.elapsedMs);
  const medianDeltaMs = median(timeDeltas);
  const validPercentPairs = pairs.filter(pair => pair.table.elapsedMs > 0);
  const percentChanges = validPercentPairs.map(pair => ((pair.table.elapsedMs - pair.assist.elapsedMs) / pair.table.elapsedMs) * 100);

  return {
    acceptedCount: accepted.length,
    retryCount: retries.length,
    pairCount: pairs.length,
    medianDeltaMs,
    medianPercentChange: median(percentChanges),
    tableAverageErrors: average(pairs.map(pair => pair.table.totalErrors)),
    assistAverageErrors: average(pairs.map(pair => pair.assist.totalErrors)),
    medianErrorDelta: median(pairs.map(pair => pair.table.totalErrors - pair.assist.totalErrors))
  };
}

export function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function exportEvaluationCsv(records) {
  const headers = [
    '평가코드',
    '사례ID',
    '방식',
    '경과ms',
    '마을오류',
    '추가확인마을누락',
    '미확인항목누락',
    '미확인항목과잉선택',
    '총오류',
    '최초유효값여부',
    '제출시각'
  ];
  const { accepted } = firstValidRecords(records);
  const firstRecords = new Set(accepted);
  const normalized = normalizeTrialRecords(records);
  const rows = [headers];
  for (const record of normalized) {
    rows.push([
      record.participantCode,
      record.caseId,
      methodById(record.methodId).label,
      record.elapsedMs,
      record.villageErrors,
      record.missedUnknownVillages,
      record.missingUnknownItems,
      record.extraUnknownItems,
      record.totalErrors,
      firstRecords.has(record) ? '최초 유효값' : '재시도',
      record.submittedAt
    ]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
