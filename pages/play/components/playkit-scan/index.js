// cy-playkit-scan · 扫码参与(原型真源:模板编辑页 v2 · 编辑页 PV.scan)
//
// 最轻的一种:扫码即完成,不出题、不判定。
// 因此这一屏刻意**没有**三样东西,都不是漏做:
//   · 没有限时、没有次数 —— 扫完就结束了,没有可限的东西;
//   · 没有判定屏 —— 没有对错;
//   · 没有「收下」按钮 —— 摆一个等于在问「你要不要收」,而这本来就不是能拒绝的东西,
//     多这一下反而让人以为不点就没算完。
//
// 三种回复形态都遵守同一条:商家没填就不出。玩家看到的应该只有商家写的东西,
// 商家没写就是没有,不需要一句话替他解释为什么没有。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
const cyToast = require('../../../../utils/toast.js');
const { shouldUseAr, arSupported, pillOf } = require('./ar-gate.js');

const TITLE = '扫一下门口的码';
// AR 迟迟放不下 / 认不出:15 秒后自动回落屏幕叠加 —— 服务端早已算过这一站,画面不能一直卡在「找地面」
const AR_GIVE_UP_MS = 15000;

/** 商家选的回复形态。认不出就当文字 —— 它是最保守的那种,不会凭空要权限。 */
function normalizeKind(raw) {
  const s = String(raw || '').trim();
  return (s === '语音' || s === '图片' || s === '显形') ? s : '文字';
}

/** 页内扫码取景要 camera 的 scanCode 模式(基础库 2.1.0+)。
 *  不支持不是错误,是设备现状 —— 走旁路那条路,玩法照常能完成。 */
function cameraScanCodeSupported() {
  try {
    return !!(wx.canIUse && wx.canIUse('camera.mode.scanCode'));
  } catch (e) {
    return false;
  }
}

/** 叠加图占比夹回 20–100:服务端发布期已经拒过越界值,这里是展示侧的第二道。 */
function clampScale(raw) {
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) return 60;
  return Math.max(20, Math.min(100, n));
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    // ⚠️ 默认值只在**没传**这个属性时生效。分发器一律传 kit.title,商家没填就是 ''
    // —— 那会把这一行顶掉,而不是回落到默认。所以回落放在 titleText 上。
    title: { type: String, value: '' },
    kind: { type: String, value: '文字' },
    reply: { type: String, value: '' },
    audioUrl: { type: String, value: '' },
    imageUrl: { type: String, value: '' },
    // OVERLAY 那档:扫中后叠在取景画面里的图。与 imageUrl 同一条口径 —— 扫完才有
    overlayUrl: { type: String, value: '' },
    overlayScale: { type: Number, value: 60 },
    // 显形档的真 AR:NONE / PLANE / MARKER,与识别图一起扫完才给(扫前保密)
    arMode: { type: String, value: 'NONE' },
    markerUrl: { type: String, value: '' },
    modelUrl: { type: String, value: '' },   // 3D 模型:有就放模型,没有就把显形图做成立牌
  },
  data: {
    // 同上:写回被监听的 kind 会自触发死循环
    kindKey: '文字',
    titleText: TITLE,
    playing: false,
    /* 语音条那七根竖线的高度,逐值照原型 .pv-wave i:nth-child(n)。
       ⚠️ 组件 wxss 里 :nth-child 不生效(静默失效,不报错),所以高度走 data。 */
    wave: [16, 30, 42, 24, 36, 18, 26],
    seconds: 12,
    // 显形档:页内取景是否可用。wxml 只画 camLive 这一个事实;
    // 「相机错过一次」是纯内部状态,走实例字段 —— setData 里养一个 wxml 不读的字段,
    // 就是死数据字段门禁(U4)点名的写法。
    camLive: false,
    overlayW: '60%',
    // 显形的那一下:先以透明、略小的样子挂上,下一拍再切到位,transition 才有起点。
    // 减弱动态效果时直接给终态(见 _revealOverlay)。
    overIn: false,
    // 真 AR 是否接管画面。接管时 <camera> 必须先退场(一页只能一个相机,VisionKit 也要用它)
    arLive: false,
    // 底部说明条的字;放下/认到之后给空串,话交给气泡
    arPill: '',
    arDone: false,
    // xr-frame 画布:显示尺寸(px)与渲染尺寸(乘像素比)
    arW: 0, arH: 0, arRW: 0, arRH: 0,
  },
  observers: {
    'show, kind, title': function (show, kind) {
      if (!show) {
        this._lastCode = '';
        // 收起再打开要重新浮一次,不能停在上一回的终态
        clearTimeout(this._overTimer);
        if (this.data.overIn) this.setData({ overIn: false });
        return;
      }
      const kindKey = normalizeKind(kind);
      this.setData({
        playing: false,
        kindKey: kindKey,
        titleText: String(this.data.title || '').trim() || TITLE,
        camLive: kindKey === '显形' && !this._camErr && cameraScanCodeSupported(),
        overlayW: clampScale(this.properties.overlayScale) + '%',
      });
    },
    /* 扫中后服务端才给 overlayUrl(扫前保密),它从空变有值的那一刻就是「显形」 */
    'overlayUrl': function (url) {
      if (url) this._revealOverlay();
      this._refreshAr();
    },
    'arMode': function () { this._refreshAr(); },
  },
  lifetimes: {
    detached() { clearTimeout(this._overTimer); clearTimeout(this._arTimer); },
  },
  methods: {
    _normalizeKind: normalizeKind,      // 纯算法出口,供单测

    /**
     * 点取景框 = 打开微信的扫一扫。
     *
     * ★ 不能「进来就算扫过」:进店这件事只认扫码,GPS 可以伪造,
     * 客户端说扫了也不算数 —— 码要交给服务端比对。
     * 取消扫码不报错:那是玩家改主意,不是出事。
     */
    onScan() {
      if (this.data.reply || this.data.imageUrl || this.data.audioUrl || this.data.overlayUrl) return;   // 已经扫过了
      wx.scanCode({
        onlyFromCamera: false,
        success: (res) => {
          const code = String((res && res.result) || '').trim();
          if (!code) { cyToast('没读到码'); return; }
          motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
          this.triggerEvent('scanned', { code: code });
        },
        fail: () => {},
      });
    },

    /** 显形档的页内取景:camera 逐帧回调同一个码,所以同一串码只交一次。
     *  交出去 6 秒还没等到服务端把图发回来(码不对/网络红),允许重扫 ——
     *  旁路那条 wx.scanCode 本来也是一次一个,行为对齐。 */
    onScanCode(e) {
      if (this.data.reply || this.data.imageUrl || this.data.audioUrl || this.data.overlayUrl) return;
      const code = String((e && e.detail && e.detail.result) || '').trim();
      if (!code || code === this._lastCode) return;
      this._lastCode = code;
      setTimeout(() => {
        if (!this.data.overlayUrl && this.data.reply === '' && this._lastCode === code) this._lastCode = '';
      }, 6000);
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      this.triggerEvent('scanned', { code: code });
    },

    /** 相机起不来(权限被拒/设备不支持):这一屏换成「去设置 + 用微信扫一扫」。
     *  ⚠️ 绝不锁死玩家 —— 旁路走的就是另外三档已经跑在生产的那条 wx.scanCode。 */
    /**
     * 显形:overlayUrl 第一次有值时调一次。先挂透明态,下一拍切到位 —— 同一拍里挂上并切到位,
     * transition 没有起点,等于没动。减弱动态效果时直接给终态,不走这一拍。
     */
    _revealOverlay() {
      if (this.data.overIn) return;
      if (this.data.reducedMotion) { this.setData({ overIn: true }); return; }
      clearTimeout(this._overTimer);
      this._overTimer = setTimeout(() => this.setData({ overIn: true }), 40);
    },

    /**
     * 该不该让真 AR 接管。五件事都成立才切(见 ar-gate.shouldUseAr);失败过一次就不再撞 ——
     * 「失败过」是内部状态,走实例字段。
     */
    _refreshAr() {
      // 直接递 this.data,不在这里写 overlayUrl / arMode 字面键:自触发 observer 门禁按字面键判「写了被监听的键」
      const live = shouldUseAr(Object.assign({}, this.data, { supported: arSupported(), arFail: this._arFail }));
      if (live === this.data.arLive) return;
      if (!live) { this._stopArTimer(); this.setData({ arLive: false }); return; }
      const win = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
      const dpr = win.pixelRatio || 2;
      this.setData({
        arLive: true, arDone: false, arPill: pillOf(this.data.arMode, 'finding'),
        arW: win.windowWidth, arH: win.windowHeight,
        arRW: Math.round(win.windowWidth * dpr), arRH: Math.round(win.windowHeight * dpr),
      });
      this._stopArTimer();
      this._arTimer = setTimeout(() => this.onArGiveUp(), AR_GIVE_UP_MS);
    },
    _stopArTimer() {
      clearTimeout(this._arTimer);
      this._arTimer = null;
    },

    /** AR 起不来(机型不支持 / VisionKit 报错):退场,屏幕叠加接手 —— 这一站照样走得完。 */
    onArError() { this.onArGiveUp(); },
    /** 放弃 AR:超时或玩家点「看不到?」。和起不来同一个出口,这一回合不再试 AR。 */
    onArGiveUp() {
      this._stopArTimer();
      this._arFail = true;
      this.setData({ arLive: false });
    },
    onArFound(e) {
      if (this.data.arDone) return;   // 放下之后平面追踪丢了也不再冒说明条:画面让给东西
      const found = !!(e && e.detail && e.detail.value);
      this.setData({ arPill: pillOf(this.data.arMode, found ? 'found' : 'finding') });
    },
    onArPlaced() {
      this._stopArTimer();
      this.setData({ arPill: pillOf(this.data.arMode, 'placed'), arDone: true });
    },
    /** 东西落地那一刻轻震一下:放下这个动作有了「着地」的手感(减弱动效下 motion.haptic 自己静音)。 */
    onArLanded() { motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' }); },
    onArTracked(e) {
      const on = !!(e && e.detail && e.detail.value);
      if (on) this._stopArTimer();
      this.setData({ arPill: on ? '' : pillOf(this.data.arMode, 'finding'), arDone: on });
    },

    onCamErr() {
      this._camErr = true;
      this.setData({ camLive: false });
    },
    onOpenCamSetting() {
      wx.openSetting({ fail() {} });
    },
    onPlay() {
      this.setData({ playing: !this.data.playing });
      this.triggerEvent('audio', { playing: this.data.playing });
    },
    onClose() { this.triggerEvent('close'); },
  },
});
