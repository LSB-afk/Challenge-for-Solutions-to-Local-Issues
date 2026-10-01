import { ROADS, SCENARIOS, SHELTERS, VILLAGES } from './data.js';
import { analyzeAll, analyzeVillage, scenarioState } from './engine.js';

const STATUS_LABELS = {
  open: '통행 가능 · 시연',
  closed: '통제 · 시연',
  unknown: '확인 불가 · 시연'
};
const SHELTER_LABELS = {
  open: '개방 · 시연',
  closed: '미개방 · 시연',
  unknown: '확인 불가 · 시연'
};
const STATUS_RANK = {blocked:0, unknown:1, connected:2};

export function scenarioMinute(id) {
  const scenario = SCENARIOS.find(item => item.id === id) ?? SCENARIOS[1];
  const [hours, minutes] = scenario.time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function confirmEvidence(kind, id, state) {
  const currentMinute = scenarioMinute(state.scenario);
  if (kind === 'road') {
    if (!ROADS.some(item => item.id === id)) return state;
    const status = state.roads?.[id];
    if (status !== 'open' && status !== 'closed') return state;
    return {
      ...state,
      roadChecks:{...state.roadChecks, [id]:currentMinute}
    };
  }
  if (kind === 'shelter') {
    if (!SHELTERS.some(item => item.id === id)) return state;
    const status = state.shelters?.[id];
    if (status !== 'open' && status !== 'closed') return state;
    return {
      ...state,
      shelterChecks:{...state.shelterChecks, [id]:currentMinute}
    };
  }
  return state;
}

function clock(minute) {
  if (!Number.isFinite(minute)) return '미확인';
  const hours = String(Math.floor(minute / 60)).padStart(2, '0');
  const minutes = String(minute % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function scenarioLabel(id) {
  const scenario = SCENARIOS.find(item => item.id === id);
  return scenario ? `${scenario.time} ${scenario.title}` : '시나리오 미확정';
}

function statusOf(map, id) {
  return map?.[id] ?? 'unknown';
}

function validCheckMinute(value, currentMinute) {
  return Number.isInteger(value) && value >= 0 && value <= currentMinute;
}

function checkedMinute(kind, id, state, status) {
  if (status === 'unknown') return null;
  const checks = kind === 'road' ? state.roadChecks : state.shelterChecks;
  const value = checks?.[id];
  const currentMinute = scenarioMinute(state.scenario);
  return validCheckMinute(value, currentMinute) ? value : currentMinute - 5;
}

function evidenceFreshness(kind, id, state, status) {
  const checked = checkedMinute(kind, id, state, status);
  if (checked === null) {
    return {
      source:'훈련 상황표 · 미확인',
      checkedAt:'미확인',
      ageMinutes:null,
      freshness:'unknown'
    };
  }
  const checks = kind === 'road' ? state.roadChecks : state.shelterChecks;
  const manual = validCheckMinute(checks?.[id], scenarioMinute(state.scenario));
  const ageMinutes = Math.max(0, scenarioMinute(state.scenario) - checked);
  return {
    source:manual ? (kind === 'road' ? '도로 수동 확인 · 시연' : '시설 수동 확인 · 시연') : '훈련 상황표 · 시연',
    checkedAt:clock(checked),
    ageMinutes,
    freshness:ageMinutes > 30 ? 'stale' : 'recent'
  };
}

function roadEvidence(id, state) {
  const road = ROADS.find(item => item.id === id);
  if (!road) return null;
  const status = statusOf(state.roads, id);
  return {
    id,
    kind:'road',
    name:road.name,
    status,
    label:STATUS_LABELS[status] ?? STATUS_LABELS.unknown,
    ...evidenceFreshness('road', id, state, status)
  };
}

function shelterEvidence(id, state) {
  const shelter = SHELTERS.find(item => item.id === id);
  if (!shelter) return null;
  const status = statusOf(state.shelters, id);
  return {
    id,
    kind:'shelter',
    name:shelter.name,
    status,
    label:SHELTER_LABELS[status] ?? SHELTER_LABELS.unknown,
    ...evidenceFreshness('shelter', id, state, status)
  };
}

function addEvidence(items, seen, item) {
  if (!item) return;
  const key = `${item.kind}:${item.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

function pendingLogs(id, logs) {
  return logs.filter(log => log?.village === id && log.status !== '확인 완료');
}

function relatedEvidence(id, result, state) {
  const items = [];
  const seen = new Set();
  const routeEdges = result.route?.edges ?? [];
  if (routeEdges.length) {
    for (const edge of routeEdges) addEvidence(items, seen, roadEvidence(edge, state));
    addEvidence(items, seen, shelterEvidence(result.route.target, state));
    return items;
  }
  for (const road of ROADS.filter(item => item.from === id || item.to === id)) {
    addEvidence(items, seen, roadEvidence(road.id, state));
    const target = [road.from, road.to].find(node => node !== id);
    if (SHELTERS.some(shelter => shelter.id === target)) addEvidence(items, seen, shelterEvidence(target, state));
  }
  return items;
}

function staleItems(items) {
  return items.filter(item => item.freshness === 'stale');
}

function unknownItems(items) {
  return items.filter(item => item.freshness === 'unknown' || item.status === 'unknown');
}

function evidenceSummary(result, items) {
  const village = VILLAGES.find(item => item.id === result.id);
  if (result.status === 'connected') {
    const target = SHELTERS.find(item => item.id === result.route?.target)?.name ?? '개방 시설';
    return `${village.name}은 시연 도로망에서 ${target}까지 연결 경로가 있습니다.`;
  }
  if (result.status === 'unknown') {
    const names = unknownItems(items).map(item => item.name).join(', ');
    return `${village.name}은 후보 경로가 있으나 ${names || '일부 구간'} 확인이 비어 있습니다.`;
  }
  return `${village.name}은 현재 입력된 시연 상태에서 개방 시설 연결을 찾지 못했습니다.`;
}

function nextAction(result, items, pendingReports) {
  const stale = staleItems(items);
  if (stale.length) return `${stale[0].name} 확인이 30분을 넘었습니다. 상태를 재확인한 뒤 해당 도로·시설의 재확인 버튼으로 기록하세요.`;
  if (pendingReports > 0) return `미확인 신고 ${pendingReports}건을 현장 확인 기록으로 전환하세요.`;
  const unknown = unknownItems(items);
  if (unknown.length) return `${unknown[0].name}부터 실제 통제 여부를 확인하세요.`;
  if (result.status === 'blocked') return '인접 도로와 시설 운영 상태를 다시 확인해 인계표에 남기세요.';
  return '현재 경로 구간과 시설 운영 상태를 다음 정시 확인 때 재검토하세요.';
}

function checklistFor(result, items, pending) {
  const checks = items.map(item => {
    if (item.kind === 'road') return `${item.name} 상태: ${item.label}, 확인 시각 ${item.checkedAt}`;
    return `${item.name} 운영 상태: ${item.label}, 확인 시각 ${item.checkedAt}`;
  });
  if (result.route) {
    checks.push(`후보 시설 ${SHELTERS.find(item => item.id === result.route.target)?.name ?? result.route.target}까지의 시연 경로 구간을 순서대로 재확인`);
  } else {
    checks.push('인접 도로와 가까운 시연 시설을 별도로 확인해 연결 불가 사유 기록');
  }
  if (pending > 0) checks.push(`미확인 신고 ${pending}건의 위치·시간·사진 여부 확인`);
  return checks;
}

export function getVillageEvidence(id, state, logs = []) {
  const result = analyzeVillage(id, state);
  const items = relatedEvidence(id, result, state);
  const pendingReports = pendingLogs(id, logs).length;
  return {
    summary:evidenceSummary(result, items),
    nextAction:nextAction(result, items, pendingReports),
    items,
    checklist:checklistFor(result, items, pendingReports),
    pendingReports
  };
}

function baselineState(state) {
  if (!Number.isInteger(state.scenario) || state.scenario <= 0) return null;
  return scenarioState(state.scenario - 1);
}

function changeType(before, after) {
  if (before.status === after.status) return 'same';
  return STATUS_RANK[after.status] < STATUS_RANK[before.status] ? 'worsened' : 'improved';
}

function comparisonFor(state) {
  const baseline = baselineState(state);
  const beforeRows = baseline ? analyzeAll(baseline) : analyzeAll(state);
  const afterRows = analyzeAll(state);
  const rows = VILLAGES.map(village => {
    const before = beforeRows.find(item => item.id === village.id);
    const after = afterRows.find(item => item.id === village.id);
    return {
      id:village.id,
      before:{status:before.status, label:before.label},
      after:{status:after.status, label:after.label},
      change:baseline ? changeType(before, after) : 'same'
    };
  });
  return {
    baselineScenario:baseline?.scenario ?? null,
    title:baseline ? `${scenarioLabel(baseline.scenario)} 대비` : '이전 시나리오 없음',
    changedCount:rows.filter(row => row.change !== 'same').length,
    rows
  };
}

export function getOperationalContext(state, logs = []) {
  const results = analyzeAll(state);
  const counts = {blocked:0, unknown:0, connected:0};
  for (const result of results) counts[result.status] += 1;
  const pendingReportCount = logs.filter(log => log?.status !== '확인 완료').length;
  const priorities = results.map(result => {
    const evidence = getVillageEvidence(result.id, state, logs);
    return {
      id:result.id,
      status:result.status,
      label:result.label,
      reason:result.reason,
      nextAction:evidence.nextAction,
      pendingReports:evidence.pendingReports
    };
  }).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.pendingReports - a.pendingReports || a.id.localeCompare(b.id));
  return {
    clock:clock(scenarioMinute(state.scenario)),
    counts,
    pendingReportCount,
    priorities,
    briefing:{
      title:`${clock(scenarioMinute(state.scenario))} 운산면 접근성 시연 브리핑`,
      lines:[
        `시연용 가상 도로·시설 데이터 기준: 연결 확인 불가 ${counts.blocked}곳, 추가 확인 필요 ${counts.unknown}곳, 연결 경로 있음 ${counts.connected}곳입니다.`,
        pendingReportCount ? `미확인 신고 ${pendingReportCount}건은 도로 상태를 자동 변경하지 않으며 현장 확인 뒤 기록해야 합니다.` : '미확인 신고는 없으며, 정시 확인 기록을 유지하세요.',
        priorities[0] ? `우선 확인 대상은 ${VILLAGES.find(v => v.id === priorities[0].id)?.name}입니다: ${priorities[0].nextAction}` : '우선 확인 대상이 없습니다.'
      ]
    },
    comparison:comparisonFor(state)
  };
}
