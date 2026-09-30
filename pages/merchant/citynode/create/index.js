// 城瘾 · 报名成为节点
// 2026-08-10 收成一屏:商家信息不用填(档案里有),就是「配一个自己店铺的玩法 + 确认店址」。
// 玩法配置复用游戏模板配置页(pages/publish/temp),不再在本页自绘一套迷你表单 ——
// 那套只有标题/玩法/验证方式/奖励券,而 temp 有完整的完成方式、奖励、剧情、语音。
// ★ 保存仍走 /api/merchant/city-node/template/submit(temp 内按 from=citynode 改道):
//   据点端点比普通模板发布多两道闸(validationMethodError + 微信内容安全),绕过去等于把闸拆了。
const modal = require('../../../../utils/modal.js');
const toast = require('../../../../utils/toast.js');
const { isAlbumTemplate, ALBUM_ONLY_IN_STORY } = require('../../../../utils/album-template.js');
const app = getApp();
const merchantTheme = require('../../../../utils/merchant-theme.js');
const merchantAccessPolicy = require('../../../../utils/merchant-access-policy.js');

const INTERACTION_LABELS = {
  city_story_card: '城市故事卡', hidden_menu: '隐藏菜单', photo_spot: '拍照点', qr_checkin: '到店扫码'
};
const { VALIDATION_METHOD_LABELS: VALIDATION_LABELS } = require('../../../../utils/validation-method-labels.js');

// 据点申请四站,横向步骤条(参考 Revolut 290/293)。前三站是本页能自己判定的,
// 「平台审核」只有提交之后才亮 —— 客户端永远不把它画成已完成。
const CITYNODE_STATIONS = ['配置玩法', '确认店址', '提交申请', '平台审核'];

function stampNow() {
  const d = new Date();
  return '今天 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function requestErrorText(res, fallback) {
  if (typeof app.getRequestErrorMessage === 'function') {
    return app.getRequestErrorMessage(res, fallback);
  }
  return res && typeof res.msg === 'string' && res.msg.trim() ? res.msg.trim() : fallback;
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    accessState: 'loading',
    accessErrorText: '',
    merchantAccess: merchantAccessPolicy.inactiveAccess(),

    // ① 玩法(从 temp 回传)
    tpl: null,          // { id, title, interactionType, validationMethod }
    tplSummary: '',

    // ② 店址:默认取商家档案坐标,商家确认或微调
    shopLoaded: false,
    shopLoadError: '',
    picked: null,       // { lat, lng, name, address }
    pickedFromProfile: false,
    addressConfirmed: false,
    radius: 80,

    submitting: false,
    submittedApplicationId: null,
    submitError: '',
    readbackError: '',
    canSubmit: false,
    dirty: false,
    showLeaveConfirm: false,
    nodeTimeline: [],
  },

  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),

  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。

  showPrivacyGate() {

    this.setData({ privacyGateShow: true });

  },

  onPrivacyGateSettled() {

    this.setData({ privacyGateShow: false });

  },


  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44
    });
    this.refreshNodeTimeline();
    this.loadAccess();
  },

  onShow() {
    merchantTheme.merchantPageShow();
    this.syncLeaveGuard();
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    merchantTheme.merchantPageRestore();
    this.disableLeaveGuard();
  },

  onNavBack() {
    if (this.data.submitting) {
      toast('正在提交，请稍候');
      return;
    }
    if (this.data.dirty) {
      this.setData({ showLeaveConfirm: true });
      return;
    }
    this.performNavBack();
  },

  performNavBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/merchant/citynode/index' });
  },

  confirmLeave() {
    this.data.dirty = false;
    this.setData({ showLeaveConfirm: false });
    this.syncLeaveGuard();
    this.performNavBack();
  },

  cancelLeave() {
    this.setData({ showLeaveConfirm: false });
  },

  setDraftDirty(dirty) {
    const next = !!dirty;
    if (next !== this.data.dirty) this.data.dirty = next;
    this.syncLeaveGuard();
  },

  syncLeaveGuard() {
    if (this.data.dirty) {
      if (!this._leaveGuardEnabled && typeof wx.enableAlertBeforeUnload === 'function') {
        wx.enableAlertBeforeUnload({ message: '玩法或店址还没有提交，确定离开吗？' });
        this._leaveGuardEnabled = true;
      }
      return;
    }
    this.disableLeaveGuard();
  },

  disableLeaveGuard() {
    if (this._leaveGuardEnabled && typeof wx.disableAlertBeforeUnload === 'function') {
      wx.disableAlertBeforeUnload();
    }
    this._leaveGuardEnabled = false;
  },

  loadAccess() {
    const that = this;
    this.setData({
      accessState: 'loading',
      accessErrorText: '',
      merchantAccess: merchantAccessPolicy.inactiveAccess(),
      shopLoaded: false,
      shopLoadError: '',
    });
    app.sendRequest({
      url: '/api/merchant/access/me', method: 'POST', hideLoading: true, silentError: true,
      success(res) {
        if (!(res && (res.code === '200' || res.code === 200))) {
          that.setData({ accessState: 'error', accessErrorText: (res && res.msg) || '商家权限没能读取' });
          return;
        }
        const access = merchantAccessPolicy.normalizeMerchantAccess(res.data);
        if (!access.active || !access.canManageProjects) {
          that.setData({ accessState: 'no-permission', merchantAccess: access });
          return;
        }
        that.setData({ accessState: 'ready', merchantAccess: access });
        that.loadShop();
      },
      fail() { that.setData({ accessState: 'error', accessErrorText: '网络异常，商家权限没能读取' }); },
      successStatusAbnormal() { that.setData({ accessState: 'error', accessErrorText: '商家权限没能读取' }); },
    });
  },

  retryAccess() { this.loadAccess(); },

  /**
   * 店址默认用商家档案里的坐标。★ 但一定要让商家确认一次:
   * 档案坐标多半是入驻时按地址反查的(mms_merchant 自己还带 location_verified),
   * 而据点是玩家按 GPS 走到店门口才算到达(默认半径 80m)。偏一两百米就是
   * 「玩家永远打不了卡、还零报错」—— 静默失败,商家也不知道为什么没人核销。
   */
  loadShop() {
    if (!this.data.merchantAccess.canManageProjects) return;
    const that = this;
    this.setData({ shopLoaded: false, shopLoadError: '' });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/merchant/info', method: 'POST',
      success(res) {
        if (res.code != '200' || !res.data) {
          that.setData({ shopLoaded: true, shopLoadError: requestErrorText(res, '店铺资料没读出来') });
          return;
        }
        const m = res.data;
        const lat = Number(m.locationLat);
        const lng = Number(m.locationLng);
        const hasCoord = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
        that.setData({
          shopLoaded: true,
          picked: hasCoord ? { lat: lat, lng: lng, name: m.name || '', address: m.address || '' } : null,
          pickedFromProfile: hasCoord,
          addressConfirmed: false,
        });
        that.refreshSubmitState();
      },
      fail() {
        that.setData({ shopLoaded: true, shopLoadError: '网络异常,店铺资料没读出来' });
      },
    });
  },

  /** 去配玩法:temp 页保存后用 eventChannel 把 templateId 回传过来 */
  goConfigTemplate() {
    if (!this.data.merchantAccess.canManageProjects) {
      return toast('当前岗位没有据点管理权限');
    }
    const that = this;
    wx.navigateTo({
      url: '/pages/publish/temp/index?from=citynode&scope=MERCHANT',
      events: {
        templateCreated(tpl) {
          if (!tpl || !tpl.id) return;
          if (isAlbumTemplate(tpl)) { toast(ALBUM_ONLY_IN_STORY); return; }
          that.setData({
            tpl: tpl,
            tplSummary: [INTERACTION_LABELS[tpl.interactionType], VALIDATION_LABELS[tpl.validationMethod]]
              .filter(Boolean).join(' · '),
          });
          that.stampStep(0);
          that.refreshSubmitState();
          that.setDraftDirty(true);
        },
      },
    });
  },

  /** 挪一下:打开地图重选,选完就不再是「档案坐标」了 */
  repick() {
    if (!this.data.merchantAccess.canManageProjects) {
      return toast('当前岗位没有据点管理权限');
    }
    const that = this;
    wx.chooseLocation({
      success(r) {
        that.setData({
          picked: { lat: r.latitude, lng: r.longitude, name: r.name, address: r.address },
          pickedFromProfile: false,
          addressConfirmed: true,
        });
        that.stampStep(1);
        that.refreshSubmitState();
        that.setDraftDirty(true);
      },
      fail(err) {
        const message = String((err && err.errMsg) || '');
        if (/cancel/i.test(message)) return;
        const denied = /auth deny|authorize|permission/i.test(message);
        modal.show({
          title: '无法选择位置',
          content: denied ? '请开启定位权限后重试；也可以先继续配置玩法。' : '地图暂时无法打开，已填内容会保留，可以稍后重试。',
          confirmText: denied ? '去设置' : '知道了',
          cancelText: '稍后再试',
          showCancel: denied,
          success(result) { if (denied && result.confirm) wx.openSetting(); }
        });
      }
    });
  },

  confirmProfileAddress() {
    if (!this.data.picked) return;
    this.setData({ addressConfirmed: true });
    this.stampStep(1);
    this.refreshSubmitState();
    this.setDraftDirty(true);
  },

  refreshSubmitState() {
    const canSubmit = !!(this.data.tpl && this.data.tpl.id && this.data.picked && this.data.addressConfirmed);
    if (canSubmit !== this.data.canSubmit) this.setData({ canSubmit: canSubmit });
    this.refreshNodeTimeline();
  },

  /** 完成时刻打在 this 上而不是 data:它只喂时间线,进 data 会被 U4 门禁当成没人消费的字段。 */
  stampStep(index) {
    if (!this._stepTimes) this._stepTimes = {};
    if (!this._stepTimes[index]) this._stepTimes[index] = stampNow();
  },

  refreshNodeTimeline() {
    const times = this._stepTimes || {};
    const flags = [
      !!(this.data.tpl && this.data.tpl.id),
      !!this.data.addressConfirmed,
      !!this.data.submittedApplicationId,
    ];
    // 第一个没做完的就是「现在这一站」;三步都做完了就停在等平台审核。
    let cursor = flags.indexOf(false);
    if (cursor < 0) cursor = 3;
    // ★ 每一站看自己的完成标记,不看 cursor 位置:本页的玩法与店址是两张独立的卡,
    //   商家完全可以先确认店址再去配玩法。按「index < cursor 才算完成」画的话,
    //   已经确认过的店址会被画成「未开始」,却又挂着一个完成时刻 —— 自相矛盾。
    const nodes = CITYNODE_STATIONS.map(function (title, index) {
      return {
        title: title,
        time: times[index] || '',
        status: flags[index] ? 'done' : (index === cursor ? 'doing' : 'todo'),
      };
    });
    this.setData({ nodeTimeline: nodes });
  },

  // 提交据点投放申请;审核通过前绝不在客户端伪造成已上线节点。
  submitNode() {
    if (!this.data.merchantAccess.canManageProjects) {
      return toast('当前岗位没有据点管理权限');
    }
    if (this.data.submitting) return;
    if (this.data.submittedApplicationId) return this.readBackAndReturn(this.data.submittedApplicationId);
    if (!this.data.tpl || !this.data.tpl.id) return toast('请先配置店铺玩法');
    if (!this.data.picked) return toast('请确认店址');
    if (!this.data.addressConfirmed) return toast('请先确认店址是否准确');
    const p = this.data.picked;
    const that = this;
    let accepted = false;
    this.setData({ submitting: true, submitError: '', readbackError: '' });
    app.sendRequest({
      url: '/api/merchant/city-node/save', method: 'POST', hideLoading: true, silentError: true,
      data: { templateId: this.data.tpl.id, lat: p.lat, lng: p.lng, radius: this.data.radius, name: p.name, address: p.address },
      success(res) {
        if (res && (res.code === '200' || res.code === 200)) {
          accepted = true;
          const applicationId = res.data && res.data.id ? res.data.id : res.data;
          that.setData({ submittedApplicationId: applicationId, submitError: '', readbackError: '' });
          that.stampStep(2);
          that.refreshNodeTimeline();
          that.setDraftDirty(false);
          toast.success('投放申请已提交');
          that.readBackAndReturn(applicationId);
        } else {
          that.setSubmitError(requestErrorText(res, '投放申请提交失败'));
        }
      },
      fail() { that.setSubmitError('网络异常，检查网络后重试'); },
      successStatusAbnormal(res) { that.setSubmitError(requestErrorText(res, '投放申请提交失败')); },
      complete() { if (!accepted) that.setData({ submitting: false }); }
    });
  },

  setSubmitError(message) {
    this.setData({ submitError: message || '投放申请提交失败' });
  },

  retrySubmit() {
    this.submitNode();
  },

  readBackAndReturn(applicationId) {
    if (!this.data.merchantAccess.canManageProjects) return;
    const that = this;
    this.setData({ submitting: true, readbackError: '' });
    app.sendRequest({
      url: '/api/merchant/city-node/list', method: 'POST', hideLoading: true, silentError: true,
      success(res) {
        const applications = res && (res.code === '200' || res.code === 200) && res.data && Array.isArray(res.data.applications)
          ? res.data.applications
          : [];
        const found = applications.some(function (item) { return String(item.id) === String(applicationId); });
        if (found) {
          that.setData({ submitting: false, readbackError: '' });
          that.onNavBack();
          return;
        }
        that.setData({ readbackError: '申请已提交，审核状态暂未同步' });
      },
      fail() {
        that.setData({ readbackError: '申请已提交，但审核状态读取失败' });
      },
      successStatusAbnormal() { that.setData({ readbackError: '申请已提交，但审核状态读取失败' }); },
      complete() { that.setData({ submitting: false }); }
    });
  },

  retryReadback() {
    if (this.data.submitting || !this.data.submittedApplicationId) return;
    this.readBackAndReturn(this.data.submittedApplicationId);
  }
});
