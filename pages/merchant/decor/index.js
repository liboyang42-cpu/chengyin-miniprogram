// 城瘾 · 店铺装修(E0 地基)— 商家公开主页的唯一编辑器,所见即所得就地编,分区块即时保存
// 复用现有接口:读 /api/merchant/coop-profile(返回完整商家实体);
//   展示层存 /api/merchant/decor/save;品牌基础存 /api/merchant/update;
//   承接能力存 /api/merchant/coop-profile/save;营业状态存 /api/merchant/business-status/update
const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const { resolveMenuChrome } = require('../../../utils/nav-safe-area.js');
const { merchantHomeUrl } = require('../../../utils/merchant-home-link.js');
const { createCheckoutWorkflow, hasCompletePaymentParams } = require('../../../utils/checkout/checkout-workflow.js');
const { createPaymentVerifier } = require('../../../utils/checkout/payment-verifier.js');
const { inactiveAccess, normalizeMerchantAccess } = require('../../../utils/merchant-access-policy.js');

// 单字段编辑 sheet 的字段表(§〇.2:单字段/短选择 → 半屏 sheet,正文不留内联 input)。
// saver 指明这一条存去哪个接口 —— 三个接口的白名单不同,存错地方会静默丢字段。
const FIELDS = {
  name:        { label: '店铺名称', placeholder: '店铺名称(必填)', saver: 'brand' },
  cityRole:    { label: '城市角色名', placeholder: '如:巷口的夜间补给站', saver: 'decor' },
  // CU-M-72:入口与卡片写「一句话介绍」,label 是弹层标题与关闭钮无障碍名的唯一真源,别在这改名夹英文
  slogan:      { label: '一句话介绍', placeholder: '一句话说清你的店', saver: 'decor' },
  preference: { label: '经营类目', placeholder: '如 餐饮 · 咖啡', saver: 'brand', max: 100 },
  description: { label: '品牌故事', placeholder: '写下店铺的故事', saver: 'brand', max: 300, multiline: true },
  derivativeBenefits: { label: '衍生权益', placeholder: '如 限定饮品 / 核销折扣 / 路线纪念章', saver: 'brand' },
};

// 特色标签预置词库(空间/体验/人群),与 E5 搜索共用
const TAG_LIBRARY = {
  空间: ['老街', '天台', '独立空间', '宠物友好', '夜间开放', '适合拍照'],
  体验: ['适合单人', '适合情侣', '适合亲子', '适合组队', '雨天可去', '安静'],
  人群: ['学生党', '上班族', '摄影爱好者', '美食探店', '亲子家庭', '潮流青年']
};

// 品牌故事提示问题(引导商家,不自动生成内容)
const STORY_HINTS = [
  '你的店和这条街有什么关系?',
  '用户第一次来最应该注意什么?',
  '店里有没有一个可以被发现的小细节?',
  '你希望用户完成任务后记住哪句话?'
];

function requestText(error, fallback) {
  if (app.getRequestErrorMessage) return app.getRequestErrorMessage(error, fallback);
  return error && error.msg ? String(error.msg) : fallback;
}

function classifyFailure(error, fallback) {
  const code = error && (error.statusCode !== undefined ? error.statusCode : error.code);
  const message = error && error.msg ? String(error.msg) : '';
  if (String(code) === '401' || String(code) === '403'
      || /仅.*商家|商家资格|无权限|没有权限|权限不足|审核通过.*商家/.test(message)) {
    return { kind: 'permission', text: '当前账号没有店铺装修权限，请切换到已审核通过的商家账号。' };
  }
  const transportText = error && typeof error === 'object' ? String(error.errMsg || '') : '';
  if (code === undefined && /request:fail|timeout|network|网络|断网/i.test(transportText)) {
    return { kind: 'network', text: '网络连接失败，请检查网络后重试。' };
  }
  return { kind: 'data', text: requestText(error, fallback) };
}

Page({
  data: {
    view: 'home', basicEditing: false, pageTitle: '品牌中心',
    imageEditor: null, discardVisible: false, brandImages: [],
    categoryOptions: [], categoryDraft: [], categoryError: '',
    tagDraft: [], tagChoices: [],
    statusBarHeight: 20,
    navBarHeight: 44,
    // RV(2):整页门禁是 canManageCoop(运营要能管承接),资料类入口/保存按钮
    // 还要按 canWriteProfile 收口,所以要拿到 access 投影。
    merchantAccess: inactiveAccess(),
    // 顶边复查(2026-09-18):图片编辑面板居中,90vh 满内容时顶边只有 5vh(33px)会压进胶囊行 ⇒ 用胶囊实测反算上限
    chrome: { actionTop: 28, actionRight: 12, contentTop: 76, sheetTop: 69 },
    m: null,               // 商家实体
    gallery: [],           // 相册数组(解析自 m.gallery)
    tags: [],              // 已选标签(解析自 m.tags)
    catNames: '',          // 行业类型名(显示)

    // 载入四态(原来只有 loaded 布尔 + m=null,四种情况全渲染成「只有顶栏的空白页」:
    // ①还在加载 ②断网 ③接口报错 ④已登录但没有商家记录。从「去填写」进来最常撞第 ④ 种)
    loadState: 'loading',  // loading | ok | error | empty
    refreshing: false,
    loadErrTitle: '',
    loadErrSub: '',
    coopSummary: '',        // 承接设置行的摘要(容纳 · 时段 · 收费),只由真实字段拼
    fieldSheet: { show: false, key: '', label: '', placeholder: '', value: '' },

    tagLibrary: TAG_LIBRARY,
    tagGroups: Object.keys(TAG_LIBRARY),
    customTag: '',
    storyHints: STORY_HINTS,
    saving: false,
    saveErrorKind: '',
    saveError: '',
    saveReceipt: '',
    chargeOptions: ['免费承接', '收费承接'],

    featuredList: [],       // 我的活动列表
    featuredName: '',       // 已选主推名
    // 常备权益(复用 /api/coop/perk-template/*)
    perks: [],

    perkTypes: ['礼品', '优惠券', '折扣'],
    // E4 升级权益(先做能力,收费开关默认关)
    chargeEnabled: false,

    checkoutBusy: false,
    checkoutState: 'idle', // idle | submitting | paying | verifying | unknown | success | failed
    featuredState: 'idle',  // idle | loading | ready | error
    featuredError: '',
    tiers: [
      { key: 'premium_template', name: '高级模板', desc: '行业高级视觉 · 更多图位' },
      { key: 'promotion_slot', name: '推广曝光位', desc: '地图/搜索/官方活动优先展示' },
      { key: 'brand_home', name: '品牌主页', desc: '定制视觉 · 官方认证 · 数据报告' },
      { key: 'custom_event', name: '活动定制', desc: '人工策划 · 定制路线与权益组合' }
    ]
  },

  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),

  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。

  showPrivacyGate() {

    this.setData({ privacyGateShow: true });

  },

  onPrivacyGateSettled() {

    this.setData({ privacyGateShow: false });

  },


  onLoad(options = {}) {
    const titles = {home:'品牌中心', brand:'品牌介绍', basic:'门店信息', coop:'合作经营', qualification:'入驻资料'};
    const view = titles[options.view] ? options.view : 'home';
    this.setData({view, pageTitle: titles[view]});
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44
    });
    try {
      const w = (wx.getWindowInfo && wx.getWindowInfo()) || sys;
      const mb = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
      this.setData({ chrome: resolveMenuChrome(w, mb) });
    } catch (e) { /* 拿不到就留在兜底值 */ }
    const needsProfileWrite = view === 'basic' || view === 'brand' || view === 'qualification';
    const that = this;
    this.loadAccess(function (access) {
      if (needsProfileWrite && !access.canWriteProfile) {
        // 深链直接进资料视图:停权限态,不先打一发注定 403 的 /merchant/info。
        that.setData({
          loadState: 'permission',
          loadErrTitle: '当前岗位没有资料编辑权限',
          loadErrSub: '如需修改门店资料，请联系店主或店长。',
        });
        return;
      }
      that.load();
      that.loadPerks();
      if (access.canWriteProfile) that.loadSubs();
    });
  },

  loadAccess(callback) {
    const that = this;
    app.sendRequest({
      hideLoading: true, url: '/api/merchant/access/me', method: 'POST', autoErrorToast: false,
      success(res) {
        const access = (res && (res.code === '200' || res.code === 200))
          ? normalizeMerchantAccess(res.data) : inactiveAccess();
        that.setData({ merchantAccess: access });
        if (callback) callback(access);
      },
      fail() {
        that.setData({ merchantAccess: inactiveAccess() });
        if (callback) callback(that.data.merchantAccess);
      },
    });
  },

  // 从承接设置/品牌故事子页返回时重拉:行上的摘要与完整度必须跟着子页的保存走
  onShow() {
    merchantTheme.merchantPageShow && merchantTheme.merchantPageShow();
    if (this._loadedOnce && this.canReadProfileView() && !this.data.fieldSheet.show && !this.data.imageEditor) this.load();
    if (this._loadedOnce) this.loadPerks();
    this._loadedOnce = true;
  },

  /** basic/brand/qualification 三个资料视图要 PROFILE_WRITE;深链进来时也要拦住。 */
  canReadProfileView() {
    const needsProfileWrite = this.data.view === 'basic' || this.data.view === 'brand'
      || this.data.view === 'qualification';
    return !needsProfileWrite || this.data.merchantAccess.canWriteProfile;
  },
  onHide() { merchantTheme.merchantPageRestore && merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._destroyed = true;
    this._loadEpoch = (this._loadEpoch || 0) + 1;
    this._saveEpoch = (this._saveEpoch || 0) + 1;
    this._featuredRequestId = (this._featuredRequestId || 0) + 1;
    this._loadInFlight = false;
    if (this._loadWatchdog) {
      clearTimeout(this._loadWatchdog);
      this._loadWatchdog = null;
    }
    if (this._commerceWorkflow) {
      this._commerceWorkflow.destroy();
      this._commerceWorkflow = null;
    }
    try {
      if (merchantTheme.merchantPageRestore) merchantTheme.merchantPageRestore();
    } catch (e) {}
  },

  // 从行业类型选择页(biaoqian)返回时回填(同 shanghuziliao 模式)
  updateCategorySelection(selectedIds, selectedCategories) {
    if (this.data.saving || this.data.refreshing) return;
    const names = (selectedCategories || []).map(c => c.categoryName).join(' · ');
    this.setData({ catNames: names, 'm.categoryId': (selectedIds || []).join(',') });
    this.saveDecor({ categoryId: (selectedIds || []).join(',') || null });
    this.refreshGuide();
  },

  load() {
    if (this._loadInFlight) return;
    const that = this;
    const epoch = (this._loadEpoch || 0) + 1;
    this._loadEpoch = epoch;
    this._loadInFlight = true;
    const hasOldContent = this.data.loadState === 'ok' && !!this.data.m;
    const isCurrent = function () {
      if (epoch !== that._loadEpoch) return false;
      return true;
    };
    if (this._loadWatchdog) clearTimeout(this._loadWatchdog);
    const finishLoad = function () {
      if (!isCurrent()) return false;
      if (that._loadWatchdog) {
        clearTimeout(that._loadWatchdog);
        that._loadWatchdog = null;
      }
      that._loadInFlight = false;
      return true;
    };
    const failLoad = function (error, fallback) {
      if (!isCurrent()) return;
      const failure = classifyFailure(error, fallback);
      if (failure.kind === 'permission') {
        if (!finishLoad()) return;
        that.setData({

          refreshing: false,
          loadState: 'permission',
          loadErrTitle: '',
          loadErrSub: '',
          m: null,
          gallery: [],
          tags: [],
          catNames: '',
          coopSummary: '',
        });
      } else if (hasOldContent) {
        if (!finishLoad()) return;
        that.setData({

          refreshing: false,
          loadState: 'ok',
          loadErrTitle: '',
          loadErrSub: '',
        });
      } else {
        if (!finishLoad()) return;
        that.setData({

          refreshing: false,
          loadState: 'error',
          loadErrTitle: failure.kind === 'network' ? '网络没连上' : '店铺资料没打开',
          loadErrSub: failure.text,
        });
      }
    };
    that.setData({
      loadState: hasOldContent ? 'ok' : 'loading',
      refreshing: hasOldContent,
      loadErrTitle: '',
      loadErrSub: '',
    });
    // 401/静默重登在开发工具或弱网下可能迟迟不回调;页面不能因此永久停在骨架。
    this._loadWatchdog = setTimeout(() => {
      if (!isCurrent() || (that.data.loadState !== 'loading' && !that.data.refreshing)) return;
      that._loadEpoch = epoch + 1;
      that._loadInFlight = false;
      that._loadWatchdog = null;
      that.setData({

        refreshing: false,
        loadState: hasOldContent ? 'ok' : 'error',
        loadErrTitle: hasOldContent ? '' : '店铺资料加载超时',
        loadErrSub: hasOldContent ? '' : '网络或登录状态暂时不可用，请重试。',
      });
    }, 8000);
    app.sendRequest({
      hideLoading: true, url: (this.data.view === 'basic' || this.data.view === 'qualification') ? '/api/merchant/info' : '/api/merchant/coop-profile', method: 'POST',
      success(res) {
        if (!isCurrent()) return;
        const ok = res.code === '200' || res.code === 200;
        if (ok && res.data) {
          const m = res.data;
          if (typeof m !== 'object' || Array.isArray(m)) {
            return failLoad({ msg: '店铺资料格式异常' }, '店铺资料格式异常，请重试。');
          }
          const memberId = Number(m.memberId);
          if (!Number.isInteger(memberId) || memberId < 1) {
            return failLoad({ msg: '店铺资料不完整' }, '店铺资料不完整，请重试。');
          }
          let gallery = [];
          let tags = [];
          try { gallery = m.gallery ? JSON.parse(m.gallery) : []; } catch (e) {
            return failLoad({ msg: '店铺相册格式异常' }, '店铺相册格式异常，请重试。');
          }
          try { tags = m.tags ? JSON.parse(m.tags) : []; } catch (e) {
            return failLoad({ msg: '店铺标签格式异常' }, '店铺标签格式异常，请重试。');
          }
          if (!Array.isArray(gallery) || !Array.isArray(tags) || (m.sysCategoryList && !Array.isArray(m.sysCategoryList))) {
            return failLoad({ msg: '店铺资料格式异常' }, '店铺资料格式异常，请重试。');
          }
          const catNames = (m.sysCategoryList || []).map(c => c.categoryName).join(' · ');
          if (!finishLoad()) return;
          that.setData({
            refreshing: false,
            m: m,
            brandImages: String(m.derivatives || "").split(",").filter(x => /^(https?:|\/)/.test(x.trim())),
            gallery: gallery,
            tags: tags,
            catNames: catNames,

            loadState: 'ok',
          });
          that.refreshGuide();
          // CU-M-77:已选主推的商家要在卡片上直接看到是哪场活动 —— 名字只在会话里有,
          // 重进就丢了。这里顺手拉一次活动列表反查回填(拉不到就维持兑底串)。
          if (m.featuredId != null) that.loadFeatured();
        } else if (ok) {
          failLoad({ msg: '店铺资料不完整' }, '店铺资料不完整，请重试。');
        } else {
          failLoad(res, '服务返回异常，稍后重试；一直这样请联系官方运营。');
        }
      },
      fail(error) { failLoad(error, '店铺资料没能载入，请稍后重试。'); }
    });
  },

  retryLoad() { this.load(); },

  // 空态引导:没有店铺记录 → 去商家入驻
  goApply() { wx.navigateTo({ url: '/pages/merchant/apply/index' }); },

  _startSave(options) {
    if (this.data.saving || this.data.refreshing) return false;
    if (this._loadInFlight) {
      this._loadEpoch = (this._loadEpoch || 0) + 1;
      this._loadInFlight = false;
      if (this._loadWatchdog) {
        clearTimeout(this._loadWatchdog);
        this._loadWatchdog = null;
      }
    }
    const that = this;
    const epoch = (this._saveEpoch || 0) + 1;
    this._saveEpoch = epoch;
    this._retrySave = options.retry;
    const isCurrent = function () {
      if (epoch !== that._saveEpoch) return false;
      return true;
    };
    const fail = function (error) {
      if (!isCurrent()) return;
      const failure = classifyFailure(error, options.failureText || '店铺资料保存失败');
      that.setData({ saving: false, saveErrorKind: failure.kind, saveError: failure.text, saveReceipt: '' });
      if (options.onFailure) options.onFailure();
    };
    this.setData({ saving: true, refreshing: false, saveErrorKind: '', saveError: '', saveReceipt: '' });
    options.send(function (res) {
      if (!isCurrent()) return;
      if (res.code === '200' || res.code === 200) {
        that._retrySave = null;
        that.setData({
          saving: false,
          saveErrorKind: '',
          saveError: '',
          saveReceipt: options.receipt || '店铺资料已保存',
        });
        if (options.onSuccess) options.onSuccess();
      } else {
        fail(res);
      }
    }, fail);
    return true;
  },

  retrySave() {
    if (!this.data.saving && this._retrySave) this._retrySave();
  },

  // ===== 展示层保存(部分字段即时,mapper 动态 if 支持) =====
  saveDecor(patch, onSuccess, onFailure) {
    const stablePatch = Object.assign({}, patch);
    return this._startSave({
      failureText: '店铺资料保存失败',
      receipt: '店铺资料已保存',
      retry: () => this.saveDecor(stablePatch, onSuccess, onFailure),
      onFailure: () => { if (onFailure) onFailure(); },
      onSuccess: () => { this.setData({m: Object.assign({}, this.data.m, stablePatch)}); this.refreshGuide(); if (onSuccess) onSuccess(); },
      send(success, fail) {
        app.sendRequest({
          hideLoading: true, url: '/api/merchant/decor/save', method: 'POST',
          data: JSON.stringify(stablePatch), header: { 'Content-Type': 'application/json' },
          success: success, fail: fail,
        });
      },
    });
  },

  // ===== 品牌基础保存(/update 支持部分更新，只提交当前编辑字段) =====
  saveBrand(patch, onSuccess) {
    const stablePatch = Object.assign({}, patch);
    return this._startSave({
      failureText: '品牌资料保存失败',
      receipt: '品牌资料已保存',
      retry: () => this.saveBrand(stablePatch, onSuccess),
      onSuccess: () => { this.setData({m: Object.assign({}, this.data.m, stablePatch)}); this.refreshGuide(); if (onSuccess) onSuccess(); },
      send(success, fail) {
        app.sendRequest({
          hideLoading: true, url: '/api/merchant/update', method: 'POST',
          data: JSON.stringify(stablePatch), header: { 'Content-Type': 'application/json' },
          success: success, fail: fail,
        });
      },
    });
  },

  // 承接能力的保存已随「承接设置」搬去 decor/coop-setting 子页(§1:各子页各自 Save)

  // ===== 常备权益 CRUD(承接区,复用 perk-template) =====
  loadPerks() {
    const that = this;
    const TYPE = this.data.perkTypes;
    app.sendRequest({
      hideLoading: true, url: '/api/coop/perk-template/list', method: 'POST',
      data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
      success(res) {
        if(that._destroyed || String(res.code)!=='200' || !Array.isArray(res.data))return;
        const list = res.data.map(function (p) {
          return Object.assign({}, p, {
            typeText: TYPE[p.perkType != null ? Number(p.perkType) : 0] || '权益',
            validText: p.validEnd ? String(p.validEnd).slice(0, 10) : ''
          });
        });
        that.setData({ perks: list });
      },
      fail() {}
    });
  },
  // ===== E4 升级权益 =====
  loadSubs() {
    const that = this;
    app.sendRequest({
      hideLoading: true, url: '/api/merchant/commerce/capabilities', method: 'POST',
      success(res) {
        if ((res.code == '200' || res.code == 200) && res.data) {
          (Object.assign(that.data, {chargeEnabled: !!res.data.selfCheckoutEnabled}), that.setData({}));
        }
      }
    });

  },
  _initCommerceWorkflow() {
    if (this._commerceWorkflow) return this._commerceWorkflow;
    const verifyPayment = createPaymentVerifier({
      requestStatus(ref, options, cb) {
        return app.sendRequest({
          hideLoading: true,
          silentError: true,
          timeout: options.timeout,
          url: '/api/merchant/commerce/order/status',
          method: 'POST',
          data: JSON.stringify({ orderSn: ref.orderSn }),
          header: { 'Content-Type': 'application/json' },
          success(res) {
            if ((res.code == '200' || res.code == 200) && res.data) cb(res.data);
            else cb({ paymentStatus: 'unknown' });
          },
          successStatusAbnormal() { cb({ paymentStatus: 'unknown' }); },
          fail() { cb({ paymentStatus: 'unknown' }); }
        });
      },
      classify(res) { return res && res.paymentStatus || 'unknown'; },
      perRequestTimeoutMs: 5000,
      totalDeadlineMs: 20000,
      intervalMs: 1500
    });
    this._commerceWorkflow = createCheckoutWorkflow({
      createOrder(payload, cb) {
        return app.sendRequest({
          url: '/api/merchant/commerce/order', method: 'POST',
          data: JSON.stringify(payload),
          header: { 'Content-Type': 'application/json' },
          success(res) {
            if (!(res.code == '200' || res.code == 200) || !res.data) {
              cb({ ok: false, errMsg: '暂不能自助开通' });
              return;
            }
            const order = res.data;
            if (order.paymentStatus === 'success') {
              cb({ ok: true, data: { orderSn: order.orderSn, payableAmount: 0, alreadyPaid: true } });
              return;
            }
            if (order.paymentStatus === 'failed') {
              cb({ ok: false, terminal: true, errMsg: '订单已关闭，请重新选择权益' });
              return;
            }
            cb({
              ok: true,
              data: {
                orderSn: order.orderSn,
                payableAmount: 1,
                payParams: {
                  timeStamp: order.timeStamp,
                  nonceStr: order.nonceStr,
                  package: order.package,
                  signType: order.signType,
                  paySign: order.paySign
                }
              }
            });
          },
          successStatusAbnormal() { cb({ ok: false, errMsg: '暂不能自助开通' }); },
          fail() { cb({ ok: false, errMsg: '网络异常，请稍后重试' }); }
        });
      },
      requestPayment(order, cb) {
        wx.requestPayment(Object.assign({}, order.payParams, {
          success() { cb({ ok: true }); },
          fail(err) {
            const cancelled = !!err && String(err.errMsg || '').indexOf('cancel') >= 0;
            cb({ ok: false, cancelled: cancelled, errMsg: cancelled ? '已取消支付' : '支付未完成' });
          }
        }));
      },
      isPayable(order) { return !order.alreadyPaid; },
      validatePayment: hasCompletePaymentParams,
      verifyPayment(order, cb) { return verifyPayment({ orderSn: order.orderSn }, cb); }
    });
    return this._commerceWorkflow;
  },
  tapTier(e) {
    const bizType = e.currentTarget.dataset.key;
    if (!this.data.chargeEnabled || bizType === 'brand_home') {
      // CU-M-80:自助结账没开(何况 brand_home 永远只走人工)时不能只弹一句就断头 ——
      // 面板底部挂了真实的客服会话入口(联系运营开通),这里把用户指过去。
      toast('请点下方「联系运营开通」');
      return;
    }
    const workflow = this._initCommerceWorkflow();
    if (this.data.checkoutBusy || workflow.isBusy() || workflow.getState() === 'unknown') return;
    if (!this._commerceRequestId || this._commerceRequestBizType !== bizType) {
      this._commerceRequestId = 'commerce_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      this._commerceRequestBizType = bizType;
    }
    const that = this;
    const submitted = workflow.submit({ bizType: bizType, requestId: this._commerceRequestId }, {
      onOrderFail(res) {
        if (res && res.terminal) {
          that._commerceRequestId = null;
          that._commerceRequestBizType = null;
        }
        (Object.assign(that.data, {checkoutBusy: false}), that.setData({checkoutState: 'failed'}));
        toast(res && res.errMsg || '暂不能自助开通');
      },
      onFreeSuccess() {
        that._commerceRequestId = null;
        that._commerceRequestBizType = null;
        (Object.assign(that.data, {checkoutBusy: false}), that.setData({checkoutState: 'success'}));
        toast.success('权益已到账');
        that.loadSubs();
      },
      onPayVerifying() { that.setData({ checkoutState: 'verifying' }); },
      onPaySuccess() {
        that._commerceRequestId = null;
        that._commerceRequestBizType = null;
        (Object.assign(that.data, {checkoutBusy: false}), that.setData({checkoutState: 'success'}));
        toast.success('支付成功，权益已到账');
        that.loadSubs();
      },
      onPayCancel() {
        (Object.assign(that.data, {checkoutBusy: false}), that.setData({checkoutState: 'idle'}));
      },
      onPayFail(res) {
        if (res && res.data && res.data.paymentStatus === 'failed') {
          that._commerceRequestId = null;
          that._commerceRequestBizType = null;
        }
        (Object.assign(that.data, {checkoutBusy: false}), that.setData({checkoutState: 'failed'}));
        toast(res && res.errMsg || '支付未完成');
      },
      onPayUnknown() {
        (Object.assign(that.data, {checkoutBusy: false}), that.setData({checkoutState: 'unknown'}));
        modal.show({
          title: '支付结果待确认',
          content: '暂不要重复支付，请稍后查看已开通权益或联系官方运营。',
          showCancel: false
        });
      }
    });
    if (submitted) (Object.assign(this.data, {checkoutBusy: true}), this.setData({checkoutState: 'submitting'}));
  },

  // 图片编辑保持独立草稿；只有确认且服务端成功后更新主页。
  uploadCover() { this.openImage('coverImage'); },
  uploadLogo() { this.openImage('logo'); },
  openImage(key) {
    if (this.data.saving || this.data.refreshing) return;
    this.setData({imageEditor: {key, value: this.data.m[key] || '', initial:this.data.m[key] || ''}, saveError: ''});
  },
  closeImage() {
    if (this.data.saving) return;
    const image = this.data.imageEditor;
    if (image && image.value !== image.initial) (Object.assign(this.data, {discardTarget:'image'}), this.setData({discardVisible:true}));
    else this.setData({imageEditor:null});
  },
  chooseEditImage() {
    if (this.data.saving || !this.data.imageEditor) return;
    const key = this.data.imageEditor.key;
    app.chooseImage(urls => {
      if (urls && urls[0] && this.data.imageEditor && this.data.imageEditor.key === key) this.setData({'imageEditor.value': urls[0]});
    }, 1, {crop: true, cropScale: key === 'logo' ? '1:1' : '5:3'});
  },
  saveImage() {
    if (!this.data.imageEditor || this.data.saving) return;
    const {key, value} = this.data.imageEditor;
    if (!value) return toast('请先选择图片');
    this[key === 'logo' ? 'saveBrand' : 'saveDecor']({[key]: value}, () => this.setData({imageEditor: null}));
  },
  // ===== 单字段编辑(§〇.2:半屏 sheet,不在正文留内联 input) =====
  refreshGuide() {
    const m = this.data.m || {};
    // 承接设置行的摘要:只拼后端真有值的项,一项都没有就留空由模板渲占位
    const parts = [];
    if (m.capacity != null && String(m.capacity) !== '') parts.push(m.capacity + ' 人');
    if (m.availableTime) parts.push(m.availableTime);
    if (m.chargeType === 1 || m.chargeType === '1') parts.push('收费承接');
    else if (m.chargeType === 0 || m.chargeType === '0') parts.push('免费承接');
    this.setData({ coopSummary: parts.join(' · ') });
  },

  noop() {},

  openField(e) {
    if (this.data.refreshing) return;
    const key = e.currentTarget.dataset.k;
    const def = FIELDS[key];
    if (!def) return;
    const m = this.data.m || {};
    // CU-M-73:saveError 是页面级单例,弹层又无条件把它当自己的错渲染 ⇒ 开新弹层必须先清,
    // 否则上一个操作的失败(如标签保存)会串成这个字段的错误。与 openImage 同款。
    this.setData({
      saveError: '', saveErrorKind: '', saveReceipt: '',
      fieldSheet: {
        show: true, key: key, label: def.label, placeholder: def.placeholder,
        value: m[key] == null ? '' : String(m[key]),
        initial: m[key] == null ? '' : String(m[key]), max: def.max || 100, multiline: !!def.multiline,
      },
    });
  },
  onFieldInput(e) {
    if (!this.data.saving && !this.data.refreshing) this.setData({ 'fieldSheet.value': e.detail.value });
  },
  closeFieldSheet() {
    if (this.data.saving) return;
    if (this.data.fieldSheet.value !== this.data.fieldSheet.initial) (Object.assign(this.data, {discardTarget:'field'}), this.setData({discardVisible: true}));
    else this.setData({'fieldSheet.show': false});
  },
  keepEditing() { this.setData({discardVisible: false}); },
  discardField() {
    if(this.data.discardTarget === 'image') this.setData({discardVisible:false,saveError:'',imageEditor:null});
    else this.setData({discardVisible:false,saveError:'','fieldSheet.show':false});
  },
  // 确认即保存(§1:主页面无总保存,各编辑落点自己 Save)
  confirmField() {
    if (this.data.saving || this.data.refreshing) return;
    const { key, value } = this.data.fieldSheet;
    const def = FIELDS[key];
    if (!def) return;
    if (key === 'name' && !String(value).trim()) return toast('请填写店铺名称');
    if (String(value).length > (def.max || 100)) return toast('内容超过字数限制');
    const done = () => this.setData({'fieldSheet.show': false});
    if (def.saver === 'brand') this.saveBrand({[key]: value}, done);
    else this.saveDecor({[key]: value}, done);
  },

  // 品牌故事 = 单个长文本 → 就地开字段弹层(§〇.2);承接设置 = 多字段成组 → 全屏子页。
  // 2026-09-19 审查 #30:原先给品牌故事另立过一页 decor/story,但那页没进 app.json、
  // 全仓零入口,商家一直走的就是这里这条内联路。整页已删,注释同步改掉别再指过去。
  goStory() { this.openField({currentTarget: {dataset: {k:'description'}}}); },
  toggleBasicEditing() {
    if (!this.data.saving) this.setData({basicEditing: !this.data.basicEditing});
  },
  onBasicAction(e) {
    if (!this.data.basicEditing) return;
    const action = e.currentTarget.dataset.action;
    if (['openField','geoLocate','goStory','previewLicense','previewBrandImages'].includes(action)) this[action](e);
  },
  goSection(e) { wx.navigateTo({url: '/pages/merchant/decor/index?view=' + e.currentTarget.dataset.view}); },
  openDerivatives() {
    this.openField({currentTarget:{dataset:{k:'derivativeBenefits'}}});
  },
  goAiNpc() { wx.navigateTo({url: '/pages/merchant/decor/ai-npc/index'}); },
  // CU-M-71:执照/品牌图是入驻时提交的只读资料(补交入口在入驻流程)。无图时行上已无箭头,
  // 点击还得给一句稳定解释,别把「没图」当无事发生。说明落在行上的 description,toast 只做反馈。
  previewLicense() {
    if (this.data.m.businessLicense) wx.previewImage({urls: [this.data.m.businessLicense]});
    else toast('入驻时提交，如需更新请联系平台');
  },
  previewBrandImages() {
    if (this.data.brandImages.length) wx.previewImage({urls: this.data.brandImages});
    else toast('入驻时提交，如需更新请联系平台');
  },
  onHoursSave(e) { this.saveBrand({businessTime: e.detail.value}, () => this.selectComponent('#business-hours').close()); },
  goCoopSetting() { wx.navigateTo({ url: '/pages/merchant/decor/coop-setting/index' }); },
  goGallery() { wx.navigateTo({ url: '/pages/merchant/decor/gallery/index' }); },
  goPerks() { wx.navigateTo({ url: '/pages/merchant/decor/perks/index' }); },
  goReviews() { wx.navigateTo({ url: '/pages/merchant/reviews/index?mode=manage' }); },


  // ===== 营业状态(即时) =====
  toggleBusiness(e) {
    if (this.data.saving || this.data.refreshing) return;
    const bs = e.detail.value ? 1 : 0;
    const previous = this.data.m && this.data.m.businessStatus;
    this.setData({ 'm.businessStatus': bs });
    this.saveBusinessStatus(bs, previous);
  },

  saveBusinessStatus(bs, previous) {
    this._startSave({
      failureText: '营业状态保存失败',
      receipt: '营业状态已保存',
      retry: () => {
        this.setData({ 'm.businessStatus': bs });
        this.saveBusinessStatus(bs, previous);
      },
      onFailure: () => this.setData({ 'm.businessStatus': previous }),
      send(success, fail) {
        app.sendRequest({
          hideLoading: true, url: '/api/merchant/business-status/update', method: 'POST',
          data: { business_status: bs }, success: success, fail: fail,
        });
      },
    });
  },

  // ===== 特色标签面板 =====
  openTagPanel() {
    if (!this.data.refreshing) {
      // CU-M-74:标签保存失败后草稿一直钉住(直到保存成功),不是只保留一次
      if(!this._resumeTags && !this._tagSaveFailed) (Object.assign(this.data, {tagDraft:this.data.tags.slice()}), this.setData({}));
      this._resumeTags=false;
      this.refreshTagChoices();
    }
  },
  refreshTagChoices() {
    const library=[].concat(...Object.keys(TAG_LIBRARY).map(k=>TAG_LIBRARY[k]));
    this.setData({customTagChoices:this.data.tagDraft.filter(t=>library.indexOf(t)<0), tagChoices: Object.keys(TAG_LIBRARY).map(label => ({label, items: TAG_LIBRARY[label].map(value => ({value, checked: this.data.tagDraft.indexOf(value) >= 0}))}))}); },
  toggleTag(e) {
    if (this.data.saving || this.data.refreshing) return;
    const t = e.currentTarget.dataset.t;
    let tags = (this.data.tagDraft || []).slice();
    const idx = tags.indexOf(t);
    if (idx >= 0) tags.splice(idx, 1); else { if (tags.length >= 12) { toast('最多12个'); return; } tags.push(t); }
    (Object.assign(this.data, {tagDraft: tags}), this.setData({})); this.refreshTagChoices();
  },
  openCustomTag() {
    this.selectComponent('#tag-menu').close();
    this.setData({customTag:'', customTagVisible:true});
  },
  closeCustomTag() {
    this.setData({customTagVisible:false});
    this._resumeTags=true;
    this.selectComponent('#tag-menu').openAtAnchor();
  },
  onCustomTag(e) {
    if (!this.data.saving && !this.data.refreshing) this.setData({ customTag: e.detail.value });
  },
  // CU-M-75:空输入时按钮是禁用态(而不是点了没反应),被点时补一句为什么
  onAddTagBlocked() {
    toast('请填写标签名称');
  },
  addCustomTag() {
    if (this.data.saving || this.data.refreshing) return;
    const t = (this.data.customTag || '').trim();
    // CU-M-75:空值不再静默 return(按钮已 disabled,这里兜住 bindconfirm 的回车路径)
    if (!t) return toast('请填写标签名称');
    let tags = (this.data.tagDraft || []).slice();
    if (tags.indexOf(t) < 0) tags.push(t);
    if (tags.length > 12) return toast('最多12个');
    (Object.assign(this.data, {tagDraft: tags}), this.setData({customTag: ''})); this.refreshTagChoices(); this.closeCustomTag();
  },
  confirmTags() {
    if (this.data.saving || this.data.refreshing) return;
    const tags = this.data.tagDraft.slice();
    this.saveDecor({tags: JSON.stringify(tags)}, () => {this._tagSaveFailed = false; this.setData({tags}); this.selectComponent('#tag-menu').close();}, () => {
      // CU-M-74:失败后钉住草稿,重开面板用眼前这份勾选重建,而不是退回已保存值 ——
      // 否则页顶还挂着「重试保存」,面板里却显示成没选,眼见与待提交内容相反。
      // 钉住直到保存成功;「重试保存」提交的是此刻面板里的勾选(失败后又改过也一样),不是失败那一刻的快照。
      this._resumeTags = true;
      this._tagSaveFailed = true;
      this._retrySave = () => this.confirmTags();
    });
  },

  // ===== 行业类型选择(复用 cy-category-sheet,2026-07-31 弹窗化:不再跳转独立页面)=====
  goCategory() {
    if (this.data.saving || this.data.refreshing) return;
    const ids = String(this.data.m.categoryId || '').split(',');
    this.setData({categoryError: '', categoryOptions: []});
    app.sendRequest({hideLoading:true, url:'/api/category/list', method:'POST', data:{type:1,parentid:0},
      success: res => {
        if (String(res.code) !== '200' || !Array.isArray(res.data)) return this.setData({categoryError:'行业类型没能载入，请重试'});
        this.setData({categoryOptions: res.data.map(c => Object.assign({}, c, {checked: ids.indexOf(String(c.id)) >= 0}))});
      }, fail: () => this.setData({categoryError:'网络异常，请重试'})});
  },
  toggleCategory(e) {
    if (this.data.saving) return;
    const i = e.currentTarget.dataset.index;
    this.setData({categoryOptions: this.data.categoryOptions.map((c, index) => Object.assign({}, c, {checked:index === Number(i)}))});
  },
  saveCategories() {
    const selected = this.data.categoryOptions.filter(c => c.checked);
    this.saveDecor({categoryId:selected.map(c=>c.id).join(',')}, () => {
      this.setData({catNames:selected.map(c=>c.categoryName).join(' · ')});
      this.selectComponent('#category-menu').close();
    });
  },
  // ===== 招牌主推:拉"我发起的活动"选一个置顶 =====
  openFeatured() {
    this.loadFeatured();
  },
  loadFeatured() {
    const that = this;
    const requestId = (this._featuredRequestId || 0) + 1;
    this._featuredRequestId = requestId;
    this.setData({ featuredState: 'loading', featuredError: '', featuredList: [] });
    app.sendRequest({
      hideLoading: true, silentError: true, url: '/api/activity/list', method: 'POST',
      data: { is_my: 1, pageNum: 1, pageSize: 20 },
      success(res) {
        if (requestId !== that._featuredRequestId) return;
        const ok = res && (res.code === '200' || res.code === 200);
        const raw = ok && res.data && Array.isArray(res.data.rows)
          ? res.data.rows : (ok && Array.isArray(res.data) ? res.data : null);
        if (!raw || raw.some(a => !a || a.id === null || a.id === undefined || a.id === '')) {
          that.setFeaturedError('活动列表暂时没能加载，请稍后重试');
          return;
        }
        that.setData({
          featuredList: raw.map(a => ({ id: a.id, name: a.name || a.title || '活动', img: a.imgUrl || a.coverImg || '' })),
          featuredState: 'ready',
          featuredError: '',
        });
        that.syncFeaturedName();
      },
      fail() {
        if (requestId === that._featuredRequestId) that.setFeaturedError('网络异常，检查网络后重试');
      },
      successStatusAbnormal() {
        if (requestId === that._featuredRequestId) that.setFeaturedError('活动列表暂时没能加载，请稍后重试');
      },
    });
  },
  setFeaturedError(featuredError) {
    this.setData({ featuredList: [], featuredState: 'error', featuredError: featuredError });
  },
  // CU-M-77:卡片文案的真源是「已保存的 featuredId + 列表里的名字」。只在当次选择后 setData
  // featuredName 的话,重进页面必然退回「已选择主推」,管理员得展开列表才能确认置顶的是哪场。
  syncFeaturedName() {
    const featuredId = (this.data.m || {}).featuredId;
    const hit = featuredId == null ? null
      : (this.data.featuredList || []).filter(a => String(a.id) === String(featuredId))[0];
    this.setData({ featuredName: hit ? hit.name : '' });
  },
  retryFeatured() { this.loadFeatured(); },
  closeFeatured() {
    this._featuredRequestId = (this._featuredRequestId || 0) + 1;
  },
  goPublishActivity() {
    // CU-M-05:招牌主推的空候选里「去发布一个活动」是商家主办入口,必须带 scope ——
    // 不带的话发布页按俱乐部主理人判身份,商家进来直接被拦回本页且没有任何失败提示。
    wx.navigateTo({ url: '/pages/publish/activity/index?scope=MERCHANT' });
  },
  selectFeatured(e) {
    if (this.data.saving || this.data.refreshing) return;
    const { id, name } = e.currentTarget.dataset;
    this.saveDecor({featuredType:1,featuredId:id}, () => {this.setData({featuredName:name}); this.selectComponent('#featured-menu').close();});
  },
  clearFeatured() {
    if (this.data.saving || this.data.refreshing) return;
    this.saveDecor({featuredType:0,featuredId:null}, () => {this.setData({featuredName:''}); this.selectComponent('#featured-menu').close();});
  },

  // ===== 成为城市节点(E1/E2 citynode) =====
  goCityNode() {
    wx.navigateTo({ url: '/pages/merchant/citynode/index' });
  },

  // ===== 看公开主页 =====
  // CU-M-09:preview=1 让个人页按访客视角渲染自己(关注钮 + 粉丝数),不再落到本人的玩家探索空态
  goPreview() {
    const url = merchantHomeUrl(this.data.m && this.data.m.memberId);
    if (!url) { toast('资料加载中'); return; }
    wx.navigateTo({ url: url + '&preview=1' });
  },

  // ===== 门店定位校准(E2 geo,手动打点) =====
  geoLocate() {
    if (this.data.saving || this.data.refreshing) return;
    const that = this;
    wx.chooseLocation({
      success(r) {
        if (that.data.saving || that.data.refreshing) return;
        that.saveDecor({locationLat:r.latitude, locationLng:r.longitude, address:r.address || r.name || ''});
      },
      fail() {}
    });
  },

  goBack() { wx.navigateBack({ delta: 1 }); }
});
