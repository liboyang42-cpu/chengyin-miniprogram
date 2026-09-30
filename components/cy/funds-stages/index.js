const { buildFundsStages } = require('./view-model.js');
const app = getApp();

// 全部为 0 且不显示可提现行时,整块不画(否则只剩一个空的底色框)。
function hasVisibleRow(stages, showWithdrawable) {
  return !!(showWithdrawable || stages.pending || stages.disputed || !stages.amountsKnown
    || (Array.isArray(stages.complaintPeriod) && stages.complaintPeriod.length));
}

Component({
  properties: {
    // 提现页顶部已有「可提现余额」时传 false,避免同屏两个可提现数
    showWithdrawable: { type: Boolean, value: true },
  },
  data: { state: 'loading', stages: null, hasRows: false },
  lifetimes: {
    attached() { this.load(); },
  },
  methods: {
    // CU-C-92:可提现余额只有本组件这一处数据源(它自己拉的 /api/wallet/stages)。
    // 要按余额决定提现入口能不能用的页面(俱乐部分润)通过 bind:stages 取用,
    // 别各自再打一次同一接口 —— 两个数迟早漂成两说。
    // known=false 表示「算不出」:amountsKnown=false 时余额会被低估,不能当 0 用。
    emitStages(stages) {
      const withdrawable = stages ? Number(stages.withdrawable) : NaN;
      const known = !!stages && stages.amountsKnown && Number.isFinite(withdrawable);
      this.triggerEvent('stages', { known: known, positive: known && withdrawable > 0 });
    },
    load() {
      this.setData({ state: 'loading' });
      app.sendRequest({
        hideLoading: true,
        url: '/api/wallet/stages',
        data: {},
        method: 'POST',
        header: { 'content-type': 'application/json' },
        success: (res) => {
          const stages = res && res.code == 200 ? buildFundsStages(res.data) : null;
          if (stages) this.setData({ state: 'ready', stages, hasRows: hasVisibleRow(stages, this.data.showWithdrawable) });
          else this.setData({ state: 'error' });
          this.emitStages(stages);
        },
        fail: () => { this.setData({ state: 'error' }); this.emitStages(null); },
      });
    },
  },
});
