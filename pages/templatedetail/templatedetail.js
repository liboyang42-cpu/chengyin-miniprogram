const { applyHeroRecede } = require('./utils/scroll-motion.js');
const app = getApp();
const mockData = require('../../utils/mockData.js');
const analytics = require('../../utils/analytics.js');
const templateDetailUtil = require('./utils/templateDetail.js');
const policy = require('../../utils/identity/identity-policy.js');
const merchantTheme = require('../../utils/merchant-theme.js');
const { isRecord } = require('../../utils/response-shape.js');
const toast = require('../../utils/toast.js');

function difficultyMeta(difficulty) {
  var d = String(difficulty || '').trim();
  if (d === '低') return { letter: '简', label: '简易难度' };
  if (d === '高') return { letter: '难', label: '困难难度' };
  if (d === '中') return { letter: '中', label: '中等难度' };
  if (d) return { letter: d.charAt(0), label: d + '难度' };
  return { letter: '—', label: '难度待定' };
}

// 能力 tab 的标签行。三组键值卡压成三行「标签 + chips」——
// 类别与场所本来就是多值(顿号/中点分隔的串),拆成 chip 比挤在一行右对齐好读。
// 分隔符与 utils/templateDetail.js 的 joinCategories 保持一致(中点),再兼容中英文顿号逗号。
function splitValues(text) {
  return String(text || '').split(/[·、,，;；\/]/).map(function (x) { return x.trim(); }).filter(Boolean);
}

// 一行放得下约 3 枚;超过才收起并给展开,不给恒显的假入口
var CAP_INLINE_MAX = 3;

function normalizeChips(list) {
  return list.map(function (item) {
    return typeof item === 'string' ? { text: item, action: '' } : item;
  });
}

function capRow(key, label, values) {
  var chips = normalizeChips(values);
  return { key: key, label: label, chips: chips, collapsible: chips.length > CAP_INLINE_MAX };
}

function compact(list) {
  return list.filter(function (item) {
    return item && item.value !== '' && item.value !== null && item.value !== undefined;
  });
}

function textValue(value) {
  if (value === 0) return '0';
  return String(value || '').trim();
}

function minutesText(value) {
  if (value === 0) return '0 分钟';
  var text = textValue(value);
  if (!text) return '';
  return /分钟|小时|min|h/i.test(text) ? text : text + ' 分钟';
}

function isTopicTemplate(info) {
  info = info || {};
  return Number(info.productType) === 2
    || textValue(info.chapterCount)
    || textValue(info.gameCount)
    || textValue(info.locationCount)
    || textValue(info.nodeCount);
}

function buildDetailStats(info) {
  info = info || {};
  if (isTopicTemplate(info)) {
    return compact([
      { value: textValue(info.chapterCount), label: '章节' },
      { value: textValue(info.locationCount || info.nodeCount || info.gameCount), label: '节点' },
      { value: minutesText(info.totalTime || info.duration), label: '总时长' }
    ]);
  }
  return compact([
    { value: textValue(info.useNum), label: '采用次数' },
    { value: textValue(info.rating), label: '评分' },
    { value: minutesText(info.duration), label: '预计时长' }
  ]);
}

function categoryChips(info, categoryText) {
  return Array.isArray(info.sysCategoryList)
    ? info.sysCategoryList.map(item => item && item.categoryName).filter(Boolean)
    : (categoryText ? [categoryText] : []);
}

function buildDetailDisplay(info, categoryText) {
  info = info || {};
  var materialChips = splitValues(info.requiredMaterials);
  var sceneChips = categoryChips(info, categoryText).concat(splitValues(info.usageLocation));
  return {
    isTopicTemplate: !!isTopicTemplate(info),
    detailStats: buildDetailStats(info),
    materialChips: materialChips,
    sceneChips: sceneChips
  };
}

// R9-05:发布者显示的唯一派生口。缺作者字段不得回退成「城瘾/官方」——
// scope=my 是本人作品,没名字就用本人昵称;公共库有作者但没名字时用中性「创作者」;
// 只有平台内容(没有 memberId 也没有 publisher)才保留「城瘾 + 官方」。
function resolvePublisherDisplay(info, scope) {
  var source = info || {};
  var name = source.publisher ? String(source.publisher).trim() : '';
  var hasAuthor = Number(source.memberId) > 0;
  if (name) return { text: name, official: scope !== 'my' && !hasAuthor };
  if (scope === 'my') {
    var nickname = '';
    try {
      var global = getApp().globalData || {};
      nickname = String(global.nickname || '').trim();
    } catch (e) { /* 取不到昵称时留空 */ }
    return { text: nickname || '我的作品', official: false };
  }
  if (hasAuthor) return { text: '创作者', official: false };
  return { text: '城瘾', official: true };
}

function buildCapRows(info, categoryText) {
  var rows = [];
  var way = splitValues(info.validationMethodStr);
  if (info.validationMethod) way.push({ text: '节点预览', action: 'preview' });
  if (way.length) rows.push(capRow('way', '方式', way));

  var scene = categoryChips(info, categoryText).concat(splitValues(info.usageLocation));
  if (scene.length) rows.push(capRow('scene', '场景', scene));

  if (info.publisher) rows.push(capRow('from', '来源', [info.publisher]));
  return rows;
}

var TAB_DETAILS = { key: 'details', label: '详情' };
var TAB_CAPABILITIES = { key: 'capabilities', label: '能力' };

// CU-M-130:能力 tab 里只有「方式」是这一栏独有的信息 —— 场景在详情栏已经铺成 chips,
// 来源就是头部的发布者署名。三者只剩署名时,点「能力」看到的是一句和主按钮重复的说明,
// 标签与内容对不上,这时候不把「能力」这个 tab 给出去。
function hasCapabilityInfo(capRows) {
  return (capRows || []).some(function (row) { return row && row.key === 'way'; });
}

function buildTplTabs(capable) {
  return capable ? [TAB_DETAILS, TAB_CAPABILITIES] : [TAB_DETAILS];
}

Page({
  data: {
    id: 0,
    scope: 'library',
    info: {},
    gallery: [],
    coverUrl: '',
    capRows: [],
    detailStats: [],
    materialChips: [],
    sceneChips: [],
    publisherText: '城瘾',
    isOfficialPublisher: false,
    capExpanded: {},
    difficultyLetter: '—',
    difficultyLabel: '难度待定',
    isTopicTemplate: false,
    loading: true,
    loadError: false,
    loadErrorMsg: '',
    activeTab: 'details',
    descExpanded: false,
    descNeedMore: false,
    ruleExpanded: false,
    ruleNeedMore: false,
    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
    popDavid: false,
    canSubmitPreview: false,
    selectedOption: '',
    selectedOptionKey: '',
    inputAnswer: '',
    moreShow: false,
    isMyScope: false,
    isMerchant: false,
    // 2026-08-05 用户定:两页两态文案统一为「开始应用」。原来 scope=my 下叫「编辑玩法」,
    // 但两个 scope 的 goPrimary 跳的是同一个 /pages/publish/temp —— 那里做的是基于模板起草,
    // 不是就地编辑,「编辑玩法」这个叫法本身就与行为对不上。
    primaryLabel: '开始应用',
    tplTabs: [TAB_DETAILS, TAB_CAPABILITIES]
  },

  isDevEnv() {
    try {
      return wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
    } catch (e) {
      return false;
    }
  },

  onLoad(options) {
    var scope = options.scope === 'my' ? 'my' : 'library';
    var data = {
      id: options.id || 0,
      scope: scope,
      isMyScope: scope === 'my'
    };
    if (options.tab === 'capabilities') {
      data.activeTab = 'capabilities';
    }
    if (this.isDevEnv() && options.id) {
      var mock = mockData.getTemplateById(options.id);
      if (mock) {
        this.patchNormalized(data, mock);
      }
    }
    this.setData(data);
    this.getData();
  },

  // 身份可能在本页停留期间变(切换身份后返回),按 onShow 重判,与 pages/template/index 同口径
  /* 滚动驱动:背景 Hero 随滚动隐退而不是硬切走(HIG《Motion》的元素连续性)。
   * 用 this.animate 的 scrollSource —— 补间在视图层完成,不像 onPageScroll+setData 那样逐帧跨线程。
   * 放 onReady 而非 onLoad:必须等节点渲染出来,选择器才找得到。
   * 减动效偏好下 applyHeroRecede 返回 false,整个跳过(大动效退化为不做,不是做快一点)。 */
  onReady() {
    this._heroRecedeApplied = applyHeroRecede(this, '.xb-bg-img', {
      scrollSource: '#xbScroll',
      // 240px ≈ 头图高度:滚过头图这段距离,背景刚好退到位
      endOffset: 240,
    });
  },

  onShow() {
    var isMerchant = policy.isMerchantView({ role: app.getUserRole(), userType: app.getUserType() });
    this.setData({ isMerchant: isMerchant });
    if (isMerchant) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
  },

  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  patchNormalized(target, raw) {
    var normalized = templateDetailUtil.normalizeTemplateDetail(raw);
    var meta = difficultyMeta(normalized.info.difficulty);
    var detail = buildDetailDisplay(normalized.info, normalized.categoryText);
    var publisher = resolvePublisherDisplay(normalized.info, target.scope || this.data.scope);
    target.info = normalized.info;
    target.gallery = normalized.gallery;
    target.coverUrl = normalized.coverUrl;
    target.publisherText = publisher.text;
    target.isOfficialPublisher = publisher.official;
    target.capRows = buildCapRows(normalized.info, normalized.categoryText);
    target.tplTabs = buildTplTabs(hasCapabilityInfo(target.capRows));
    if (!hasCapabilityInfo(target.capRows)) target.activeTab = 'details';
    target.detailStats = detail.detailStats;
    target.materialChips = detail.materialChips;
    target.sceneChips = detail.sceneChips;
    target.isTopicTemplate = detail.isTopicTemplate;
    target.difficultyLetter = meta.letter;
    target.difficultyLabel = meta.label;
  },

  applyDetailPayload(raw) {
    var normalized = templateDetailUtil.normalizeTemplateDetail(raw || {});
    var meta = difficultyMeta(normalized.info.difficulty);
    var detail = buildDetailDisplay(normalized.info, normalized.categoryText);
    var publisher = resolvePublisherDisplay(normalized.info, this.data.scope);
    var capRows = buildCapRows(normalized.info, normalized.categoryText);
    var capable = hasCapabilityInfo(capRows);
    this.setData({
      info: normalized.info,
      gallery: normalized.gallery,
      coverUrl: normalized.coverUrl,
      publisherText: publisher.text,
      isOfficialPublisher: publisher.official,
      capRows: capRows,
      tplTabs: buildTplTabs(capable),
      activeTab: capable ? this.data.activeTab : 'details',
      detailStats: detail.detailStats,
      materialChips: detail.materialChips,
      sceneChips: detail.sceneChips,
      isTopicTemplate: detail.isTopicTemplate,
      capExpanded: {},
      difficultyLetter: meta.letter,
      difficultyLabel: meta.label,
      descExpanded: false,
      ruleExpanded: false
    }, this.checkTextOverflow);
  },

  checkTextOverflow() {
    var that = this;
    wx.nextTick(function () {
      var query = wx.createSelectorQuery().in(that);
      query.select('#tpl-desc').boundingClientRect();
      query.select('#tpl-rule').boundingClientRect();
      query.exec(function (res) {
        if (!res || !res.length) return;
        var patch = {};
        if (res[0] && res[0].height > 110) patch.descNeedMore = true;
        if (res[1] && res[1].height > 110) patch.ruleNeedMore = true;
        if (Object.keys(patch).length) that.setData(patch);
      });
    });
  },

  getData() {
    var that = this;
    if (!that.data.id) {
      that.setData({ loading: false, loadError: true, loadErrorMsg: '玩法链接不完整，请从玩法列表重新进入。' });
      return;
    }
    that.setData({ loading: true, loadError: false, loadErrorMsg: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: that.data.scope === 'my' ? '/api/template/myinfo' : '/api/template/info',
      data: { id: that.data.id },
      method: 'POST',
      success: function (res) {
        if (res && res.code == '200' && isRecord(res.data)) {
          that.applyDetailPayload(res.data);
        } else {
          that.setData({
            loadError: true,
            loadErrorMsg: app.getRequestErrorMessage(res, '玩法详情加载失败，请重试。')
          });
        }
      },
      fail: function (res) {
        that.setData({
          loadError: true,
          loadErrorMsg: app.getRequestErrorMessage(res, '网络错误，玩法详情暂时没有加载出来。')
        });
      },
      complete: function () {
        that.setData({ loading: false });
      }
    });
  },

  onRetry() {
    this.getData();
  },

  goBack() {
    var isMyScope = this.data.isMyScope;
    wx.navigateBack({
      delta: 1,
      fail: function () {
        // T36:模板页是 tabBar 页,redirectTo 必失败,只能 switchTab
        if (isMyScope) wx.redirectTo({ url: '/subpackageMember/mytemplate/mytemplate' });
        else wx.switchTab({ url: '/pages/template/index' });
      }
    });
  },

  switchTab(e) {
    var tab = e.detail.key;
    if (tab && tab !== this.data.activeTab) {
      this.setData({ activeTab: tab });
    }
  },

  toggleDescMore() {
    this.setData({ descExpanded: !this.data.descExpanded });
  },

  toggleRuleMore() {
    this.setData({ ruleExpanded: !this.data.ruleExpanded });
  },

  // 标签行超过一行才收起;点整行展开,不另做一个「更多」小链接抢热区
  toggleCapRow(e) {
    var key = (e.currentTarget.dataset || {}).key;
    if (!key) return;
    var next = Object.assign({}, this.data.capExpanded);
    next[key] = !next[key];
    this.setData({ capExpanded: next });
  },

  // 「节点预览」是动作 chip,点它开预览半屏,不参与展开
  tapCapChip(e) {
    var action = (e.currentTarget.dataset || {}).action;
    if (action === 'preview') this.openPop(e);
  },

  previewGallery(e) {
    var urls = this.data.gallery;
    if (!urls.length) return;
    wx.previewImage({
      current: e.currentTarget.dataset.url || urls[0],
      urls: urls
    });
  },

  // 画廊「查看全部」:从第一张进全量预览。复用 previewGallery 的同一条通道,
  // 不是摆样子的链接 —— 没有图时 wxml 那个入口本身就不渲染。
  previewGalleryAll() {
    var urls = this.data.gallery;
    if (!urls.length) return;
    wx.previewImage({ current: urls[0], urls: urls });
  },

  openMore() {
    this.setData({ moreShow: true });
  },

  closeMore() {
    this.setData({ moreShow: false });
  },

  openPopFromMore() {
    this.setData({
      moreShow: false,
      popDavid: true,
      canSubmitPreview: false,
      selectedOption: '',
      selectedOptionKey: '',
      inputAnswer: ''
    });
  },

  onShare() {
    this.setData({ moreShow: false });
  },

  closePop() {
    this.setData({
      popDavid: false,
      canSubmitPreview: false,
      selectedOption: '',
      selectedOptionKey: '',
      inputAnswer: ''
    });
  },

  openPop() {
    this.setData({
      popDavid: true,
      canSubmitPreview: false,
      selectedOption: '',
      selectedOptionKey: '',
      inputAnswer: ''
    });
  },

  onSelectOption(e) {
    this.setData({
      selectedOption: e.currentTarget.dataset.value,
      selectedOptionKey: e.currentTarget.dataset.option,
      canSubmitPreview: true
    });
  },

  onInputAnswer(e) {
    this.setData({
      inputAnswer: e.detail.value,
      canSubmitPreview: !!(e.detail.value || '').trim()
    });
  },

  completePreview() {
    if (!this.data.canSubmitPreview) return;
    this.closePop();
  },

  // 置灰的「完成预览」被点 = 还没作答;提示一条,别让按钮静默。
  onPreviewDisabledTap() {
    toast('请先作答再完成预览');
  },

  goPrimary() {
    var that = this;
    if (that.data.scope !== 'my') {
      analytics.track('template_reuse', {
        bizType: 'template',
        bizId: that.data.id
      });
    }
    // R9-04:scope=my 的 id 是个人草稿(cms_member_template),编辑页必须知道这一点
    // 才会走 /api/template/myinfo;丢掉它就会拿公共库接口查草稿 id,报「模版不存在」。
    wx.navigateTo({
      url: '/pages/publish/temp/index?id=' + that.data.id +
        (that.data.scope === 'my' ? '&scope=my' : '')
    });
  },

  onShareAppMessage() {
    var info = this.data.info || {};
    return {
      title: info.title || '城瘾玩法',
      path: '/pages/templatedetail/templatedetail?id=' + this.data.id +
        (this.data.scope === 'my' ? '&scope=my' : '')
    };
  }
});
