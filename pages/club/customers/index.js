// 城瘾 · 俱乐部客户列表(K1 客户 · 列表)
// 「客户」按**人**聚合:这个人在我这买过几次、什么时候来的,可打标签写备注。
// 与报名名册(按团 pages/club/enroll,能清退退款)、本场名册(按场次,能核销)是三件事,别混。
//
// 数据:POST /api/club/crm/customers/list  { clubId, filter, keyword }
// ★ 手机号只认服务端渲染好的 phoneText —— 脱敏在服务端做,前端不藏号码(见 view-model.js)。
const app = getApp();
const { shapeCustomerList } = require('./view-model.js');

const FILTERS = Object.freeze([
  { key: 'all', label: '全部' },
  { key: 'repeat', label: '回头客' },
  { key: 'new', label: '新客' },
  { key: 'remark', label: '有备注' },
]);

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
    state: 'loading', // loading | ready | empty | no-permission | error | network-error
    // 这一页成功渲染过内容没有。只用来判 auto-back:首屏失败才自动退页,
    // 之后的搜索 / 换筛选失败留在页内,别把用户的关键词一起退掉(审查C A1)。
    everLoaded: false,
    errorText: '',
    filters: FILTERS,
    filterKey: 'all',
    keyword: '',
    countText: '',
    items: [],
  },

  onLoad(options) {
    this._clubId = (options && options.clubId) || (options && options.id) || null;
    this.setData({ clubId: this._clubId });   // 2026-09-06 起 wxml 的 cy-access-gate 读它做范围核对
    this.load();
  },

  onUnload() { this._epoch = (this._epoch || 0) + 1; },

  // E-13(2026-09-16):去客户详情改完备注/标签返回后,列表的「有备注」筛选与标记还是旧的。
  // 返回即重拉;首屏由 onLoad 负责(与 club/detail 同款 _hasShown 首展闸),错误态不覆盖。
  onShow() {
    if (!this._hasShown) { this._hasShown = true; return; }
    if (this.data.state === 'ready' || this.data.state === 'empty') this.load();
  },

  onPullDownRefresh() { this.load(); },

  goBack() {
    if (getCurrentPages().length > 1) { wx.navigateBack({ delta: 1 }); return; }
    if (this._clubId) { wx.redirectTo({ url: '/pages/club/detail/index?id=' + this._clubId }); return; }
    wx.switchTab({ url: '/pages/talent/list/index' });
  },

  retry() { this.load(); },

  onFilterTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.filterKey) return;
    this.setData({ filterKey: key }, () => this.load());
  },

  clearFilters() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.setData({ filterKey: 'all', keyword: '' }, () => this.load());
  },

  onKeywordInput(e) {
    const value = (e.detail && e.detail.value) || '';
    this.setData({ keyword: value });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.load(), 300);
  },

  onKeywordConfirm() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.load();
  },

  openCustomer(e) {
    const memberId = e.currentTarget.dataset.memberId;
    if (!memberId || !this._clubId) return;
    wx.navigateTo({
      url: `/pages/club/customer-detail/index?clubId=${this._clubId}&memberId=${memberId}`,
    });
  },

  load() {
    if (!this._clubId) {
      this.setData({ state: 'error', errorText: '缺少俱乐部信息，请从俱乐部页重新进入' });
      return;
    }
    const epoch = (this._epoch || 0) + 1;
    this._epoch = epoch;
    const that = this;
    this.setData({ state: this.data.state === 'ready' ? 'ready' : 'loading' });
    app.sendRequest({
      hideLoading: true,
      url: '/api/club/crm/customers/list',
      autoErrorToast: false, // 失败由整页 auto-back fail 半屏讲原因,不再叠 toast
      method: 'POST',
      header: jsonHeader(),
      data: jsonBody({ clubId: this._clubId, filter: this.data.filterKey, keyword: this.data.keyword }),
      complete() { wx.stopPullDownRefresh(); },
      success(res) {
        if (epoch !== that._epoch) return;
        if (!res || res.code != '200') {
          if (isAuthFailure(res)) { that.deny(res); return; }
          that.setData({ state: 'error', errorText: (res && res.msg) || '客户名单暂时不可用' });
          return;
        }
        const shaped = shapeCustomerList(res.data);
        if (!shaped) {
          that.setData({ state: 'error', errorText: '客户名单数据格式异常' });
          return;
        }
        that.setData({
          state: shaped.items.length ? 'ready' : 'empty',
          everLoaded: true,
          countText: shaped.countText,
          items: shaped.items,
          errorText: '',
        });
      },
      successStatusAbnormal(res, statusCode) {
        if (epoch !== that._epoch) return;
        if (isAuthFailure(res, statusCode)) { that.deny(res, statusCode); return; }
        that.setData({ state: 'error', errorText: (res && res.msg) || '客户名单暂时不可用' });
      },
      fail(value, statusCode) {
        if (epoch !== that._epoch) return;
        if (isAuthFailure(value, statusCode)) { that.deny(value, statusCode); return; }
        that.setData({ state: 'network-error', errorText: '检查网络后重新加载客户名单' });
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
      errorText: forbidden ? (msg || '请联系主理人调整角色权限')
                           : (msg || '登录状态已变化,请重新进入客户名单'),
      items: [],
    });
  },
});
