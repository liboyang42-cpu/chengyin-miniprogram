'use strict';

const HISTORY_MAX = 10;

function historyLabel(item) {
  if (typeof item === 'string' || typeof item === 'number') {
    return String(item).trim();
  }
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const raw = item.keyword || item.text || item.name || item.title || '';
    return String(raw).trim();
  }
  return '';
}

function normalizeSearchHistory(raw, max) {
  const limit = max == null ? HISTORY_MAX : max;
  if (!Array.isArray(raw)) return [];
  const seen = Object.create(null);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const label = historyLabel(raw[i]);
    if (!label || seen[label]) continue;
    seen[label] = true;
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

function searchHistoryStorageKey(memberId) {
  if (memberId === null || memberId === undefined || memberId === '') return '';
  return 'search2_history:' + String(memberId);
}

module.exports = {
  HISTORY_MAX,
  historyLabel,
  normalizeSearchHistory,
  searchHistoryStorageKey,
};
