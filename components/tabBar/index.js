// 商家端一级导航(与 C 端两套配置;商家页均非原生 tabBar,统一用 reLaunch 跳转、按 activeKey 高亮)
const toast = require('../../utils/toast.js');
const reducedMotionBehavior = require('../../behaviors/reduced-motion.js');

// 2026-08-20 图标换 SVG 重绘版:旧 icon_f1~f5 PNG 画成超椭圆大圆角(「tab 栏太圆」的根源在图标不在栏)。
// 新图标 24 网格 / rx=2 / 1.8 描边;商家恒 monochrome ⇒ wxml 只取 iconPath,selectedIconPath 同源占位。
const MERCHANT_LIST = [
  { key: "workbench", pagePath: "/pages/merchant/index/index",           text: "工作台", iconPath: "/images/icon_tab_workbench.svg", selectedIconPath: "/images/icon_tab_workbench.svg" },
  { key: "marketing", pagePath: "/pages/merchant/marketing/index",       text: "营销",   iconPath: "/images/icon_tab_marketing.svg", selectedIconPath: "/images/icon_tab_marketing.svg" },
  { key: "template",  pagePath: "/pages/template/index?mode=merchant",   text: "模板",   iconPath: "/images/icon_tab_template.svg", selectedIconPath: "/images/icon_tab_template.svg" },
  { key: "relation",  pagePath: "/pages/merchant/relation/index",        text: "合作",   iconPath: "/images/icon_tab_relation.svg", selectedIconPath: "/images/icon_tab_relation.svg" },
  { key: "mine",      pagePath: "/pages/member/index/index?mode=merchant", text: "我的",  iconPath: "/images/icon_tab_mine.svg", selectedIconPath: "/images/icon_tab_mine.svg" }
];

// C 端(玩家)一级导航
const CONSUMER_LIST = [
  { pagePath: "/pages/index/index",        text: "首页",   iconPath: "/images/icon_f1.png", selectedIconPath: "/images/icon_f01d.png" },
  { pagePath: "/pages/roam/index",         text: "漫游",   iconPath: "/images/icon_roam.png", selectedIconPath: "/images/icon_roam_d.png" },
  { pagePath: "/pages/template/index",     text: "发布",   iconPath: "/images/icon_f3.png", selectedIconPath: "/images/icon_f03d.png" },
  { pagePath: "/pages/talent/list/index",  text: "俱乐部", iconPath: "/images/icon_f4.png", selectedIconPath: "/images/icon_f04d.png" },
  { pagePath: "/pages/member/index/index", text: "我的",   iconPath: "/images/icon_f5.png", selectedIconPath: "/images/icon_f05d.png" }
];

// 悬浮发布钮唯一落位页(2026-09-19 口径:只在模板页出,不再 C 端全局挂)
const PUBLISH_PAGE = '/pages/template/index';

Component({
  behaviors: [reducedMotionBehavior],
  // raised: 是否升起显示(默认 true 不影响其它页;首页传 false→首屏隐藏,滚动再升起)
  properties: {
    raised: { type: Boolean, value: true },
    dark: { type: Boolean, value: false },   // 首页传 true → 深色磨砂导航;其他页默认白色
    immersive: { type: Boolean, value: false }, // 漫游地图专用轻量底栏；默认关闭，避免波及其他宿主页
    // 2026-08-01 合并批3+批7 两条同向修复:
    //  · 批3:默认值 false→true —— 选中态原本默认拿紫色 selectedIconPath(icon_f0*d.png 实测
    //    平均 RGB≈(122,92,255)),不传就有紫,与「紫只做强调,要紫必须显式传」相反;
    //    翻默认值才能覆盖 template/talent-list 这类"从来没传过 monochrome"的玩家页。
    //  · 批7:WXML 里 mode==='merchant' 时强制叠加黑白 —— 即便将来有调用方显式传 false,
    //    商家 tab 也不会退回紫色。
    // 两条是"默认值"与"兜底闸"的关系,不互斥,都保留。
    monochrome: { type: Boolean, value: true },
    activePath: { type: String, value: '' }, // 非 tabBar 业务页可指定归属 tab,如商家首页归到“我的”
    mode: { type: String, value: 'consumer' }, // consumer(默认,C 端不变) | merchant(商家五 tab)
    activeKey: { type: String, value: '' },  // merchant 态用 key 高亮(商家页路径带 query,无法按 pagePath 匹配)
  },

  data: {
    active: 0,
    list: CONSUMER_LIST,
    showPublish: false,   // 派生自「当前页是不是模板页」,默认压住,由 applyMode/updateActive 点亮
    publishSheetShow: false,
    publishSnapshot: null
  },

  lifetimes: {
    detached() { this._publishRequest = (this._publishRequest || 0) + 1; },
    attached() {
      this.applyMode();
      this.updateActive();
    }
  },

  pageLifetimes: {
    hide() { this.closePublishSheet(); },
    show() {
      this.updateActive();
    }
  },

  observers: {
    activePath() {
      this.updateActive();
    },
    mode() {
      this.applyMode();
      this.updateActive();
    }
  },

  methods: {
    openPublishSheet() {
      const request = (this._publishRequest || 0) + 1;
      this._publishRequest = request;
      this.setData({ publishSheetShow: true, publishSnapshot: null });
      getApp().sendRequest({
        hideLoading: true,
        url: '/api/publish/home',
        method: 'POST',
        data: {},
        success: (res) => {
          if (request !== this._publishRequest) return;
          if (res.code == '200' && res.data) {
            this.setData({ publishSnapshot: res.data });
          } else {
            toast('发布信息加载失败，请关闭后重试');
          }
        },
        fail: () => {
          if (request === this._publishRequest) toast('发布信息加载失败，请关闭后重试');
        }
      });
    },
    closePublishSheet() {
      this._publishRequest = (this._publishRequest || 0) + 1;
      this.setData({ publishSheetShow: false });
    },

    // 按 mode 切换商家/ C 端两套 tab(双向,避免 merchant→consumer 残留)
    // 发布悬浮菜单的显示闸(2026-09-19 用户改口径):C 端也只在模板页出这枚,首页/漫游/俱乐部/
    //   我的不再全局挂;商家恒不出,其发布入口仍是 pages/template 那枚页面级 fab(带岗位闸)。
    //   谓词收在 JS 而不是写进 WXML —— play-visual-consolidation 对 tabBar WXML 有一条
    //   「商家例外闸不得复活」的文本反向守卫(守的是黑白方向),WXML 里复用同串字面量会被它误伤。
    applyMode() {
      const isMerchant = this.data.mode === 'merchant';
      const list = isMerchant ? MERCHANT_LIST : CONSUMER_LIST;
      const showPublish = !isMerchant && this.__onPublishPage();
      if (this.data.list !== list || this.data.showPublish !== showPublish) {
        this.setData({ list, showPublish });
      }
    },

    // 悬浮发布钮唯一落位页;activePath 显式传入时以它为准(非 tab 业务页归位用)
    __onPublishPage() {
      if (this.data.activePath) {
        return this.data.activePath.split('?')[0] === PUBLISH_PAGE;
      }
      const pages = getCurrentPages();
      if (!pages.length) return false;
      return '/' + pages[pages.length - 1].route === PUBLISH_PAGE;
    },

    onChange(event) {
      const {
        index
      } = event.currentTarget.dataset;
      const url = this.data.list[index].pagePath;

      // 商家页均非原生 tabBar 且路径带 query,须用 reLaunch;C 端保持 switchTab
      if (this.data.mode === 'merchant') {
        wx.reLaunch({
          url: url,
          fail: (err) => {
            console.error('切换商家tab失败');
          }
        });
        return;
      }

      wx.switchTab({
        url: url,
        fail: (err) => {
          console.error('切换tab失败');
        }
      });
    },

    updateActive() {
      // show()/切页都会打到这里:发布钮显隐按「当前页是否模板页」重判(商家恒 false)
      const publishVisible = this.data.mode !== 'merchant' && this.__onPublishPage();
      if (this.data.showPublish !== publishVisible) {
        this.setData({ showPublish: publishVisible });
      }

      // merchant 态优先按 activeKey 高亮(路径带 query 无法按 pagePath 匹配)
      if (this.data.mode === 'merchant' && this.data.activeKey) {
        const activeByKey = this.data.list.findIndex(item => item.key === this.data.activeKey);
        if (activeByKey !== -1 && activeByKey !== this.data.active) {
          this.setData({ active: activeByKey });
        }
        return;
      }

      const pages = getCurrentPages();
      if (!pages.length) return;

      const currentPage = pages[pages.length - 1];
      const route = this.data.activePath || ('/' + currentPage.route);

      const active = this.data.list.findIndex(item =>
        item.pagePath === route
      );

      if (active !== -1 && active !== this.data.active) {
        this.setData({
          active
        });
      }
    }
  }
})
