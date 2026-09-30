function normalizeMerchantFinanceRoute(options) {
  const opt = options || {};
  if (opt.view !== undefined && opt.view !== null && opt.view !== '') {
    const view = String(opt.view);
    if (view === 'redemptions' || view === 'settlement' || view === 'messages') {
      return { view, source: view === 'settlement' && opt.source ? String(opt.source) : '' };
    }
    return null;
  }
  const legacy = opt.tab === undefined || opt.tab === null || opt.tab === '' ? '0' : String(opt.tab);
  if (legacy === '0') return { view: 'redemptions', source: '' };
  if (legacy === '1') return { view: 'messages', source: '' };
  if (legacy === '2') return { view: 'settlement', source: '' };
  if (legacy === '3') return { view: 'settlement', source: 'coop' };
  return null;
}

function isFinancePagePayload(response) {
  const data = response && response.data;
  return !!(response && (response.code === 200 || response.code === '200')
    && data && isRecordList(data.rows) && Number.isFinite(Number(data.total)));
}

function isFinanceObjectPayload(response) {
  return !!(response && (response.code === 200 || response.code === '200')
    && response.data && typeof response.data === 'object' && !Array.isArray(response.data));
}

function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

module.exports = { normalizeMerchantFinanceRoute, isFinancePagePayload, isFinanceObjectPayload, money };
const { isRecordList } = require('../../../utils/response-shape.js');
