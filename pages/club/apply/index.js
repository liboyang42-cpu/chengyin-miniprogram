const app = getApp();
const toast = require('../../../utils/toast.js');
const roleGuard = require('../../../utils/roleGuard.js');
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const wizardMorph = require('../../../utils/wizard-morph.js');
const publisherIdentity = require('../../../utils/publisher-identity.js');

// D18 表单A:注册成为俱乐部主理人(身份资格 + 能力档案 → L1-L5 定级依据)。
// 填完即有:提交即 role→club;能力档案挂 club_leader,后台异步定级。建团走 club/create(表单B)。
// STEP_NAMES 只用于返回标签(短名);读屏用已渲染出来的 STEP_TITLES,
// 免得多一个「只进 aria、眼睛看不见」的死数据字段。
// 文案与 Figma「H1–H4 主理人申请 v2」四块稿逐字对齐;副标题 2026-09-06 用户定删除。
const STEP_NAMES = ['主理人实名', '组织经验', '能力自评', '资质证明'];
const STEP_TITLES = ['先认识一下你', '你带过多少场？', '你能自己做哪些？', '有资质就传一份'];

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    mode: 'intro',           // intro | form | done —— intro 是四步之前的开场屏(Figma H0)
    doneState: 'idle',       // idle | loading | ready | error，完成态必须有身份快照背书
    bootstrapState: 'checking-role', // checking-role | ready | error | blocked
    bootstrapError: '',
    step: 1,
    stepTitle: STEP_TITLES[0],
    backLabel: '设置',
    capCount: 0,
    dots: [0, 1, 2, 3],
    reducedMotion: false,
    morphing: false,
    morph: null,
    morphRun: false,
    // 身份
    leaderName: '',
    phone: '',
    identity: '',
    coFounders: '',
    // 经验
    experience: '',
    maxEventSize: '',
    avgEventSize: '',
    // 能力自评(0/1)
    canDesignRoute: 0,
    canDesignTask: 0,
    canNpc: 0,
    canMerchantCoop: 0,
    // 资质
    hasGuideCert: 0,
    certImages: [],
    certUploading: [],
    certErrorIndexes: [],
    // 发布者实名(RUN-52):姓名+身份证号只在最后一步收一次,登记过就不再出现这两个字段
    identityRegistered: false,
    realName: '',
    idCard: '',
    identityConsented: false,
    identityHint: publisherIdentity.CONSENT_TEXT,
    identityDoneHint: publisherIdentity.ALREADY_REGISTERED_HINT,
    expOptions: ['没有经验', '1-5场', '5-20场', '20场以上'],
    canNext: false,
    submitting: false,
    submitError: '',
    submitErrorKind: 'data',
    submissionReceipt: null
  },

  onLoad() {
    this.validate();
    this.startBootstrap();
  },

  // 减动效开关在设置页可随时改,每次回到本页重读(与 club/enroll 同写法)
  onShow() {
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
  },

  onUnload() {
    wizardMorph.cancelIntroMorph(this);
    this._bootstrapEpoch = (this._bootstrapEpoch || 0) + 1;
    this._submitEpoch = (this._submitEpoch || 0) + 1;
    this._leaderStatusEpoch = (this._leaderStatusEpoch || 0) + 1;
    this._bootstrapChecking = false;
    this._submitting = false;
    this._leaderStatusChecking = false;
  },

  startBootstrap() {
    if (this._bootstrapChecking) return;
    this._bootstrapChecking = true;
    var bootstrapEpoch = (this._bootstrapEpoch || 0) + 1;
    this._bootstrapEpoch = bootstrapEpoch;
    var that = this;
    this.setData({ bootstrapState: 'checking-role', bootstrapError: '' });
    // 账户互斥:已注册商户不能再申请俱乐部主理人(一个账户只能是商户或主理人之一)
    if (this.isMerchantAccount()) {
      this._bootstrapChecking = false;
      // blocked 态自己弹 fail 半屏讲原因并 2s 后 onExit,不再叠一个同义的「知道了」弹窗
      this.setData({ bootstrapState: 'blocked' });
      return;
    }
    // 已是主理人则不重复让其填整套表单,直接进"已成为主理人"态(去创建/管理俱乐部)
    roleGuard.load(function (snapshot) {
      if (bootstrapEpoch !== that._bootstrapEpoch) return;
      that._bootstrapChecking = false;
      if (!snapshot || !roleGuard.hasSnapshot()) {
        that.setData({
          bootstrapState: 'error',
          bootstrapError: '暂时无法确认当前账号的主理人资格，请重试',
        });
        return;
      }
      if (roleGuard.isClubLeader()) {
        that.setData({ mode: 'done', doneState: 'ready', bootstrapState: 'ready' });
        return;
      }
      that.setData({ bootstrapState: 'ready', bootstrapError: '' });
    });
  },

  retryBootstrap() { this.startBootstrap(); },

  // 账户互斥判断:商户身份(user_type==2 或 role=merchant)
  isMerchantAccount() {
    return app.getUserType() == 2 || app.getUserRole() === 'merchant';
  },

  // ===== 步骤导航 =====
  refreshStep(step) {
    // stepIn 先落再抬:大标题不随 wx:if 重挂,只能靠去掉/加回 .in 重播进场动画。
    // 步骤内容(.step)本身随 wx:if 重挂自动重播,不需要这里管。
    this.setData({
      step: step,
      stepTitle: STEP_TITLES[step - 1],
      backLabel: step === 1 ? '设置' : STEP_NAMES[step - 2],
      stepIn: false
    }, this.validate);
    if (step === 4) this.ensureIdentityStatus();
    var that = this;
    wx.nextTick(function () { that.setData({ stepIn: true }); });
  },

  // 实名登记状态:走到第四屏才问一次。资格还没确认的人、停在前三步的人都不该多发这一发
  // (与本页「身份检查完成前不发请求」的既有口径一致)。已登记的人据此收起那两个字段。
  ensureIdentityStatus() {
    if (this._identityStatusRequested) return;
    this._identityStatusRequested = true;
    var that = this;
    publisherIdentity.loadIdentityStatus(function (registered) {
      if (registered) that.setData({ identityRegistered: true }, that.validate);
    });
  },

  // 开场屏 → 第一步。四步之前先给一屏说清「这是什么、要多久、填完得到什么」。
  // 那颗 CTA 会飞上去变成进度条,几何与约束见 utils/wizard-morph.js。
  startForm() {
    if (this.data.bootstrapState !== 'ready') return;
    if (this.data.reducedMotion) {          // 减动效:直接切,不放形变
      this.setData({ mode: 'form' });
      this.refreshStep(1);
      return;
    }
    var that = this;
    wizardMorph.runIntroMorph(this, {
      segSel: '.prog__seg',
      enterData: { mode: 'form' },
      afterEnter: function () { that.refreshStep(1); },
    });
  },

  endMorph() { wizardMorph.endIntroMorph(this); },

  onBack() {
    if (this._submitting) return;
    // 第一步往回退到开场屏,不是直接摔出页面 —— 开场屏才是这条流程的起点
    if (this.data.mode === 'form' && this.data.step === 1) { this.setData({ mode: 'intro' }); return; }
    if (this.data.step === 1) { this.exitPage(); return; }
    this.refreshStep(this.data.step - 1);
  },

  exitPage() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/talent/list/index' });
  },

  onNext() {
    if (this._submitting || !this.data.canNext || this.data.bootstrapState !== 'ready') return;
    if (this.data.step < 4) { this.refreshStep(this.data.step + 1); }
    else { this.submit(); }
  },

  validate() {
    var d = this.data, ok = false;
    if (d.step === 1) ok = !!(d.leaderName && d.phone);
    else if (d.step === 2) ok = !!d.experience;
    // 第四步是「资质(选填) + 发布者实名(必填)」。实名是这次新加的硬闸:
    // 姓名 + 身份证号 + 单独同意三项齐了「成为主理人」才亮,规则只有 utils/publisher-identity.js 一份。
    else if (d.step === 4) ok = publisherIdentity.identitySatisfied(this.identityForm())
      && !d.certUploading.length && !d.certErrorIndexes.length;
    else ok = true; // 能力自评选填
    // 「已选 N 项」要跟着四个布尔走,不能在 wxml 里算(表达式里没有求和)
    var caps = [d.canDesignRoute, d.canDesignTask, d.canNpc, d.canMerchantCoop];
    var capCount = caps.filter(Boolean).length;
    this.setData({ canNext: ok, capCount: capCount });
  },

  // 页面字段名与共用校验的入参名之间唯一的翻译处
  identityForm() {
    var d = this.data;
    return {
      realName: d.realName,
      idCard: d.idCard,
      consented: d.identityConsented,
      identityRegistered: d.identityRegistered,
      source: publisherIdentity.SOURCE_CLUB_APPLY,
    };
  },

  onIdentityConsent(e) {
    this.setData({ identityConsented: !!e.detail.checked }, this.validate);
  },

  onInput(e) {
    var f = e.currentTarget.dataset.field;
    this.setData({ [f]: e.detail.value }, this.validate);
  },

  pickExp(e) {
    this.setData({ experience: e.currentTarget.dataset.val }, this.validate);
  },

  // 能力自评 是/否 切换(0/1)
  toggleBool(e) {
    var f = e.currentTarget.dataset.field;
    // 回调走 validate:能力自评那屏的「已选 N 项」计数就挂在它上面,不回调就不会动
    this.setData({ [f]: this.data[f] ? 0 : 1 }, this.validate);
  },

  // ===== 资质图片 =====
  addCerts() {
    var that = this;
    if (this.data.certUploading.length) return;
    var remain = 9 - this.data.certImages.length;
    if (remain <= 0) { toast('最多9张'); return; }
    var offset = this.data.certImages.length;
    app.chooseImage(function () {}, remain, {
      onUploadStart(filePaths) {
        offset = that.data.certImages.length;
        const indexes = filePaths.map((_, index) => offset + index);
        that.setData({
          certImages: that.data.certImages.concat(filePaths).slice(0, 9),
          certUploading: indexes,
          certErrorIndexes: that.data.certErrorIndexes.filter((index) => index < offset),
        }, that.validate);
      },
      onUploadDone(r, filePaths) {
        const images = that.data.certImages.slice();
        filePaths.forEach((path, index) => { images[offset + index] = r.results[index] || path; });
        const errors = that.data.certErrorIndexes.filter((index) => index < offset)
          .concat((r.failures || []).map((failure) => offset + failure.index));
        that.setData({ certImages: images.slice(0, 9), certUploading: [], certErrorIndexes: errors }, that.validate);
        return true;
      },
    });
  },

  retryCert(e) {
    const index = Number(e.detail.index);
    const path = this.data.certImages[index];
    if (!path || this.data.certUploading.length) return;
    this.setData({
      certUploading: [index],
      certErrorIndexes: this.data.certErrorIndexes.filter((value) => value !== index),
    }, this.validate);
    app.getUploadClient().uploadAll([path], {
      bizType: 'image_free',
      onDone: (r) => {
        if (r.ok && r.results[0]) {
          const images = this.data.certImages.slice();
          images[index] = r.results[0];
          this.setData({
            certImages: images,
            certUploading: [],
            certErrorIndexes: this.data.certErrorIndexes.filter((value) => value !== index),
          }, this.validate);
        } else {
          this.setData({
            certUploading: [],
            certErrorIndexes: Array.from(new Set(this.data.certErrorIndexes.concat(index))),
          }, this.validate);
        }
      },
    });
  },

  removeCert(e) {
    var i = e.detail.index;
    var arr = this.data.certImages.slice();
    arr.splice(i, 1);
    this.setData({
      certImages: arr,
      certErrorIndexes: this.data.certErrorIndexes
        .filter((index) => index !== i)
        .map((index) => index > i ? index - 1 : index),
    });
  },

  // ===== 提交(填完即有 → /api/club/become-leader) =====
  submit() {
    if (this._submitting || !this.data.canNext || this.data.bootstrapState !== 'ready') return;
    // 账户互斥兜底:提交前再拦一次商户账户
    if (this.isMerchantAccount()) {
      toast('商户账号不能申请主理人');
      return;
    }
    var that = this;
    this._submitting = true;
    var submitEpoch = (this._submitEpoch || 0) + 1;
    this._submitEpoch = submitEpoch;
    this.setData({ submitting: true, submitError: '', submitErrorKind: 'data' });

    // 实名登记是「申请之前」的一发独立写:先落身份、再落主理人档案。
    // 顺序不能反 —— /api/club/become-leader 在服务端要查实名是否已登记(ApiClubController 的闸),
    // 两发并排发会被拦成「请先登记实名信息」。已登记的人直接跳过这一发。
    if (this.data.identityRegistered) { this.sendLeaderApply(submitEpoch); return; }
    publisherIdentity.registerIdentity(this.identityForm(), function (r) {
      if (submitEpoch !== that._submitEpoch) return;
      if (!r.ok) {
        that._submitting = false;
        that.setData({
          submitting: false,
          submitErrorKind: r.network ? 'network' : 'data',
          submitError: r.message,
        });
        return;
      }
      // 登记成功当场把这一屏的字段收起:口径是只回状态,值不下发也不再看第二遍
      that.setData({ identityRegistered: true }, that.validate);
      that.sendLeaderApply(submitEpoch);
    });
  },

  sendLeaderApply(submitEpoch) {
    var d = this.data, that = this;
    app.sendRequest({
      url: '/api/club/become-leader',
      method: 'POST',
      data: JSON.stringify({
        leaderName: d.leaderName,
        phone: d.phone,
        identity: d.identity,
        coFounders: d.coFounders,
        experience: d.experience,
        hasExperience: (d.experience && d.experience !== '没有经验') ? 1 : 0,
        maxEventSize: d.maxEventSize ? parseInt(d.maxEventSize) : null,
        avgEventSize: d.avgEventSize ? parseInt(d.avgEventSize) : null,
        canDesignRoute: d.canDesignRoute,
        canDesignTask: d.canDesignTask,
        canNpc: d.canNpc,
        canMerchantCoop: d.canMerchantCoop,
        hasGuideCert: d.hasGuideCert,
        certImages: d.certImages.join(',')
      }),
      header: { 'Content-Type': 'application/json' },
      success: function (res) {
        if (submitEpoch !== that._submitEpoch) return;
        that._submitting = false;
        if (res.code == '200') {
          // 填完即有:即时回填本地 role 并清缓存,避免后续入口仍按旧 player 路由(role 抖动)
          app.setUserRole('club');
          roleGuard.clear();
          that.setData({
            mode: 'done', doneState: 'ready',
            submitting: false,
            submitError: '',
            submissionReceipt: { leaderName: d.leaderName, phone: d.phone },
          });
        } else {
          that.setData({
            submitting: false,
            submitErrorKind: 'data',
            submitError: (res && res.msg) || '提交没有完成，请稍后重试',
          });
        }
      },
      fail: function (error) {
        if (submitEpoch !== that._submitEpoch) return;
        that._submitting = false;
        var network = isTransportFailure(error);
        that.setData({
          submitting: false,
          submitErrorKind: network ? 'network' : 'data',
          submitError: network
            ? '网络异常，请检查连接后重试'
            : ((error && (error.msg || error.message)) || '提交没有完成，请稍后重试'),
        });
      }
    });
  },

  retrySubmit() { this.submit(); },

  onHeaderBack() {
    if (this._submitting) return;
    if (this.data.mode === 'done') { this.onExit(); }
    else { this.onBack(); }
  },

  retryLeaderStatus() {
    if (this._leaderStatusChecking) return;
    this._leaderStatusChecking = true;
    var statusEpoch = (this._leaderStatusEpoch || 0) + 1;
    this._leaderStatusEpoch = statusEpoch;
    var that = this;
    this.setData({ doneState: 'loading' });
    roleGuard.load(function (snapshot) {
      if (statusEpoch !== that._leaderStatusEpoch) return;
      that._leaderStatusChecking = false;
      that.setData({
        doneState: snapshot && roleGuard.hasSnapshot() && roleGuard.isClubLeader() ? 'ready' : 'error',
      });
    });
  },

  // 成为主理人后 → 去创建第一个俱乐部(表单B)
  goCreateClub() { wx.redirectTo({ url: '/pages/club/create/index' }); },

  onExit() { this.exitPage(); }
});

function isTransportFailure(error) {
  return /request:fail|timeout/i.test(String(error && error.errMsg || ''));
}
