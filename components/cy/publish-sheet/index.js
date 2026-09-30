// 发布菜单：复用已确认的 3D 素材与错峰上浮动效。
const toast = require('../../../utils/toast.js');
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');
const exitMotion = require('../../../behaviors/exit-motion.js');
const { resolveMenuChrome } = require('../../../utils/nav-safe-area.js');

Component({
  // 与 --cy-motion-standard 的退场时长保持一致。
  behaviors: [reducedMotionBehavior, exitMotion(220)],
  options: { styleIsolation: 'apply-shared' },
  properties: {
    show: {
      type: Boolean, value: false,
      observer(v) {
        if (v) this.setData({ level: 'cards', selectedMode: 1 });
      }
    },
    pub: { type: Object, value: null },
    scope: { type: String, value: '' },
    merchant: { type: Boolean, value: false }
  },
  data: {
    level: 'cards', selectedMode: 1, quickOpen: false,
    /* 菜单顶边与右上角 ✕ 的起点:原来整层 inset:0 铺到状态栏,把原页的导航标题和
       消息入口一起压暗(CU-M-157)。和 creation-success 同一份胶囊实测几何:
       contentTop = 胶囊底 + 呼吸,面板从微信导航下方开始。 */
    chrome: { contentTop: 56 }
  },
  lifetimes: {
    attached() {
      let windowInfo = {};
      let menuButtonInfo = null;
      try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) {}
      try { menuButtonInfo = wx.getMenuButtonBoundingClientRect(); } catch (e) {}
      this.setData({ chrome: resolveMenuChrome(windowInfo, menuButtonInfo) });
    }
  },
  observers: {
    '_render, level': function (render, level) {
      this.setData({ quickOpen: false });
      if (!render) return;
      wx.nextTick(() => {
        if (this.data.show && this.data.level === level) this.setData({ quickOpen: true });
      });
    }
  },
  methods: {
    onClose() { this.triggerEvent('close'); },
    onMask() { this.triggerEvent('close'); },
    noop() {},
    backToCards() { this.setData({ level: 'cards' }); },
    chooseTopicMode(e) {
      if (!this.data.pub) return toast('发布信息尚未就绪，请稍后重试');
      const mode = Number(e.currentTarget.dataset.mode) === 2 ? 2 : 1;
      this.setData({
        selectedMode: mode,
        level: 'topicAbility'
      });
    },
    chooseSimple() {
      const perm = (this.data.pub && this.data.pub.permission) || {};
      if (perm.canSimplePublish === false) {
        return toast('当前身份不可发布主题');
      }
      this._closeAndGo('/pages/publish/simple/index?mode=' + this.data.selectedMode + this._scopeSuffix());
    },
    choosePro() {
      const pub = this.data.pub || {};
      const perm = pub.permission || {};
      if (perm.canProPublish === false) {
        return toast('当前身份不可发布主题');
      }
      const q = pub.quota || {};
      if (q.maxThemes != null && q.themesRemaining === 0) {
        toast('在架已满，可先存草稿或下架旧项目');
      }
      this._closeAndGo('/pages/publish/fabu/index?mode=' + this.data.selectedMode + this._scopeSuffix());
    },

    // ===== 卡2 模板:先进第0页(价值主张),再逐步进入命名与编辑器 =====
    // 三步均保留页面栈,编辑器返回时能按原路逐级退出;商家作用域随 query 透传。
    goTemplate() {
      if (!this.data.pub) return toast('发布信息尚未就绪，请稍后重试');
      this._closeAndGo('/pages/publish/template-intro/index'
        + (this.properties.scope === 'MERCHANT' ? '?scope=MERCHANT' : ''));
    },

    _scopeSuffix() {
      return this.properties.scope === 'MERCHANT' ? '&scope=MERCHANT' : '';
    },

    _closeAndGo(url) {
      this.triggerEvent('close');
      wx.navigateTo({
        url,
        fail: () => toast('跳转失败，请重试')
      });
    }
  }
});
