import { analyzeAll } from './engine.js';
import { getSituationEvidence } from './operations.js';

// Compare one item at a time. These alternatives are not observations or probabilities.
export function getConfirmationPriorities(state) {
  const baseline = analyzeAll(state);
  return getSituationEvidence(state)
    .filter(item => item.freshness === 'unknown' || item.freshness === 'stale')
    .map(item => {
      const key = item.kind === 'road' ? 'roads' : 'shelters';
      const outcomes = Object.fromEntries(['open', 'closed'].map(status => [status,
        analyzeAll({ ...state, [key]: { ...state[key], [item.id]: status } })
      ]));
      const villages = baseline.map(before => ({
        id: before.id,
        before: before.status,
        whenOpen: outcomes.open.find(row => row.id === before.id).status,
        whenClosed: outcomes.closed.find(row => row.id === before.id).status
      })).filter(row => row.whenOpen !== row.whenClosed);
      return { ...item, villages, affectedCount: villages.length };
    })
    .sort((a, b) => b.affectedCount - a.affectedCount ||
      Number(b.freshness === 'unknown') - Number(a.freshness === 'unknown') || a.id.localeCompare(b.id));
}
