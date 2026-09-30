// 城瘾 · 俱乐部/发布者财务(报告§B9 · T7)
// 主理人视角:按主题看「我的分润 / 商家应收 / 打款状态 / 到账时间」。接后端 /api/coop/finance
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
// 2026-09-15 起「提现」不再跳银行卡表单:平台不打款,一律弹平台客服微信线下处理。
const withdrawCs = require('../../../utils/withdraw-cs.js');

// 分润明细 = 三级(记录)⇒ 场景弹窗,宿主是「账户收益」页。
// 取数与结算展示的唯一实现;pages/coop/finance 退化成深链薄壳。
// Figma G2「调整待处理 / 已执行调整」。两个数由服务端的扣回申请聚合而来;
// 服务端取不到时下发 null,这里原样保持 null —— 「不知道」不能显示成 ¥0.00。
function money(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

function statItems(myIncomeTotal, adjustments) {
  const a = adjustments && typeof adjustments === 'object' ? adjustments : {};
  const pending = money(a.pendingAmount);
  const executed = money(a.executedAmount);
  const items = [
    { key: 'income', label: '已入账分润', value: myIncomeTotal != null ? ('¥' + myIncomeTotal) : null },
  ];
  // 待处理为 0 时不占一行:0 元待处理不是需要主理人知道的事。取不到(null)则要显示「—」。
  if (pending === null || Number(pending) > 0) {
    items.push({ key: 'adjustPending', label: '调整待处理', value: pending === null ? null : ('¥' + pending) });
  }
  if (executed === null || Number(executed) > 0) {
    items.push({ key: 'adjustExecuted', label: '已执行调整', value: executed === null ? null : ('−¥' + executed) });
  }
  return items;
}

function adjustReason(adjustments) {
  const a = adjustments && typeof adjustments === 'object' ? adjustments : {};
  return typeof a.pendingReason === 'string' && a.pendingReason.trim() ? a.pendingReason.trim() : '';
}

Component({
  properties: { theme: { type: String, value: 'player' } },
    data: {
      topics: [],
      statItems: [],
      adjustReason: '',
      myIncomeTotal: null, // 已实际入账主题我的分润合计
      canWithdraw: false,
      withdrawState: 'unknown', // unknown / zero / positive，禁止把未知说成 0
      pendingCount: 0,     // 未结清主题数(未结算 / 金额待确认 / 商家待打款)
      loaded: false,
      loadErr: false,
      // 2026-09-17 总控裁定:余额三段只给主体本人;后端判定,前端不猜,缺省不显示
      isOwner: false,
    },
  lifetimes: { attached() { this.load() } },
  methods: {
    // 去主题详情/提现这些非场景目标:先关掉本层,不在弹窗上再压页面(§8.3)
    _leave(url) { this.triggerEvent('close'); wx.navigateTo({ url }); },
    load() {
      const that = this;
      app.sendRequest({
        hideLoading: true, url: '/api/coop/finance', method: 'POST',
        data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
        success(res) {
          if (!(res && res.code == '200' && res.data && typeof res.data === 'object'
              && !Array.isArray(res.data) && Array.isArray(res.data.topics)
              && res.data.topics.every(function (item) {
                return item && typeof item === 'object' && !Array.isArray(item);
              }))) {
            that.setData({ loaded: true, loadErr: true, canWithdraw: false, withdrawState: 'unknown' });
            return;
          }
          const d = res.data;
          let incomeTotal = 0;
          let hasUnknownIncomeFact = false;
          const money = function (value) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
            return value.toFixed(2);
          };
          const rows = d.topics.map(function (t) {
            const settledKnown = typeof t.settled === 'boolean';
            const settled = t.settled === true;
            const arrivedKnown = typeof t.myIncomeArrived === 'boolean';
            const arrived = t.myIncomeArrived === true;
            const incomeText = money(t.myIncome);
            const income = incomeText != null ? Number(incomeText) : null;
            const incomeCleared = settledKnown && settled && income != null
              && (income === 0 || (arrivedKnown && arrived));
            if (incomeCleared) {
              incomeTotal += income;
            }
            if (!settledKnown || (settled && (income == null || (income > 0 && !arrivedKnown)))) {
              hasUnknownIncomeFact = true;
            }
            const merchantTotalText = money(t.merchantTotal);
            const merchantPaidText = money(t.merchantPaid);
            const merchantTotal = merchantTotalText != null ? Number(merchantTotalText) : null;
            const merchantPaid = merchantPaidText != null ? Number(merchantPaidText) : null;
            let merchantStatus;
            if (merchantTotal == null) merchantStatus = '金额待确认';
            else if (merchantTotal <= 0) merchantStatus = '无商家分润';
            else if (merchantPaid == null) merchantStatus = '打款状态待确认';
            else if (merchantPaid != null && merchantPaid >= merchantTotal) merchantStatus = '已打款';
            else if (merchantPaid != null && merchantPaid > 0) merchantStatus = '部分打款';
            else merchantStatus = '待打款';
            const statusText = !settledKnown
              ? '结算状态待确认'
              : !settled
              ? '待结算'
              : (incomeText == null
                ? '金额待确认'
                : (income === 0
                  ? '无需入账'
                  : (!arrivedKnown ? '到账状态待确认' : (arrived ? '已入账' : '待入账'))));
            return {
              topicId: t.topicId,
              topicName: t.topicName || (t.topicId ? ('主题 #' + t.topicId) : '未命名主题'),
              settled: settled,
              settledKnown: settledKnown,
              arrived: arrived,
              arrivedKnown: arrivedKnown,
              incomeCleared: incomeCleared,
              statusText: statusText,
              badgeVariant: statusText === '已入账' ? 'success'
                : (/待确认/.test(statusText) ? 'neutral' : 'warning'),
              incomeText: incomeText,
              totalSalesText: money(t.totalSales),
              verifiedSalesText: money(t.verifiedSales),
              platformText: money(t.platformAmount),
              merchantTotalText: merchantTotalText,
              merchantStatus: merchantStatus,
              arriveText: t.merchantPayoutTime || t.merchantPayableTime || '',
              metaText: [merchantStatus, t.merchantPayoutTime ? String(t.merchantPayoutTime).slice(0, 10) : ''].filter(Boolean).join(' · '),
            };
          });
          // 未结算/待打款排在已结清前面,让主理人先看到仍需跟进的主题。
          const weight = function (row) {
            if (!row.settledKnown) return 0;
            if (!row.settled) return 0;
            if (row.incomeText == null || !row.arrivedKnown) return 1;
            if (!row.incomeCleared || row.merchantStatus === '金额待确认'
                || row.merchantStatus === '打款状态待确认'
                || row.merchantStatus === '待打款' || row.merchantStatus === '部分打款') return 2;
            return 3;
          };
          rows.sort(function (a, b) { return weight(a) - weight(b); });
          const myIncomeTotal = hasUnknownIncomeFact ? null : incomeTotal.toFixed(2);
          const canWithdraw = myIncomeTotal != null && Number(myIncomeTotal) > 0;
          const withdrawState = myIncomeTotal == null ? 'unknown' : (canWithdraw ? 'positive' : 'zero');
          const pendingCount = rows.filter(function (row) { return weight(row) < 3; }).length;
          that.setData({
            topics: rows,
            myIncomeTotal: myIncomeTotal,
            canWithdraw: canWithdraw,
            withdrawState: withdrawState,
            pendingCount: pendingCount,
            // Figma G2:已入账分润 + 两行结算调整。
            // ⚠️ 调整金额取不到时 value 给 null(cy-stat-card 会渲染成「—」),不给 ¥0.00 ——
            //    把「查不到」显示成「没有待处理调整」等于告诉主理人这笔钱是干净的。
            statItems: statItems(myIncomeTotal, res.data.adjustments),
            adjustReason: adjustReason(res.data.adjustments),
            isOwner: res.data.isOwner === true,
            loaded: true,
            loadErr: false,
          });
        },
        fail() { that.setData({ loaded: true, loadErr: true, canWithdraw: false, withdrawState: 'unknown' }); },
      });
    },

    onRetry() {
      this.setData({ loaded: false, loadErr: false, myIncomeTotal: null, canWithdraw: false, withdrawState: 'unknown', pendingCount: 0, statItems: [] });
      this.load();
    },

    goSettlementDetail(e) {
      const id = e.currentTarget.dataset.id;
      if (id != null && id !== '') this._leave('/pages/coop/settlement-detail/index?source=finance&topicId=' + id);
    },

    goWithdraw() {
      if (!this.data.canWithdraw) return;
      // 平台不打款:不再跳独立提现页(那是银行卡表单),改弹平台客服微信线下处理。
      withdrawCs.showWithdrawCsPopup();
    },

  },
})
