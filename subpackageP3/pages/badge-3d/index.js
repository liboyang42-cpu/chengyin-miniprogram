// 徽章双样式详情页。enamel=3D珐琅转台(xr-badge WebGL);glow=勋章墙同一台波点引擎渲染单枚。
const ENGINE = require('../badge-wall/index/engine.js');
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const DEFAULT_BADGE_ASSET = '/subpackageP3/assets/badge-demo.png';

function decodeQueryValue(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback;
  try { return decodeURIComponent(value); } catch (e) { return fallback; }
}

function resolveBadgeAsset(value) {
  const decoded = decodeQueryValue(value, '');
  if (/^https?:\/\//.test(decoded) || /^\/(images|subpackageP3)\//.test(decoded)) return decoded;
  return DEFAULT_BADGE_ASSET;
}

Page({
  data: {
    actionTop: 54,
    name: '徽章',
    sub: '',
    src: DEFAULT_BADGE_ASSET,
    fallbackSrc: DEFAULT_BADGE_ASSET,
    unsupported: false,
    renderState: 'loading',
    reducedMotion: readReducedMotion(),
    rarity: 0,
    style: 'enamel',   // glow=二维发光大卡 / enamel=3D珐琅转台(发布者选择,双样式统一路由)
  },
  onUnload() {
    if (this._xrTimer) clearTimeout(this._xrTimer);
    if (this._glowTimer) clearTimeout(this._glowTimer);
    if (this._glowEng) {
      if (this._glowEng.stop) this._glowEng.stop();
      if (this._glowEng.destroy) this._glowEng.destroy();
      this._glowEng = null;
    }
  },
  onLoad(q) {
    let actionTop = 54;
    try {
      const r = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
      if (r && r.top) actionTop = r.top;
    } catch (e) {}
    const src = resolveBadgeAsset(q && q.img);
    this._xrOk = false;
    this._xrLoaded = false;
    this.setData({
      actionTop,
      style: (q && q.style) === 'glow' ? 'glow' : 'enamel',
      rarity: Math.min(4, Math.max(0, Number(q && q.rarity) || 0)),   // 波点五色轨:0普通…4神话
      name: decodeQueryValue(q && q.name, '徽章'),
      sub: decodeQueryValue(q && q.sub, ''),
      src,
      fallbackSrc: src,
      unsupported: false,
      renderState: 'loading',
    });
    if (this.data.style === 'glow') this._glowTimer = setTimeout(() => this._initGlow(), 200);
  },
  // 组件 ready 回执。⚠️ 不能叫 onReady:会撞 Page 生命周期钩子(页面渲染完必触发),
  // _xrOk 恒真 ⇒ 3 秒不支持降级永不生效 —— 本次 review 抓出的真 bug
  onXrReady() { this._xrOk = true; },
  onLoaded() {
    this._xrLoaded = true;
    if (this._xrTimer) clearTimeout(this._xrTimer);
    this.setData({ unsupported: false, renderState: 'ready' });
  },
  onUnsupported(event) {
    if (this._xrTimer) clearTimeout(this._xrTimer);
    const reason = event && event.detail && event.detail.reason;
    this.setData({
      unsupported: true,
      renderState: 'fallback',
      fallbackSrc: reason === 'asset' ? DEFAULT_BADGE_ASSET : this.data.src,
    });
  },
  /** glow:复用勋章墙引擎,单枚居中 + 直接进 detail 特写(波点粒子全效果) */
  _initGlow() {
    const that = this;
    wx.createSelectorQuery().in(this).select('#glowcv').fields({ node: true, size: true }).exec((res) => {
      const item = res && res[0];
      if (!item || !item.node) { that.onUnsupported({ detail: { reason: 'renderer' } }); return; }
      let eng = null;
      try {
        const win = (wx.getWindowInfo && wx.getWindowInfo()) || {};
        eng = ENGINE.createEngine({
          canvas: item.node,
          width: item.width, height: item.height,
          pixelRatio: win.pixelRatio || 2,
          createOffscreen: (w, h) => wx.createOffscreenCanvas({ type: '2d', width: w, height: h }),
          onError: () => that.onUnsupported({ detail: { reason: 'renderer' } }),
        });
      } catch (e) { eng = null; }
      if (!eng) { that.onUnsupported({ detail: { reason: 'renderer' } }); return; }
      that._glowEng = eng;
      // 单枚:布局带收窄到屏中,setBadges 后直接 openDetail 进特写
      if (eng.setInsets) eng.setInsets(item.height * 0.30, item.height * 0.34);
      eng.setBadges([{
        name: that.data.name, en: '', iconUrl: /^https?:/.test(that.data.src) ? that.data.src : '',
        glyph: undefined, rarity: that.data.rarity, tierKey: 'T' + that.data.rarity,
        tierZh: ['普通','稀有','史诗','传说','神话'][that.data.rarity] || '徽章',
        locked: false, time: '', source: '', desc: '', cond: '',
      }]);
      if (that.data.reducedMotion && eng.renderStatic) {
        eng.openDetail(0);
        eng.renderStatic();
      } else {
        eng.start();
        setTimeout(() => { try { eng.openDetail(0); } catch (e) {} }, 400);
      }
      that.setData({ unsupported: false, renderState: 'ready' });
    });
  },
  // 3 秒内没等到 xr-scene 的 ready ⇒ 判不支持,退静态图。
  // ⚠️ 不能拿「没报错」当「支持」:DevTools 不支持 xr-frame 时是静默的(实测 0 console error)。
  onShow() {
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
    if (this._glowEng) {
      if (reducedMotion) {
        if (this._glowEng.stop) this._glowEng.stop();
        if (this._glowEng.renderStatic) this._glowEng.renderStatic();
      } else if (this._glowEng.start) {
        this._glowEng.start();
      }
    }
    if (this.data.style !== 'enamel' || this.data.renderState !== 'loading') return;
    if (this._xrTimer) clearTimeout(this._xrTimer);
    this._xrTimer = setTimeout(() => {
      if (!this._xrLoaded && !this.data.unsupported) this.onUnsupported({ detail: { reason: this._xrOk ? 'asset' : 'renderer' } });
    }, 3000);
  },
  onHide() {
    if (this._xrTimer) clearTimeout(this._xrTimer);
    if (this._glowEng && this._glowEng.stop) this._glowEng.stop();
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/roam/index' });
  },
});
