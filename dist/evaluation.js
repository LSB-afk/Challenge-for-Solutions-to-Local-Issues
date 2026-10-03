import {
  EVALUATION_CASES,
  METHOD_DEFINITIONS,
  VILLAGE_STATUS,
  assistedRows,
  caseById,
  exportEvaluationCsv,
  firstValidRecords,
  methodById,
  normalizeTrialRecords,
  pairedMetrics,
  roadRows,
  scoreTrial,
  shelterRows,
  validateParticipantCode
} from './evaluation-engine.js';
import { ROADS, SHELTERS, VILLAGES } from './data.js';

const STORAGE_KEY = 'unsan-evaluation-records-v1';

const elements = {
  form: document.querySelector('#trial-form'),
  code: document.querySelector('#participant-code'),
  caseSelect: document.querySelector('#case-select'),
  methodSelect: document.querySelector('#method-select'),
  orderSelect: document.querySelector('#order-select'),
  start: document.querySelector('#start-button'),
  submit: document.querySelector('#submit-button'),
  cancel: document.querySelector('#cancel-button'),
  message: document.querySelector('#form-message'),
  caseTitle: document.querySelector('#case-title'),
  caseSummary: document.querySelector('#case-summary'),
  methodNote: document.querySelector('#method-note'),
  sourceView: document.querySelector('#source-view'),
  timer: document.querySelector('#timer'),
  villageAnswers: document.querySelector('#village-answers'),
  roadChecks: document.querySelector('#road-checks'),
  shelterChecks: document.querySelector('#shelter-checks'),
  latest: document.querySelector('#latest-result'),
  recordsBody: document.querySelector('#records-body'),
  metrics: document.querySelector('#metrics-summary'),
  exportButton: document.querySelector('#export-button')
};

let startedAt = 0;
let timerHandle = 0;
let records = loadRecords();
let activeTrial = null;

init();

function init() {
  elements.caseSelect.innerHTML = EVALUATION_CASES.map(item => `<option value="${item.id}">${escapeHtml(item.title)}</option>`).join('');
  elements.methodSelect.innerHTML = METHOD_DEFINITIONS.map(item => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join('');
  renderAnswerControls();
  renderRecords();
  elements.start.addEventListener('click', startTrial);
  elements.cancel.addEventListener('click', cancelTrial);
  elements.form.addEventListener('submit', submitTrial);
  elements.exportButton.addEventListener('click', exportRecords);
  elements.caseSelect.addEventListener('change', renderIdleCase);
  elements.methodSelect.addEventListener('change', renderIdleCase);
  renderIdleCase();
}

function startTrial() {
  if (activeTrial) return;
  const codeValidation = validateParticipantCode(elements.code.value);
  if (!codeValidation.ok) {
    elements.message.textContent = codeValidation.message;
    return;
  }
  const evalCase = caseById(elements.caseSelect.value);
  const method = methodById(elements.methodSelect.value);
  activeTrial = {
    participantCode: codeValidation.value,
    caseId: evalCase.id,
    methodId: method.id,
    order: elements.orderSelect.value
  };
  startedAt = performance.now();
  elements.submit.disabled = false;
  elements.cancel.disabled = false;
  setSetupLocked(true);
  elements.latest.textContent = '새 평가가 진행 중입니다. 제출 후 정답과 오류를 확인할 수 있습니다.';
  elements.message.textContent = `${method.label}으로 ${evalCase.title} 평가를 시작했습니다.`;
  renderCase(evalCase, method);
  updateTimer();
  clearInterval(timerHandle);
  timerHandle = setInterval(updateTimer, 100);
}

function submitTrial(event) {
  event.preventDefault();
  if (!activeTrial || !startedAt) {
    elements.message.textContent = '시작 후 제출해야 합니다.';
    return;
  }
  const elapsedMs = performance.now() - startedAt;
  const input = collectInput(elapsedMs);
  const score = scoreTrial(input);
  if (!score.ok) {
    elements.message.textContent = score.errors.join(' ');
    return;
  }
  const record = {
    rawInput: input,
    order: activeTrial.order,
    submittedAt: new Date().toISOString()
  };
  const normalizedRecord = {
    ...record,
    ...score,
    valid: true
  };
  records.push(record);
  const saved = saveRecords(records);
  finishActiveTrial();
  renderLatest(normalizedRecord);
  renderRecords();
  if (saved) {
    elements.message.textContent = '제출되었습니다. 정답과 오류를 아래에서 확인하세요.';
  }
}

function cancelTrial() {
  if (!activeTrial) return;
  finishActiveTrial();
  clearAnswers();
  elements.latest.textContent = '평가가 취소되었습니다. 기록은 추가되지 않았습니다.';
  elements.message.textContent = '평가를 취소했습니다. 설정을 바꾼 뒤 다시 시작할 수 있습니다.';
  renderIdleCase();
}

function finishActiveTrial() {
  clearInterval(timerHandle);
  elements.submit.disabled = true;
  elements.cancel.disabled = true;
  startedAt = 0;
  activeTrial = null;
  updateTimer();
  setSetupLocked(false);
}

function collectInput(elapsedMs) {
  const answers = {};
  for (const village of VILLAGES) {
    const selected = document.querySelector(`input[name="village-${village.id}"]:checked`);
    answers[village.id] = selected?.value ?? '';
  }
  return {
    participantCode: activeTrial?.participantCode ?? elements.code.value,
    caseId: activeTrial?.caseId ?? elements.caseSelect.value,
    methodId: activeTrial?.methodId ?? elements.methodSelect.value,
    elapsedMs,
    answers,
    unknownRoads: [...document.querySelectorAll('input[name="unknown-road"]:checked')].map(input => input.value),
    unknownShelters: [...document.querySelectorAll('input[name="unknown-shelter"]:checked')].map(input => input.value)
  };
}

function renderIdleCase() {
  if (startedAt) return;
  const method = methodById(elements.methodSelect.value);
  elements.caseTitle.textContent = '사례를 시작하세요';
  elements.caseSummary.textContent = '시작을 누르면 선택한 사례 자료가 열리고 시간이 기록됩니다. 정답과 채점 결과는 제출 후에만 표시됩니다.';
  elements.methodNote.textContent = method.note;
  elements.sourceView.innerHTML = '<p class="hint">시작을 누르면 과제 자료가 열리고 시간이 기록됩니다.</p>';
}

function renderCase(evalCase, method) {
  elements.caseTitle.textContent = evalCase.title;
  elements.caseSummary.textContent = evalCase.summary;
  elements.methodNote.textContent = method.note;
  elements.sourceView.innerHTML = method.id === 'assist'
    ? renderAssistView(evalCase)
    : renderTableView(evalCase);
  clearAnswers();
}

function renderTableView(evalCase) {
  return `
    <div>
      <h3>도로 상태표</h3>
      ${renderRoadTable(evalCase.state)}
    </div>
    <div>
      <h3>시설 상태표</h3>
      ${renderShelterTable(evalCase.state)}
    </div>
  `;
}

function renderAssistView(evalCase) {
  const rows = assistedRows(evalCase.state).map(row => `
    <tr>
      <td>${escapeHtml(row.village)}</td>
      <td><span class="status ${row.status}">${escapeHtml(VILLAGE_STATUS[row.status])}</span></td>
      <td>${row.evidence.length ? escapeHtml(row.evidence.join(' / ')) : '경로 없음'}</td>
      <td>${escapeHtml(row.reason)}</td>
    </tr>
  `).join('');
  return `
    <div>
      <h3>연결 분석 결과</h3>
      <table class="data-table">
        <thead><tr><th>마을</th><th>판정</th><th>근거 경로</th><th>사유</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div>
      <h3>원자료</h3>
      ${renderRoadTable(evalCase.state)}
      ${renderShelterTable(evalCase.state)}
    </div>
  `;
}

function renderRoadTable(state) {
  const rows = roadRows(state).map(row => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.from)} ↔ ${escapeHtml(row.to)}</td>
      <td><span class="status ${row.status}">${statusLabel(row.status)}</span></td>
    </tr>
  `).join('');
  return `<table class="data-table"><thead><tr><th>도로</th><th>연결</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function setSetupLocked(locked) {
  for (const element of [elements.code, elements.caseSelect, elements.methodSelect, elements.orderSelect, elements.start]) {
    element.disabled = locked;
  }
}

function renderShelterTable(state) {
  const rows = shelterRows(state).map(row => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td><span class="status ${row.status}">${statusLabel(row.status)}</span></td>
    </tr>
  `).join('');
  return `<table class="data-table"><thead><tr><th>시설</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderAnswerControls() {
  elements.villageAnswers.innerHTML = VILLAGES.map(village => `
    <div class="village-card">
      <strong>${escapeHtml(village.name)}</strong>
      <div class="radio-row">
        ${Object.entries(VILLAGE_STATUS).map(([value, label]) => `
          <label><input type="radio" name="village-${village.id}" value="${value}"> ${label}</label>
        `).join('')}
      </div>
    </div>
  `).join('');
  elements.roadChecks.innerHTML = ROADS.map(road => `
    <label><input type="checkbox" name="unknown-road" value="${road.id}"> ${escapeHtml(road.name)}</label>
  `).join('');
  elements.shelterChecks.innerHTML = SHELTERS.map(shelter => `
    <label><input type="checkbox" name="unknown-shelter" value="${shelter.id}"> ${escapeHtml(shelter.name)}</label>
  `).join('');
}

function clearAnswers() {
  for (const input of document.querySelectorAll('.panel input[type="radio"], .panel input[type="checkbox"]')) input.checked = false;
}

function renderLatest(score) {
  const evalCase = caseById(score.caseId);
  const expected = score.villageResults.map(item => `${item.name}: 정답 ${VILLAGE_STATUS[item.expected]}, 제출 ${VILLAGE_STATUS[item.actual]}`).join(' · ');
  const unknownText = [
    ...score.missingRoads.map(id => `누락 도로 ${roadName(id)}`),
    ...score.missingShelters.map(id => `누락 시설 ${shelterName(id)}`),
    ...score.extraRoads.map(id => `과잉 도로 ${roadName(id)}`),
    ...score.extraShelters.map(id => `과잉 시설 ${shelterName(id)}`)
  ].join(' · ') || '미확인 항목 오류 없음';
  elements.latest.innerHTML = `
    <strong>${escapeHtml(evalCase.title)} 채점 결과</strong><br>
    시간 ${formatMs(score.elapsedMs)} · 마을 오류 ${score.villageErrors} · 추가확인 누락 ${score.missedUnknownVillages} · 미확인 항목 오류 ${score.missingUnknownItems + score.extraUnknownItems}<br>
    ${escapeHtml(expected)}<br>
    ${escapeHtml(unknownText)}
  `;
}

function renderRecords() {
  const metrics = pairedMetrics(records);
  if (metrics.acceptedCount === 0) {
    elements.metrics.textContent = '참여평가 미실시. 자동 회귀 테스트와 사람의 업무효과 결과는 별도로 봅니다.';
  } else if (metrics.pairCount === 0) {
    elements.metrics.textContent = `최초 유효 기록 ${metrics.acceptedCount}건, 짝지어진 비교 0건. 같은 코드와 사례에서 두 방식을 모두 제출해야 시간 비교를 계산합니다.`;
  } else {
    const percent = metrics.medianPercentChange === null ? '계산 불가' : `${metrics.medianPercentChange.toFixed(1)}%`;
    const delta = metrics.medianDeltaMs === null ? '계산 불가' : formatSignedMs(metrics.medianDeltaMs);
    const errorDelta = metrics.medianErrorDelta === null ? '계산 불가' : metrics.medianErrorDelta.toFixed(1);
    elements.metrics.textContent = `짝지어진 비교 ${metrics.pairCount}건. 중앙 시간 차이 ${delta}, 중앙 변화율 ${percent}, 중앙 오류 차이 ${errorDelta}. 음수는 연결 분석 보조가 더 오래 걸리거나 오류가 늘어난 경우입니다.`;
  }
  const { accepted } = firstValidRecords(records);
  const firstRecords = new Set(accepted);
  const normalized = normalizeTrialRecords(records);
  elements.recordsBody.innerHTML = normalized.map(record => {
    const first = firstRecords.has(record);
    return `
      <tr>
        <td>${escapeHtml(record.participantCode)}</td>
        <td>${escapeHtml(caseById(record.caseId).title)}</td>
        <td>${escapeHtml(methodById(record.methodId).label)}</td>
        <td>${formatMs(record.elapsedMs)}</td>
        <td>${record.totalErrors}</td>
        <td class="${first ? 'accepted' : 'retry'}">${first ? '최초 유효값' : '재시도'}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6">기록 없음</td></tr>';
}

function exportRecords() {
  const blob = new Blob([exportEvaluationCsv(records)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `unsan-evaluation-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? normalizeTrialRecords(parsed) : [];
  } catch {
    elements.message.textContent = '브라우저 저장소를 읽을 수 없어 이번 화면에서만 기록합니다.';
    return [];
  }
}

function saveRecords(nextRecords) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
    return true;
  } catch {
    elements.message.textContent = '브라우저 저장소에 저장하지 못했습니다. CSV로 내보내면 현재 기록은 보존할 수 있습니다.';
    return false;
  }
}

function updateTimer() {
  if (!startedAt) {
    elements.timer.textContent = '00:00.0';
    return;
  }
  elements.timer.textContent = formatMs(performance.now() - startedAt);
}

function formatMs(ms) {
  const value = Math.max(0, Math.round(ms));
  const minutes = Math.floor(value / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  const tenths = Math.floor((value % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function formatSignedMs(ms) {
  if (!Number.isFinite(ms)) return '계산 불가';
  const sign = ms < 0 ? '-' : '+';
  return `${sign}${formatMs(Math.abs(ms))}`;
}

function statusLabel(status) {
  if (status === 'open') return '개방';
  if (status === 'closed') return '통제/폐쇄';
  return '미확인';
}

function roadName(id) {
  return ROADS.find(road => road.id === id)?.name ?? id;
}

function shelterName(id) {
  return SHELTERS.find(shelter => shelter.id === id)?.name ?? id;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}
