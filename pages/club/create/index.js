const app = getApp();
const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const roleGuard = require('../../../utils/roleGuard.js');
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const wizardMorph = require('../../../utils/wizard-morph.js');
const { bizFailureMessage } = require('../../../utils/response-shape.js');

// ⚠️ chip 选中判定必须由 JS 预算好。WXML 表达式**不支持方法调用**,
// 原来的 activityPrefs.indexOf(item) >= 0 恒为假 —— 2026-09-02 截图对稿实测:
// 选满 3 个后底色仍是未选态,稿要求的白底黑字加粗从来没渲染过。
function buildDirList(options, prefs) {
  return (options || []).map(function (val) {
    return { val: val, on: (prefs || []).indexOf(val) >= 0 ? 1 : 0 };
  });
}

// 创建俱乐部(D18 表单B,轻量·填完即有)。参考 Strava 创建俱乐部向导:类型→方向→资料→城市。
Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    // intro = 四步之前的开场屏(Figma G0);ready 后先落这里,按下 CTA 才进第一步
    introMode: true,
    step: 1,
    dots: [0, 1, 2, 3],
    reducedMotion: false,
    morphing: false,
    morph: null,
    morphRun: false,
    // 单选大类(既是分类,也是自动标签来源)
    typeOptions: [
      { val: '校园社团', sub: '学生组织 · 校园路线' },
      { val: '旅行组织', sub: '城市探索 · 户外带队' },
      { val: '兴趣社群', sub: '同好聚集 · 城市路线' },
      { val: '商业活动组织方', sub: '品牌路线 · 商业执行' },
      { val: '内容创作团队', sub: '内容产出 · IP 运营' },
      { val: '其他', sub: '' }
    ],
    dirOptions: ['轻社交', '深度社交', 'RPG体验', '城市定向', '解谜路线', '沉浸式剧情', '运动路线', '艺术体验', '美食体验', '主题聚会'],
    dirList: buildDirList(['轻社交', '深度社交', 'RPG体验', '城市定向', '解谜路线', '沉浸式剧情', '运动路线', '艺术体验', '美食体验', '主题聚会'], []),
    // 表单字段
    clubType: '',
    activityPrefs: [],
    name: '',
    logo: '',
    cover: '',
    description: '',
    city: '',
    keywords: '',
    style: '',
    canNext: false,
    bootstrapState: 'checking', // checking | ready | error | redirecting | no-permission | limit
    bootstrapErrorKind: 'data',
    bootstrapError: '',
    submitState: 'idle', // idle | success
    submitting: false,
    submitErrorKind: 'data',
    submitError: '',
    submissionReceipt: null,
    createdClubId: ''
  },

  onLoad() { this.startBootstrap(); },

  // 减动效开关在设置页可随时改,每次回到本页重读(与 club/enroll 同写法)
  onShow() {
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
  },

  onUnload() {
    wizardMorph.cancelIntroMorph(this);
    this._bootstrapEpoch = (this._bootstrapEpoch || 0) + 1;
    this._submitEpoch = (this._submitEpoch || 0) + 1;
    this._redirectEpoch = (this._redirectEpoch || 0) + 1;
    this._bootstrapChecking = false;
    this._submitting = false;
  },

  startBootstrap() {
    if (this._bootstrapChecking) return;
    this._bootstrapChecking = true;
    const epoch = (this._bootstrapEpoch || 0) + 1;
    this._bootstrapEpoch = epoch;
    const gate = { role: false, quota: false };
    this._bootstrapGate = gate;
    this.setData({
      bootstrapState: 'checking',
      bootstrapErrorKind: 'data',
      bootstrapError: '',
    });

    // 进入前预检①:不是主理人就别让他填完四步再被后端拒。
    // 2026-08-08 用户提:原来这条闸只在 /api/club/create 里,四步填完提交才弹
    // 「创建失败 · 请先成为俱乐部主理人」—— 表白填。
    // 闸放这一页而不是各入口:全站有 4 个入口进来(club/workbench、shezhi、profile 两处),
    // 只有 profile.goBecomeTalent 一个做了判断,逐个补必漏,而这里是它们的汇合处。
    // 判据沿用 roleGuard(仓库指定的权限单一事实源),与 goBecomeTalent 同源,不新造标准。
    // 拿不到快照时 fail-closed 并原位重试；资格未知时露出表单会让用户填完才被后端拒绝。
    roleGuard.load((snapshot) => {
      if (epoch !== this._bootstrapEpoch) return;
      if (!snapshot || !roleGuard.hasSnapshot()) {
        this.failBootstrap(epoch, 'data', '暂时无法确认主理人资格，请重新检查');
        return;
      }
      if (!roleGuard.isClubLeader()) {
        this._bootstrapChecking = false;
        this._bootstrapEpoch = epoch + 1;
        this.goApply();
        return;
      }
      gate.role = true;
      this.finishBootstrapWhenReady(epoch, gate);
    });

    // 进入前预检②:已达 2 个俱乐部上限则不再让其填表(后端也会拦)
    app.sendRequest({
      url: '/api/club/my', method: 'POST', hideLoading: true, autoErrorToast: false,
      success: (res) => {
        if (epoch !== this._bootstrapEpoch) return;
        if (!isOwnedQuotaPayload(res)) {
          const hasObjectEnvelope = Boolean(res && res.code == '200' && res.data && typeof res.data === 'object');
          this.failBootstrap(
            epoch,
            'data',
            hasObjectEnvelope
              ? '俱乐部名额数据不完整，请重试'
              : bizFailureMessage(res, '俱乐部名额没有加载出来'),
          );
          return;
        }
        const owned = res.data.owned;
        if (owned.length >= 2) {
          this._bootstrapChecking = false;
          this._bootstrapEpoch = epoch + 1;
          this.setData({ bootstrapState: 'limit', bootstrapError: '' });
          return;
        }
        gate.quota = true;
        this.finishBootstrapWhenReady(epoch, gate);
      },
      fail: (error) => {
        const network = isTransportFailure(error);
        this.failBootstrap(
          epoch,
          network ? 'network' : 'data',
          network
            ? '网络异常，请检查连接后重试'
            : ((error && (error.msg || error.message)) || '俱乐部名额没有加载出来'),
        );
      },
    });
  },

  finishBootstrapWhenReady(epoch, gate) {
    if (epoch !== this._bootstrapEpoch || gate !== this._bootstrapGate) return;
    if (!gate.role || !gate.quota) return;
    this._bootstrapChecking = false;
    // 两条并行预检一旦共同落定，立即作废同一轮里可能迟到的重复回调。
    this._bootstrapEpoch = epoch + 1;
    this.setData({ bootstrapState: 'ready', bootstrapError: '' });
  },

  failBootstrap(epoch, kind, message) {
    if (epoch !== this._bootstrapEpoch) return;
    this._bootstrapChecking = false;
    // 任一预检失败即结束本轮，避免另一条迟到回调把错误态覆盖成 ready。
    this._bootstrapEpoch = epoch + 1;
    this.setData({
      bootstrapState: 'error',
      bootstrapErrorKind: kind,
      bootstrapError: message,
    });
  },

  retryBootstrap() { this.startBootstrap(); },

  goApply() {
    const redirectEpoch = (this._redirectEpoch || 0) + 1;
    this._redirectEpoch = redirectEpoch;
    this.setData({ bootstrapState: 'redirecting' });
    wx.redirectTo({
      url: '/pages/club/apply/index',
      fail: () => {
        if (redirectEpoch !== this._redirectEpoch) return;
        this.setData({ bootstrapState: 'no-permission' });
      },
    });
  },

  goManageClub() { wx.redirectTo({ url: '/pages/club/detail/index?owner=1' }); },

  // ===== 步骤导航 =====
  refreshStep(step) {
    // stepIn 先落再抬:问题标题不随 wx:if 重挂,只能靠去掉/加回 .cy-rise-in 重播。
    // 步骤体(.cc-body)本身随 wx:if 重挂自动重播,不需要这里管。
    this.setData({ step: step, stepIn: false }, this.validate);
    var that = this;
    wx.nextTick(function () { that.setData({ stepIn: true }); });
  },

  // 开场屏 → 第一步。那颗 CTA 会飞上去变成进度条,见 utils/wizard-morph.js。
  startForm() {
    if (this.data.bootstrapState !== 'ready') return;
    if (this.data.reducedMotion) {
      this.setData({ introMode: false });
      this.refreshStep(1);
      return;
    }
    var that = this;
    wizardMorph.runIntroMorph(this, {
      segSel: '.cc-seg',
      enterData: { introMode: false },
      afterEnter: function () { that.refreshStep(1); },
    });
  },

  endMorph() { wizardMorph.endIntroMorph(this); },

  onBack() {
    if (this._submitting) return;
    if (this.data.submitState === 'success') { this.exitPage(); return; }
    // 第一步往回退到开场屏,不是直接摔出页面 —— 开场屏才是这条流程的起点
    if (!this.data.introMode && this.data.step === 1) { this.setData({ introMode: true }); return; }
    if (this.data.step === 1) { this.exitPage(); return; }
    this.refreshStep(this.data.step - 1);
  },

  exitPage() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/talent/list/index' });
  },

  onClose() { if (!this._submitting) this.exitPage(); },

  onNext() {
    if (this._submitting || this.data.bootstrapState !== 'ready' || !this.data.canNext) return;
    if (this.data.step < 4) { this.refreshStep(this.data.step + 1); }
    else { this.submit(); }
  },

  validate() {
    var d = this.data, ok = false;
    if (d.step === 1) ok = !!d.clubType;
    else if (d.step === 2) ok = true;          // 路线方向选填
    else if (d.step === 3) ok = !!d.name;      // 名称必填
    else ok = !!d.city;                        // 城市必填(地理强相关)
    this.setData({ canNext: ok });
  },

  // ===== 输入 =====
  onInput(e) {
    if (this._submitting) return;
    var f = e.currentTarget.dataset.field;
    var value = e.detail.value;
    if (f === 'name') this.setData({ name: value }, this.validate);
    else if (f === 'description') this.setData({ description: value }, this.validate);
    else if (f === 'city') this.setData({ city: value }, this.validate);
    else if (f === 'keywords') this.setData({ keywords: value }, this.validate);
    else if (f === 'style') this.setData({ style: value }, this.validate);
  },

  pickType(e) {
    var val = e.currentTarget.dataset.val;
    this.setData({ clubType: this.data.clubType === val ? '' : val }, this.validate);
  },

  toggleDir(e) {
    var val = e.currentTarget.dataset.val;
    var arr = this.data.activityPrefs.slice();
    var i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1);
    else {
      if (arr.length >= 3) { toast('最多选 3 个'); return; }
      arr.push(val);
    }
    this.setData({ activityPrefs: arr, dirList: buildDirList(this.data.dirOptions, arr) });
  },

  // ===== 图片 =====
  chooseLogo() {
    var that = this;
    app.chooseImage(function (urls) { if (urls && urls.length) that.setData({ logo: urls[0] }); }, 1, { crop: true, cropScale: '1:1' });
  },
  chooseCover() {
    var that = this;
    app.chooseImage(function (urls) { if (urls && urls.length) that.setData({ cover: urls[0] }); }, 1, { crop: true, cropScale: '16:9' });
  },

  // ===== 提交(填完即有 → /api/club/create) =====
  submit() {
    if (this._submitting || this.data.bootstrapState !== 'ready') return;
    var d = this.data, that = this;
    var missingStep = !String(d.clubType || '').trim() ? 1
      : (!String(d.name || '').trim() ? 3 : (!String(d.city || '').trim() ? 4 : 0));
    if (missingStep) {
      var missingLabel = missingStep === 1 ? '选择俱乐部类型'
        : (missingStep === 3 ? '填写俱乐部名称' : '填写所在城市');
      this.setData({
        step: missingStep,
        canNext: false,
        submitErrorKind: 'data',
        submitError: '请先' + missingLabel,
      });
      this.validate();
      return;
    }
    this._submitting = true;
    var submitEpoch = (this._submitEpoch || 0) + 1;
    this._submitEpoch = submitEpoch;
    this.setData({ submitting: true, submitError: '', submitErrorKind: 'data' });
    var payload = {
      name: d.name,
      logo: d.logo,
      cover: d.cover,
      description: d.description,
      clubType: d.clubType,
      activityPrefs: d.activityPrefs.join(','),
      city: d.city,
      address: d.city,
      keywords: d.keywords,
      style: d.style
    };
    app.sendRequest({
      url: '/api/club/create',
      method: 'POST',
      data: JSON.stringify(payload),
      header: { 'Content-Type': 'application/json' },
      success: function (res) {
        if (submitEpoch !== that._submitEpoch) return;
        that._submitting = false;
        if (res.code == '200') {
          const clubId = res.data && (res.data.clubId || res.data.id);
          that.data.createdClubId = clubId == null ? '' : String(clubId);
          that.setData({
            submitting: false,
            submitState: 'success',
            submitError: '',
            submissionReceipt: { name: payload.name, city: payload.city },
          });
        } else {
          that.setData({
            submitting: false,
            submitErrorKind: 'data',
            submitError: (res && res.msg) || '创建没有完成，请稍后重试',
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
            : ((error && (error.msg || error.message)) || '创建没有完成，请稍后重试'),
        });
      }
    });
  },

  retrySubmit() { this.submit(); },

  goCreatedClub() {
    wx.redirectTo({
      url: this.data.createdClubId
        ? '/pages/club/detail/index?id=' + this.data.createdClubId
        : '/pages/club/detail/index?owner=1',
    });
  },
});

function isOwnedQuotaPayload(response) {
  return Boolean(response
    && response.code == '200'
    && response.data
    && typeof response.data === 'object'
    && Object.prototype.hasOwnProperty.call(response.data, 'owned')
    && Array.isArray(response.data.owned));
}

function isTransportFailure(error) {
  return /request:fail|timeout/i.test(String(error && error.errMsg || ''));
}
