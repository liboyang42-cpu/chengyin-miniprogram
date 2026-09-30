// 城瘾 · 俱乐部客户详情(K2 / K2-B 金额无权限 / K2-C 暂无记录 / K2-D 无权限 / K2-E 加载失败 / K2-F 编辑标签与备注)
//
// 数据:POST /api/club/crm/customers/detail   { clubId, memberId }
//      POST /api/club/crm/customers/tag-remark { clubId, memberId, tags, remark, requestId }
//
// ★ 三条服务端裁决,前端不猜:
//   1) 手机号:只认服务端渲染好的 summary.phoneText(已脱敏或替代说明),前端拿不到原始号码。
//   2) 金额:paidAmount 为 null = 本岗位无金额查看权限(K2-B),不是加载失败。
//   3) 是否能编辑标签备注:canEdit 由服务端下发,前端不按角色自行推断。
const toast = require('../../../utils/toast.js');
const app = getApp();
const { buildTagRemarkDraft, positiveId, shapeCustomerDetail } = require('../customers/view-model.js');

function jsonBody(data) { return JSON.stringify(data || {}); }
function jsonHeader() { return { 'Content-Type': 'application/json' }; }

// 鉴权类失败的判据。它回答的**不是**「要不要显示『没权限』」,而是
// 「这次失败是不是身份/授权问题、要不要立刻丢掉已经缓存的客户 PII」。
// 分流在下面 deny() 里做:只有 403 才是真的岗位没权限。
//
// ⚠️ 2026-09-02 曾把 401 / code 2 从这里摘出去,想借此干掉「未登录被说成没权限」
//    的错文案 —— 结果连带把清空名单那条路也断了:401 落进通用错误分支,
//    上一个身份的姓名和手机号还留在屏幕上。判据要宽,分流才要窄。
function isAuthFailure(value, statusCode) {
  const bodyCode = value && (value.code != null ? value.code : value.statusCode);
  const code = Number(bodyCode != null && [2, 401, 403].includes(Number(bodyCode)) ? bodyCode : statusCode);
  const message = String((value && (value.msg || value.message)) || '');
  return code === 2 || code === 401 || code === 403
    || /请先登录|登录已|身份已|没有权限|无权|仅(?:俱乐部)?主理人/.test(message);
}

function isForbidden(value, statusCode) {
  const bodyCode = value && (value.code != null ? value.code : value.statusCode);
  const code = Number(bodyCode != null && Number(bodyCode) === 403 ? bodyCode : statusCode);
  return code === 403 || /没有权限|无权|仅(?:俱乐部)?主理人/.test(String((value && (value.msg || value.message)) || ''));
}

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    state: 'loading', // loading | ready | no-permission | error | network-error
    errorText: '',
    detail: null,
    editing: false,
    draftTags: [],
    draftRemark: '',
    draftTagInput: '',
    draftError: '',
    saving: false,
  },

  onLoad(options) {
    this._memberId = positiveId(options && options.memberId);
    this._clubId = (options && options.clubId) || null;
    this.setData({ clubId: this._clubId });   // wxml 的 cy-access-gate 读它做范围核对;不喂 = 守卫永远停在 checking
    this.load();
  },

  onUnload() { this._epoch = (this._epoch || 0) + 1; },

  // E-13(2026-09-16):从子页(如用户主页)返回后重拉,别让客户资料停在旧值;首展由 onLoad 负责。
  onShow() {
    if (!this._hasShown) { this._hasShown = true; return; }
    if (this.data.state === 'ready') this.load();
  },

  onPullDownRefresh() { this.load(); },

  goBack() {
    if (getCurrentPages().length > 1) { wx.navigateBack({ delta: 1 }); return; }
    wx.redirectTo({ url: '/pages/club/customers/index?clubId=' + (this._clubId || '') });
  },

  retry() { this.load(); },

  load() {
    if (!this._clubId || this._memberId == null) {
      this.setData({ state: 'error', errorText: '缺少客户信息，请从客户列表重新进入' });
      return;
    }
    const epoch = (this._epoch || 0) + 1;
    this._epoch = epoch;
    const that = this;
    this.setData({ state: this.data.state === 'ready' ? 'ready' : 'loading' });
    app.sendRequest({
      hideLoading: true,
      url: '/api/club/crm/customers/detail',
      autoErrorToast: false, // 失败由整页 auto-back fail 半屏讲原因,不再叠 toast
      method: 'POST',
      header: jsonHeader(),
      data: jsonBody({ clubId: this._clubId, memberId: this._memberId }),
      complete() { wx.stopPullDownRefresh(); },
      success(res) {
        if (epoch !== that._epoch) return;
        if (!res || res.code != '200') {
          if (isAuthFailure(res)) { that.deny(res); return; }
          that.setData({ state: 'error', errorText: (res && res.msg) || '网络不稳定，稍后再试一次' });
          return;
        }
        // shapeCustomerDetail 会核对回包里的 memberId 与路由参数一致,拒收串号响应
        const shaped = shapeCustomerDetail(res.data, that._memberId);
        if (!shaped) {
          that.setData({ state: 'error', errorText: '客户详情数据格式异常' });
          return;
        }
        that.setData({ state: 'ready', detail: shaped, errorText: '', editing: false });
      },
      successStatusAbnormal(res, statusCode) {
        if (epoch !== that._epoch) return;
        if (isAuthFailure(res, statusCode)) { that.deny(res, statusCode); return; }
        that.setData({ state: 'error', errorText: (res && res.msg) || '网络不稳定，稍后再试一次' });
      },
      fail(value, statusCode) {
        if (epoch !== that._epoch) return;
        if (isAuthFailure(value, statusCode)) { that.deny(value, statusCode); return; }
        that.setData({ state: 'network-error', errorText: '网络不稳定，稍后再试一次' });
      },
    });
  },

  // 403 才是「岗位没权限」;401/登录失效/通用业务错误是另一回事,
  // 说成没权限会把人指去找主理人,而真正该做的是重新登录或重试。
  // 但**两种都要清掉已经渲染出来的客户 PII** —— 身份已经不作数了。
  deny(value, statusCode) {
    const forbidden = isForbidden(value, statusCode);
    const msg = (value && (value.msg || value.message)) || '';
    this.setData({
      state: forbidden ? 'no-permission' : 'error',
      errorText: forbidden ? (msg || '请联系主理人调整角色权限，或返回客户列表')
                           : (msg || '登录状态已变化，请重新进入客户详情'),
      detail: null,
    });
  },

  openRecord(e) {
    const topicId = e.currentTarget.dataset.topicId;
    if (!topicId) return;
    wx.navigateTo({ url: '/pages/topic/index/index?id=' + topicId });
  },

  // ---- K2-F 编辑标签与备注 ----
  startEdit() {
    const detail = this.data.detail;
    if (!detail || !detail.canEdit) return;
    this.setData({
      editing: true,
      draftTags: detail.tags.slice(),
      draftRemark: detail.remark,
      draftTagInput: '',
      draftError: '',
    });
  },

  cancelEdit() { this.setData({ editing: false, draftError: '' }); },

  onTagInput(e) { this.setData({ draftTagInput: (e.detail && e.detail.value) || '' }); },

  addTag() {
    const name = String(this.data.draftTagInput || '').trim();
    if (!name) return;
    const draft = buildTagRemarkDraft(this.data.draftTags.concat([name]), this.data.draftRemark);
    if (!draft.valid) { this.setData({ draftError: draft.error }); return; }
    this.setData({ draftTags: draft.tags, draftTagInput: '', draftError: '' });
  },

  removeTag(e) {
    const index = Number(e.currentTarget.dataset.index);
    const tags = this.data.draftTags.slice();
    if (!Number.isInteger(index) || index < 0 || index >= tags.length) return;
    tags.splice(index, 1);
    this.setData({ draftTags: tags, draftError: '' });
  },

  onRemarkInput(e) { this.setData({ draftRemark: (e.detail && e.detail.value) || '' }); },

  saveTagRemark() {
    if (this.data.saving) return;
    const draft = buildTagRemarkDraft(this.data.draftTags, this.data.draftRemark);
    if (!draft.valid) { this.setData({ draftError: draft.error }); return; }
    const that = this;
    this._requestSeq = (this._requestSeq || 0) + 1;
    const requestId = `club-crm-${Date.now().toString(36)}-${this._requestSeq}`;
    this.setData({ saving: true, draftError: '' });
    app.sendRequest({
      hideLoading: true,
      url: '/api/club/crm/customers/tag-remark',
      method: 'POST',
      header: jsonHeader(),
      data: jsonBody({
        clubId: this._clubId,
        memberId: this._memberId,
        tags: draft.tags,
        remark: draft.remark,
        requestId,
      }),
      complete() { that.setData({ saving: false }); },
      success(res) {
        if (!res || res.code != '200') {
          that.setData({ draftError: (res && res.msg) || '标签与备注没保存成功，请重试' });
          return;
        }
        that.setData({ editing: false });
        toast('已保存');
        that.load();
      },
      successStatusAbnormal(res) {
        that.setData({ draftError: (res && res.msg) || '标签与备注没保存成功，请重试' });
      },
      fail() {
        // 写失败不许静默:不知道服务端到底存没存,必须让用户看见并自己决定重试
        that.setData({ draftError: '网络不稳定，标签与备注可能没保存成功，请重新打开确认' });
      },
    });
  },
});
