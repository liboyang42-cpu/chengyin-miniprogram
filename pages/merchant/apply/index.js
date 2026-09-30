const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const app = getApp();
const roleGuard = require('../../../utils/roleGuard.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const merchantIdentity = require('../../../utils/merchant-identity-policy.js');

const STEP_TITLES = ['基础信息', '经营信息', '资质信息', '预览确认'];
const STEP_EYEBROWS = ['商家入驻', '经营信息', '资质审核', '提交前确认'];
const STEP_HEADLINES = ['先认识你的店', '告诉大家怎样找到你', '补齐审核需要的资料', '确认这份入驻信息'];
// 时/分选项与 HH:mm 格式化的单一真源(补零口径全仓一致)
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const wizardMorph = require('../../../utils/wizard-morph.js');
const timeOptions = require('../../../utils/time-picker-options.js');
const publisherIdentity = require('../../../utils/publisher-identity.js');
const TIME_HOURS = timeOptions.HOURS;
const TIME_MINUTES = timeOptions.MINUTES;

function timePickerValue(value) {
  const parts = /^\d{2}:\d{2}$/.test(value || '') ? value.split(':').map(Number) : [0, 0];
  return [Math.min(23, Math.max(0, parts[0])), Math.min(59, Math.max(0, parts[1]))];
}

function displayText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join('、');
  if (typeof value === 'object') {
    var key = ['name', 'title', 'label', 'text', 'value'].find(function (item) {
      return value[item] !== undefined;
    });
    return key ? displayText(value[key]) : '';
  }
  return String(value).trim();
}

function imageUrl(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return displayText(value.url || value.src || value.path || value.value);
  }
  return displayText(value);
}

function imageList(value) {
  var items = Array.isArray(value) ? value :
    (value && typeof value === 'object' ? [value] : displayText(value).split(','));
  return items.map(imageUrl).filter(Boolean);
}

function requestFailureText(error) {
  return displayText(error && (error.msg || error.message || error.errMsg));
}

function isNetworkFailure(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.statusCode !== undefined || error.code !== undefined) return false;
  var transportText = displayText(error.errMsg);
  return /request:fail|timeout|network|网络|断网/i.test(transportText);
}

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    mode: 'form',
    bootstrapState: 'checking-role',
    bootstrapError: '',
    bootstrapErrorKind: '',
    everSettled: false,   // 读到过一次申请状态后,回页复检失败留原页给「重新检查」,不把半填的表单踢走
    // intro = 四步之前的开场屏(Figma M0);ready 后先落这里,按下 CTA 才进第一步
    introMode: true,
    morphing: false,
    morph: null,
    morphRun: false,
    step: 1,
    reducedMotion: false,
    stepLabels: STEP_TITLES,
    stepEyebrows: STEP_EYEBROWS,
    stepHeadlines: STEP_HEADLINES,
    dots: [0, 1, 2, 3],
    // 表单字段
    name: '',             // 店铺名称
    preference: '',       // 经营类目(逗号分隔)
    phone: '',
    address: '',          // 店铺地址
    // 选点坐标:wx.chooseLocation 本来就跟 address 一起返回,以前被丢掉了,
    // 结果生产库 10 家商家全有地址、零家有坐标。留住它,商家就不用事后再去装修页点一遍。
    locationLat: null,
    locationLng: null,
    businessTime: '',     // 营业时间
    description: '',      // 店铺介绍
    businessLicense: '',  // 营业执照(单张)
    derivatives: [],      // 品牌形象图(多张)
    // RUN-52 发布者实名(第 4 步)。registered 只有真/假:接口不下发姓名与证件号的值。
    identityRegistered: false,
    realName: '',
    idCard: '',
    identityConsented: false,
    identityHint: publisherIdentity.CONSENT_TEXT,
    identityDoneHint: publisherIdentity.ALREADY_REGISTERED_HINT,
    canNext: false,
    submitting: false,
    submitError: '',
    submitErrorKind: '',
    submissionReceipt: null,
    apply: null,
    ownedClubs: [], hasOwnedClubs: false,
    // 经营时间选择器(2026-07-31:周一~周日 + 起止时段,取代自由输入)
    hoursPickerShow: false,
    timeHours: TIME_HOURS,
    timeMinutes: TIME_MINUTES,
    startTimeValue: [10, 0],
    endTimeValue: [22, 0],
    hoursDraft: {
      days: [
        { key: 1, label: '一', on: true }, { key: 2, label: '二', on: true },
        { key: 3, label: '三', on: true }, { key: 4, label: '四', on: true },
        { key: 5, label: '五', on: true }, { key: 6, label: '六', on: true },
        { key: 7, label: '日', on: true }
      ],
      start: '10:00',
      end: '22:00'
    }
  },

  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),

  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。

  showPrivacyGate() {

    this.setData({ privacyGateShow: true });

  },

  onPrivacyGateSettled() {

    this.setData({ privacyGateShow: false });

  },


  onLoad() { this.startBootstrap(); },

  startBootstrap() {
    var identityKey = currentIdentityKey();
    if (this._bootstrapChecking && this._bootstrapIdentityKey === identityKey) return;
    var identityChanged = this._activeIdentityKey !== undefined && this._activeIdentityKey !== identityKey;
    if (this._activeIdentityKey === undefined || identityChanged) {
      this._identityEpoch = (this._identityEpoch || 0) + 1;
    }
    if (identityChanged) {
      wizardMorph.cancelIntroMorph(this); this._bootstrapSettled = false;
      this.setData({
        mode: 'form', introMode: true, step: 1,
        name: '', preference: '', phone: '', address: '',
        locationLat: null, locationLng: null, businessTime: '', description: '',
        businessLicense: '', derivatives: [], canNext: false,
        submitting: false, submitError: '', submitErrorKind: '',
        submissionReceipt: null, apply: null, ownedClubs: [], hasOwnedClubs: false
      });
    }
    this._activeIdentityKey = identityKey;
    this._bootstrapIdentityKey = identityKey;
    this._bootstrapChecking = true;
    var bootstrapEpoch = (this._bootstrapEpoch || 0) + 1;
    this._bootstrapEpoch = bootstrapEpoch;
    var that = this;
    this.setData({ bootstrapState: 'checking-role', bootstrapError: '', bootstrapErrorKind: '' });
    // 申请可先审核；角色快照用于列出商家账号生效前仍须处理的俱乐部。
    roleGuard.load(function (roleSnapshot) {
      if (bootstrapEpoch !== that._bootstrapEpoch || identityKey !== currentIdentityKey()) return;
      if (!roleSnapshot || !roleGuard.hasSnapshot()) {
        that._bootstrapChecking = false;
        that.setData({
          bootstrapState: 'error',
          bootstrapError: '暂时无法确认当前账号的申请资格，请重新检查',
          bootstrapErrorKind: 'error'
        });
        return;
      }
      var ownedClubs = merchantIdentity.normalizeOwnedClubs(
        roleSnapshot.ownedClubs
      );
      if (!ownedClubs) return that.failRoleContract();
      that.setData({ ownedClubs: ownedClubs, hasOwnedClubs: ownedClubs.length > 0, introMode: ownedClubs.length ? false : that.data.introMode });
      that.checkExisting(bootstrapEpoch, identityKey);
    });
  },

  retryBootstrap() { this.startBootstrap(); },

  onShow() {
    merchantTheme.merchantPageShow();
    // 减动效开关在设置页可随时改,每次回到本页重读
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
    if (this._hasShown) { roleGuard.clear(); this.startBootstrap(); }
    else this._hasShown = true;
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    wizardMorph.cancelIntroMorph(this);
    this._bootstrapEpoch = (this._bootstrapEpoch || 0) + 1;
    this._identityEpoch = (this._identityEpoch || 0) + 1;
    this._submitEpoch = (this._submitEpoch || 0) + 1;
    this._bootstrapChecking = false;
    merchantTheme.merchantPageRestore();
  },

  checkExisting(bootstrapEpoch, identityKey) {
    var that = this, preserveDraft = this._bootstrapSettled && this.data.mode === 'form' && this.data.step < 5;
    this.setData({ bootstrapState: 'checking-application', bootstrapError: '', bootstrapErrorKind: '' });
    app.sendRequest({
      url: '/api/merchant/info',
      method: 'POST',
      hideLoading: true,
      autoErrorToast: false,   // 查不到结论一律落 bootstrapState=error → auto-back 半屏讲原因
      success: function (res) {
        if (bootstrapEpoch !== that._bootstrapEpoch || identityKey !== currentIdentityKey()) return;
        that._bootstrapChecking = false; that._bootstrapSettled = true;
        if (!that.data.everSettled) that.setData({ everSettled: true });
        var resolved = merchantIdentity.resolveApplicationResponse(res);
        if (resolved && resolved.kind === 'application') {
          var source = resolved.data;
          var apply = merchantIdentity.decorateApplication(Object.assign({}, source, {
            name: displayText(source.name),
            preference: displayText(source.preference),
            phone: displayText(source.phone),
            address: displayText(source.address),
            businessTime: displayText(source.businessTime),
            description: displayText(source.description),
            reson: displayText(source.reson),
            createTime: displayText(source.createTime)
          }));
          var keepDraft = preserveDraft && apply.canReapply;
          that.setData({
            bootstrapState: 'ready',
            mode: keepDraft ? 'form' : 'status',
            apply: apply,
            step: keepDraft ? that.data.step : 1,
            name: keepDraft ? that.data.name : apply.name,
            preference: keepDraft ? that.data.preference : apply.preference,
            phone: keepDraft ? that.data.phone : apply.phone,
            address: keepDraft ? that.data.address : apply.address,
            // 故意不回填坐标:回填了再提交,服务端会把它当成"商家刚在地图上点的"而标成已确认。
            // 被驳回后重新提交这条路上,回填的往往正是上次按地址推断出来的坐标,一来一回
            // 推断值就冒充成了商家确认值。留空即可 —— 服务端见坐标为空会原样保留库里已有的。
            businessTime: keepDraft ? that.data.businessTime : apply.businessTime,
            description: keepDraft ? that.data.description : apply.description,
            businessLicense: keepDraft ? that.data.businessLicense : imageUrl(source.businessLicense),
            derivatives: keepDraft ? that.data.derivatives : imageList(source.derivatives)
          }, that.validate);
        } else if (resolved && resolved.kind === 'none') {
          that.setData({ bootstrapState: 'ready', mode: 'form', apply: null });
        } else {
          that.setData({
            bootstrapState: 'error',
            bootstrapError: displayText(res && res.msg) || '暂时无法确认申请状态，请重试',
            bootstrapErrorKind: 'error'
          });
        }
      },
      fail: function (error) {
        if (bootstrapEpoch !== that._bootstrapEpoch || identityKey !== currentIdentityKey()) return;
        that._bootstrapChecking = false;
        var networkFailure = isNetworkFailure(error);
        that.setData({
          bootstrapState: 'error',
          bootstrapError: networkFailure
            ? '网络连接失败，请检查网络后重新检查'
            : requestFailureText(error) || '暂时无法确认申请状态，请重试',
          bootstrapErrorKind: networkFailure ? 'network' : 'error'
        });
      }
    });
  },

  // ===== 步骤 =====
  refreshStep(step) {
    // stepIn 先落再抬:wizard-head 的三段文案不随 wx:if 重挂,只能靠去掉/加回
    // .cy-rise-in 重播。步骤体本身随 wx:if 重挂自动重播,不需要这里管。
    this.setData({
      step: step,
      stepIn: false
    }, this.validate);
    if (step === 4) this.ensureIdentityStatus();
    var that = this;
    wx.nextTick(function () { that.setData({ stepIn: true }); });
  },

  // 实名登记状态:走到第四屏才问一次。资格没确认、还没走到第四步的人都不该多发这一发
  // (与本页「身份检查完成前不得请求」的既有口径一致)。已登记的人据此收起那两个字段。
  ensureIdentityStatus() {
    if (this._identityStatusRequested) return;
    this._identityStatusRequested = true;
    var that = this;
    publisherIdentity.loadIdentityStatus(function (registered) {
      if (registered) that.setData({ identityRegistered: true }, that.validate);
    });
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
      segSel: '.progress-segment',
      enterData: { introMode: false },
      afterEnter: function () { that.refreshStep(1); },
    });
  },

  endMorph() { wizardMorph.endIntroMorph(this); },

  onBack() {
    if (this.data.submitting) return;
    // 第一步往回退到开场屏,不是直接摔出页面
    if (!this.data.introMode && this.data.step === 1) { this.setData({ introMode: true }); return; }
    if (this.data.step === 1) { this.exitPage(); return; }
    this.refreshStep(this.data.step - 1);
  },

  exitPage() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/merchant/index/index' });
  },

  onNext() {
    if (!this.data.canNext) return;
    if (this.data.step < 4) { this.refreshStep(this.data.step + 1); }
    else { this.submit(); }
  },
  onInput(e) { var f = e.currentTarget.dataset.field;
    this.setData({ [f]: e.detail.value }, this.validate);
  },

  // 置灰的「继续/提交」被点 → 报出本步第一条没交的必填,别让按钮静默地按不动。
  onNextDisabledTap() {
    const d = this.data;
    if (d.step === 1) toast(!d.name ? '请填写店铺名称' : '请填写联系电话');
    else if (d.step === 2) toast(!d.address ? '请填写店铺地址' : '请选择营业时间');
    else if (d.step === 3) toast('请上传营业执照');
    else if (d.step === 4) {
      // 第 4 步唯一拦人的项是经营者实名,报第一条不满足的原因(规则在 utils/publisher-identity.js)
      const check = publisherIdentity.checkIdentityForm(this.identityForm());
      if (!check.ok) toast(check.message);
    }
  },

  validate() {
    var d = this.data, ok = false;
    if (d.step === 1) ok = !!(d.name && d.phone);
    else if (d.step === 2) ok = !!(d.address && d.businessTime);
    else if (d.step === 3) ok = !!d.businessLicense;
    // 预览确认页的硬性缺项只有实名:姓名 + 身份证号 + 单独同意三项齐了「提交申请」才亮
    else if (d.step === 4) ok = publisherIdentity.identitySatisfied(this.identityForm());
    else ok = true;
    this.setData({ canNext: ok });
  },

  // 页面字段名与共用校验入参名之间唯一的翻译处
  identityForm() {
    var d = this.data;
    return {
      realName: d.realName,
      idCard: d.idCard,
      consented: d.identityConsented,
      identityRegistered: d.identityRegistered,
      source: publisherIdentity.SOURCE_MERCHANT_APPLY,
    };
  },

  onIdentityConsent(e) {
    this.setData({ identityConsented: !!e.detail.checked }, this.validate);
  },

  // ===== 店铺地址:微信原生位置选择(2026-07-31) =====
  chooseLocation() {
    const that = this;
    const identityTicket = this.identityTicket();
    modal.show({
      title: '选择店铺位置',
      content: '将打开微信地图，用于标注店铺地址；仅在本次选择时获取位置。',
      confirmText: '打开地图',
      success(result) {
        if (result.confirm && that.isIdentityTicketCurrent(identityTicket)) that.openLocationPicker(identityTicket);
      }
    });
  },

  openLocationPicker(identityTicket) {
    var that = this;
    var ticket = identityTicket || this.identityTicket();
    wx.chooseLocation({
      success: function (res) {
        if (!that.isIdentityTicketCurrent(ticket)) return;
        that.setData({
          address: res.address || res.name || '',
          locationLat: res.latitude,
          locationLng: res.longitude
        }, that.validate);
      },
      fail: function (err) {
        if (!that.isIdentityTicketCurrent(ticket)) return;
        const message = String((err && err.errMsg) || '');
        if (/cancel/i.test(message)) return;
        const denied = /auth deny|authorize|permission/i.test(message);
        modal.show({
          title: '无法选择位置',
          content: denied ? '请开启定位权限后重试；已填内容会保留，也可以先继续填写其他内容。' : '地图暂时无法打开，已填内容会保留，可以稍后重试。',
          confirmText: denied ? '去设置' : '知道了',
          cancelText: '稍后再试',
          showCancel: denied,
          success(result) {
            if (denied && result.confirm && that.isIdentityTicketCurrent(ticket)) wx.openSetting();
          }
        });
      }
    });
  },

  // ===== 经营时间:周一~周日 + 起止时段(2026-07-31) =====
  openHoursPicker() {
    this.setData({
      hoursPickerShow: true,
      startTimeValue: timePickerValue(this.data.hoursDraft.start),
      endTimeValue: timePickerValue(this.data.hoursDraft.end),
    });
  },
  closeHoursPicker() { this.setData({ hoursPickerShow: false }); },
  toggleHoursDay(e) {
    var i = e.currentTarget.dataset.index;
    var days = this.data.hoursDraft.days.slice();
    days[i] = Object.assign({}, days[i], { on: !days[i].on });
    this.setData({ 'hoursDraft.days': days });
  },
  onHoursStartChange(e) {
    const value = e.detail.value || [0, 0];
    this.setData({
      startTimeValue: value,
      'hoursDraft.start': timeOptions.formatHM(TIME_HOURS[value[0]], TIME_MINUTES[value[1]]),
    });
  },
  onHoursEndChange(e) {
    const value = e.detail.value || [0, 0];
    this.setData({
      endTimeValue: value,
      'hoursDraft.end': timeOptions.formatHM(TIME_HOURS[value[0]], TIME_MINUTES[value[1]]),
    });
  },
  confirmHoursPicker() {
    var d = this.data.hoursDraft;
    var onDays = d.days.filter(function (x) { return x.on; });
    if (!onDays.length) {
      toast('至少选择一个经营日');
      return;
    }
    // 经营时间【允许跨夜】(酒吧 20:00-02:00 是真实场景),但必须说清是次日,
    // 否则「20:00-02:00」看起来像个负时段。起止完全相同 = 零时长,那是填错。
    var startMin = timeOptions.minutesOfDay.apply(null, d.start.split(':'));
    var endMin = timeOptions.minutesOfDay.apply(null, d.end.split(':'));
    if (startMin === endMin) {
      toast('开始与结束时间不能相同');
      return;
    }
    var overnight = endMin < startMin;
    var dayText = onDays.length === 7 ? '周一至周日' : '周' + onDays.map(function (x) { return x.label; }).join('、');
    this.setData({
      businessTime: dayText + ' ' + d.start + '-' + (overnight ? '次日' : '') + d.end,
      hoursPickerShow: false
    }, this.validate);
  },

  // ===== 营业执照(单张,必填) =====
  uploadLicense() {
    var that = this;
    var identityTicket = this.identityTicket();
    app.chooseImage(function (urls) {
      if (!that.isIdentityTicketCurrent(identityTicket)) return;
      that.setData({ businessLicense: urls[0] || '' }, that.validate);
    }, 1);
  },
  removeLicense() { this.setData({ businessLicense: '' }, this.validate); },

  // ===== 品牌形象图(多张,选填) =====
  addDerivative() {
    var that = this;
    var identityTicket = this.identityTicket();
    var remain = 6 - this.data.derivatives.length;
    if (remain <= 0) { toast('最多6张'); return; }
    app.chooseImage(function (urls) {
      if (!that.isIdentityTicketCurrent(identityTicket)) return;
      that.setData({ derivatives: that.data.derivatives.concat(urls).slice(0, 6) });
    }, remain);
  },
  removeDerivative(e) {
    var i = e.currentTarget.dataset.i;
    var arr = this.data.derivatives.slice();
    arr.splice(i, 1);
    this.setData({ derivatives: arr });
  },

  // ===== 提交(JSON格式,同 shanghuziliao) =====
  submit() {
    if (this.data.submitting) return;
    var d = this.data, that = this;
    var identityTicket = this.identityTicket();
    var submitEpoch = (this._submitEpoch || 0) + 1;
    this._submitEpoch = submitEpoch;
    this.setData({ submitting: true, submitError: '', submitErrorKind: '' });

    // 实名登记是入驻申请【之前】的一发独立写:先落身份、再落入驻单。
    // 顺序不能反 —— /api/merchant/merchant_registration 在服务端对新 Registration 会查实名是否
    // 已登记(ApiMerchantController 的闸),并发发会直接被拦成「请先登记实名信息」。
    if (d.identityRegistered) { this.sendRegistration(identityTicket, submitEpoch); return; }
    publisherIdentity.registerIdentity(this.identityForm(), function (r) {
      // 登记那一发回来时人可能已经切过账号/退过页,这发续跑要先过和入驻单同一道 staleness 闸
      if (submitEpoch !== that._submitEpoch || !that.isIdentityTicketCurrent(identityTicket)) return;
      if (!r.ok) {
        that.setData({
          submitting: false,
          submitErrorKind: r.network ? 'network' : 'data',
          submitError: r.message
        });
        return;
      }
      // 登记成功当场把字段收起:口径是只回状态,值不再看第二遍
      that.setData({ identityRegistered: true }, that.validate);
      that.sendRegistration(identityTicket, submitEpoch);
    });
  },

  sendRegistration(identityTicket, submitEpoch) {
    var d = this.data, that = this;
    var payload = {
      id: d.apply && d.apply.status === 2 ? d.apply.id : null,
      name: d.name,
      preference: d.preference,
      phone: d.phone,
      address: d.address,
      locationLat: d.locationLat,
      locationLng: d.locationLng,
      businessTime: d.businessTime,
      description: d.description,
      businessLicense: d.businessLicense,
      derivatives: d.derivatives.join(',')
    };
    app.sendRequest({
      url: '/api/merchant/merchant_registration', method: 'POST',
      data: JSON.stringify(payload),
      header: {
        'Content-Type': 'application/json'
      },
      success: function (res) {
        if (submitEpoch !== that._submitEpoch || !that.isIdentityTicketCurrent(identityTicket)) return;
        if (res.code == '200') {
          that.setData({
            submitting: false,
            submitError: '',
            submitErrorKind: '',
            submissionReceipt: { name: payload.name, phone: payload.phone },
            step: 5,
            mode: 'form'
          });
        } else {
          that.setData({
            submitting: false,
            submitError: displayText(res && res.msg) || '提交未完成，请稍后重试',
            submitErrorKind: 'data'
          });
        }
      },
      fail: function (error) {
        if (submitEpoch !== that._submitEpoch || !that.isIdentityTicketCurrent(identityTicket)) return;
        var networkFailure = isNetworkFailure(error);
        that.setData({
          submitting: false,
          submitError: networkFailure
            ? '网络连接失败，已填写的资料会保留，请重新提交'
            : requestFailureText(error) || '提交未完成，请稍后重试',
          submitErrorKind: networkFailure ? 'network' : 'data'
        });
      }
    });
  },

  retrySubmit() { this.submit(); },

  onReapply() {
    if (this.data.apply && this.data.apply.canReapply) {
      this.setData({ mode: 'form', step: 1 }, this.validate);
    } else {
      toast('审核中，请耐心等待');
    }
  },

  onHeaderBack() {
    var d = this.data;
    if (d.step === 5) { this.onHome(); }
    else if (d.mode === 'status') { this.onExit(); }
    else { this.onBack(); }
  },

  onStatusAction() {
    var d = this.data;
    if (d.apply && d.apply.canReapply) { this.onReapply(); }
    else { this.onExit(); }
  },

  openClubGovernance(event) {
    var clubId = event && event.currentTarget && event.currentTarget.dataset.clubId;
    var club = this.data.ownedClubs.find(function (item) { return String(item.id) === String(clubId); });
    if (!club || !club.canTransfer) return;
    wx.navigateTo({ url: '/pages/club/governance/index?clubId=' + encodeURIComponent(club.id) });
  },

  identityTicket() {
    return { identityKey: currentIdentityKey(), epoch: this._identityEpoch || 0 };
  },

  isIdentityTicketCurrent(ticket) {
    return !!ticket && ticket.epoch === (this._identityEpoch || 0)
      && ticket.identityKey === currentIdentityKey();
  },

  failRoleContract() {
    this._bootstrapChecking = false;
    this.setData({ bootstrapState: 'error', bootstrapError: '账号下的俱乐部信息暂时无法读取，请重新检查', bootstrapErrorKind: 'error' });
  },

  onHome() { wx.switchTab({ url: '/pages/index/index' }); },

  onExit() { this.exitPage(); }
});

function currentIdentityKey() {
  var userId = typeof app.getUserID === 'function' ? app.getUserID() : app.globalData && app.globalData.user_id;
  return String(userId || '');
}
