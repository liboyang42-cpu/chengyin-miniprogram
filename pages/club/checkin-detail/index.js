/**
 * 俱乐部端 · 核销详情(Figma K3 / A–H 八态)
 *
 * 为什么俱乐部要自己一页:实现在 pages/merchant/ledger/order-detail 的是**商家侧**,
 * 按商家身份取数,俱乐部进不去也不该进。这页按 clubId + registrationId 取,
 * 归属判定在 SQL 的 where 里(不是查完再比)。
 *
 * ★ 手机号:服务端按岗位权限裁好再下发。没权限时 phoneText 是替代说明而不是空 ——
 *   空会被读成「这客户没留电话」。前端原样显示,不自己拼、不自己判条件。
 */
const app = getApp();
const toast = require('../../../utils/toast.js');
const { bizFailureMessage } = require('../../../utils/response-shape.js');
const cancellationFeedback = require('../../../utils/cancellation-feedback.js');
const modal = require('../../../utils/modal.js');
// 「回执未知 ≠ 失败」这几条判据与报名名册共用,别在这儿复制一份
const {
  isUnknownHttpStatus, isPermissionFailure, identityKey,
} = require('../utils/owner-action-guard.js');

const jsonHeader = () => ({ 'Content-Type': 'application/json' });

// 履约轨迹四步。走到哪亮到哪,后面一律灰 —— 没发生的事不给颜色。
const RAIL = [
  { key: 'signed', label: '已报名', tone: 'success' },
  { key: 'contacted', label: '已接洽', tone: 'warning' },
  { key: 'verified', label: '已核销', tone: 'success' },   // 已核销是走完不是危险,danger 留给退款
  // 2026-09-11:第四格原来写「待评价」,而另外三格都是「已X」—— 亮不亮由 railStep 表达,
  // 文案再说一遍「待」会和亮着的样子打架。后端现在真的会给 railStep=3(merchant_review 有可见评价)。
  { key: 'reviewed', label: '已评价', tone: 'success' },
];

Page({
  data: {
    state: 'loading',      // loading | ready | missing | denied | error
    errorText: '',
    detail: null,
    rail: [],
    // 清退退款 2026-09-09 从报名名册行内挪到这一页底部:名册一屏几十行,
    // 行内点退款太容易点错人;这里至少先把这单是谁、买了什么摆在眼前。
    refunding: false,
    refundErrorText: '',
    refundErrorUnknown: false,
  },

  onLoad(query) {
    this._clubId = query && query.clubId ? String(query.clubId) : '';
    this._registrationId = query && query.registrationId ? String(query.registrationId) : '';
    if (!this._clubId || !this._registrationId) {
      this.setData({ state: 'missing', errorText: '缺少核销记录编号，请从名册或客户列表重新进入' });
      return;
    }
    this.load();
  },
  onPullDownRefresh() { this.load(true); },

  load(fromPull) {
    if (this.data.state !== 'ready') this.setData({ state: 'loading' });
    const that = this;
    const done = () => { if (fromPull && typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh(); };
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/crm/checkin/detail', method: 'POST',
      data: JSON.stringify({ clubId: this._clubId, registrationId: this._registrationId }),
      header: jsonHeader(),
      success(res) {
        done();
        const code = Number(res && res.code);
        const msg = (res && res.msg) || '';
        if (code === 403 || /权限/.test(msg)) {
          that.setData({ state: 'denied', errorText: msg || '当前岗位没有核销查看权限，请联系主理人' });
          return;
        }
        if (code !== 200 || !res.data) {
          // 200 但缺 data 时 msg 是「操作成功」,不能当失败原因(2026-09-17 拍板)。
          that.setData({ state: 'error', errorText: bizFailureMessage(res, '网络不稳定，请检查连接后重试') });
          return;
        }
        that.setData({ state: 'ready', detail: res.data, rail: that.buildRail(res.data.railStep) });
        // 有一笔回执未知的退款挂着 —— 用刚读回来的**对端事实**收口,
        // 而不是拿自己发出去的请求当证据。读到 REFUNDED 才算退成了。
        if (that._refundUnknown) {
          if (res.data.statusCode === 'REFUNDED') {
            that._refundUnknown = false;
            that.setData({ refundErrorUnknown: false, refundErrorText: '' });
            toast.success('已退款');
          } else {
            that.setData({
              refundErrorUnknown: true,
              refundErrorText: '退款结果仍未确认，这单还不是已退款；请稍后重新查询，不要重复提交',
            });
          }
        }
      },
      fail() {
        done();
        that.setData({ state: 'error', errorText: '网络不稳定，请检查连接后重试' });
      },
    });
  },

  buildRail(step) {
    const at = Number(step);
    return RAIL.map(function (s, i) {
      // railStep = -1 表示已退款:这条单没有走完履约,整条轨迹都不亮
      const on = Number.isFinite(at) && at >= 0 && i <= at;
      return { key: s.key, label: s.label, tone: on ? s.tone : 'muted', current: i === at };
    });
  },

  /* ——— 清退退款(owner-only,服务端 canRefund 说了算)———
   * ★ 「回执未知」必须与「失败」分开:失败可以直接让人重试,未知不行 ——
   *   重试就是重复退款。未知一律去回读这单的状态,读到 REFUNDED 才算完。 */
  refund() {
    const d = this.data.detail;
    // ⚠️ refundErrorUnknown 也要挡在这里。WXML 上那个 is-disabled 只是灰一下,
    // bindtap 照样会触发 —— 「回执未知」时再点一次就是重复退款。
    if (!d || !d.canRefund || this.data.refunding || this.data.refundErrorUnknown) return;
    const regId = d.registrationId;
    if (!regId) return;
    const clickedIdentity = identityKey();
    const that = this;
    modal.show({
      dangerKey: 'club.enroll.refund', dangerParams: { name: d.displayName || '该玩家' },
      success(r) {
        if (!r.confirm || that.data.refunding) return;
        // 确认弹窗期间可能已经换了人登录,换了就不能把回执算到这个人头上
        if (clickedIdentity !== identityKey()) return;
        that.setData({ refunding: true, refundErrorText: '', refundErrorUnknown: false });
        app.sendRequest({
          url: '/api/registration/cancel-by-owner', method: 'POST', data: { id: regId },
          success(res) {
            if (Number(res && res.code) !== 200) { that.settleRefundFailure(res); return; }
            that._refundUnknown = false;
            that.setData({ refunding: false, refundErrorText: '', refundErrorUnknown: false });
            toast.success(cancellationFeedback(res), { duration: 5000 });
            that.load();
          },
          successStatusAbnormal(res, statusCode) {
            if (isUnknownHttpStatus(statusCode)) { that.markRefundUnknown(); return; }
            that.settleRefundFailure(res, statusCode);
          },
          // 网络断在半路:请求可能已经到了服务端,同样按未知处理去回读
          fail() { that.markRefundUnknown(); },
        });
      },
    });
  },

  settleRefundFailure(value, statusCode) {
    if (isPermissionFailure(value, statusCode)) {
      this.setData({ state: 'denied', refunding: false, refundErrorText: '', refundErrorUnknown: false });
      return;
    }
    this.setData({
      refunding: false,
      refundErrorUnknown: false,
      refundErrorText: String((value && (value.msg || value.message)) || '退款没有完成，请重试'),
    });
  },

  markRefundUnknown() {
    this._refundUnknown = true;
    this.setData({
      refunding: false,
      refundErrorUnknown: true,
      refundErrorText: '退款结果未确认，正在回读这单的状态；确认完成前请勿重复提交',
    });
    this.load();
  },

  retryRefundReadback() { this.load(); },

  retry() { this.load(); },
  goBack() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/index/index' }); } }); },
});
