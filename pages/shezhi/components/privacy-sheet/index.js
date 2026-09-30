// cy-privacy-sheet · 隐私与定位设置的半屏弹窗(从设置页发起,不再整页跳走)
//
// ⚠️ 只承接「设置」这一路:说明 + 官方指引入口 + 撤回漫游定位同意。
//    微信隐私授权待决策那一路(原生 <button open-type="agreePrivacyAuthorization">)
//    仍留在 pages/privacy 路由页 —— wx.onNeedPrivacyAuthorization 回调靠 navigateTo
//    压那一页,而且那个原生按钮不能收编成普通 view,搬进弹窗会让授权彻底失效。
//    故 pages/privacy 路由页保留不删。
const toast = require('../../../../utils/toast.js');
const app = getApp();
const {
  normalizeClipPercent,
  readSharePrivacy,
  writeSharePrivacy,
} = require('../../../../utils/roam-route-privacy.js');

Component({
  options: { multipleSlots: true },
  properties: {
    show: { type: Boolean, value: false },
    theme: { type: String, value: 'player' },
  },
  data: {
    submitting: false,
    clipEnabled: true,
    clipPercent: 10,
    saveError: '',
  },
  lifetimes: {
    attached() { this._loadSharePrivacy(); },
  },
  observers: {
    // 每次重新打开都从存储读一次:设置面板不是唯一写入方(分享页也读同一份),
    // 缓存住 attached 那一次的值会在第二次打开时显示旧状态。
    show(next) { if (next) this._loadSharePrivacy(); },
  },
  methods: {
    _loadSharePrivacy() {
      const privacy = readSharePrivacy(wx);
      this.setData({
        clipEnabled: privacy.clipEnabled,
        clipPercent: privacy.clipPercent,
        saveError: '',
      });
    },

    /* 落盘失败必须说出来。静默吞掉 = 用户以为关掉了裁剪/调好了比例,
       下次分享还是按旧值走 —— 位置隐私上这种假保证比没有开关更坏。 */
    _persist(patch) {
      const result = writeSharePrivacy(patch, wx);
      this.setData({
        clipEnabled: result.clipEnabled,
        clipPercent: result.clipPercent,
        saveError: result.ok ? '' : '设置没能保存，请重试；本次分享仍按上一次的设置执行。',
      });
    },

    onClipToggle(e) {
      this._persist({ clipEnabled: !!(e && e.detail && e.detail.value) });
    },

    // 拖动过程只更新显示(说明文案里的百分比要跟着走),松手才落盘
    onClipPercentChanging(e) {
      const value = normalizeClipPercent(e && e.detail && e.detail.value);
      if (value !== this.data.clipPercent) this.setData({ clipPercent: value });
    },

    onClipPercentChange(e) {
      this._persist({ clipPercent: normalizeClipPercent(e && e.detail && e.detail.value) });
    },

    /* ⚠️ 只发事件,**不**自己 setData({show:false}):show 是父级传进来的属性,组件自己改一次,
       父级那份状态并没有跟着变;等父级下次想再打开时 setData(true) 与它自己记着的 true 无差异,
       不会重新下发,弹窗就再也打不开了。开关的所有权留在父级(cy-sheet 本身也是这么做的)。 */
    onClose() {
      // 提交中不让关:撤回请求在途时关掉弹窗,用户看不到成功/失败结果
      if (this.data.submitting) return;
      this.triggerEvent('close');
    },

    openPrivacyContract() {
      wx.openPrivacyContract({
        fail() {
          toast('隐私保护指引暂不可用');
        },
      });
    },

    withdrawRoamLocationConsent() {
      if (this.data.submitting) return;
      this.setData({ submitting: true });
      app.recordConsent({
        docType: 'privacy_policy',
        scene: 'roam_location',
        eventType: 'REVOKE',
      }).then(() => {
        try { wx.stopLocationUpdate(); } catch (e) {}
        toast('已撤回漫游定位同意');
        this.setData({ submitting: false });
      }).catch(() => {
        toast('撤回记录失败，请检查网络后重试');
        this.setData({ submitting: false });
      });
    },
  },
});
