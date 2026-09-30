const toast = require('../../../../utils/toast.js');
const app = getApp();

Component({
  properties: {
    show: { type: Boolean, value: false },
  },
  data: {
    state: 'idle',
    rows: [],
    error: '',
    savingKey: '',
  },
  observers: {
    show(value) {
      if (value) this.load();
    },
  },
  methods: {
    load(options) {
      if (this.data.state === 'loading') return;
      const preserveError = !!(options && options.preserveError === true);
      if (preserveError) this.setData({ state: 'loading' });
      else this.setData({ state: 'loading', error: '' });
      app.sendRequest({
        hideLoading: true,
        silentError: true,
        url: '/api/merchant/crm/marketing-consents',
        method: 'GET',
        success: (res) => {
          if (!ok(res) || !Array.isArray(res.data)) {
            this.setData({ state: 'error', error: shapeRequestError(res, '营销设置加载失败') });
            return;
          }
          const state = res.data.length ? 'ready' : 'empty';
          const rows = res.data.map(shapeMerchant);
          if (preserveError) this.setData({ state, rows });
          else this.setData({ state, rows, error: '' });
        },
        fail: () => this.setData({ state: 'error', error: '网络连接失败，请稍后重试' }),
      });
    },

    onConsentChange(e) {
      const merchantRowId = positiveSafeId(e.currentTarget.dataset && e.currentTarget.dataset.row);
      const merchantOwnerMemberId = positiveSafeId(e.currentTarget.dataset && e.currentTarget.dataset.owner);
      const channel = String((e.currentTarget.dataset && e.currentTarget.dataset.channel) || '');
      const optedIn = !!(e.detail && e.detail.value === true);
      if (!merchantRowId || !merchantOwnerMemberId || !['IN_APP', 'COUPON'].includes(channel)
          || this.data.savingKey) return;
      const savingKey = `${merchantRowId}:${channel}`;
      this.setData({ savingKey, error: '' });
      app.sendRequest({
        hideLoading: true,
        silentError: true,
        url: '/api/merchant/crm/marketing-consents',
        method: 'POST',
        data: JSON.stringify({ merchantRowId, merchantOwnerMemberId, channel, optedIn,
          requestId: requestId(optedIn ? 'opt-in' : 'opt-out') }),
        header: { 'Content-Type': 'application/json' },
        success: (res) => {
          if (!ok(res)) {
            this.setData({ savingKey: '', error: requestError(res, optedIn ? '同意保存失败' : '退订失败') });
            this.load({ preserveError: true });
            return;
          }
          const rows = this.data.rows.map(row => {
            if (row.merchantRowId !== merchantRowId) return row;
            return Object.assign({}, row, channel === 'IN_APP'
              ? { inAppOptedIn: optedIn } : { couponOptedIn: optedIn });
          });
          this.setData({ rows, savingKey: '', state: rows.length ? 'ready' : 'empty' });
          toast.success(optedIn ? '已同意' : '已退订');
        },
        fail: () => {
          this.setData({ savingKey: '', error: '网络连接失败，状态未更改' });
          this.load({ preserveError: true });
        },
      });
    },

    retry() { this.load(); },
  },
});

function shapeMerchant(value) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    merchantRowId: positiveSafeId(row.merchantRowId),
    merchantOwnerMemberId: positiveSafeId(row.merchantOwnerMemberId),
    merchantName: String(row.merchantName || '商家'),
    inAppOptedIn: row.inAppOptedIn === true,
    couponOptedIn: row.couponOptedIn === true,
  };
}

function positiveSafeId(value) {
  const out = Number(value);
  return Number.isSafeInteger(out) && out > 0 ? out : null;
}
function requestId(kind) {
  return `crm-consent-${kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xFFFFFF).toString(36)}`;
}
function ok(res) { return !!(res && (res.code === 200 || res.code === '200')); }
function requestError(res, fallback) {
  return (app.getRequestErrorMessage && app.getRequestErrorMessage(res, fallback)) || fallback;
}
// code=200 但数据形状不对时,res.msg 是「操作成功」,不能当失败原因(2026-09-17 拍板)。
function shapeRequestError(res, fallback) {
  return ok(res) ? fallback : requestError(res, fallback);
}
