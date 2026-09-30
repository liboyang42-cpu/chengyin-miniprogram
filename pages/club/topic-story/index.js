// 俱乐部端「剧情与玩法」(Figma J1-A 228:125 / J1-B 228:142 / J1-C 241:126)。
// 两个 tab:路线(按章节分组的站点时间轴)· 玩法(章节 chip → 本章剧情 → 本章玩法模板卡)。
//
// 数据源:
//   路线/玩法陈列 → /api/topic/info-to-user(玩家视角公开投影,模板已过 TemplateSecrets.strip,
//                    答案/提示不在里面 —— 本页正是靠这一点才敢把它当陈列源)。
//   答案         → /api/club/topic-node-answer(俱乐部治理专用独立端点,服务端 canGovernClub 校验)。
//                  ★ 绝不复用 /api/play/nodes:那条是玩家视角,揭示要走 member_spoiler_reveal
//                    且揭示即 0 分,语义和权限都不是「主理人看答案」。
const app = getApp();
const { haversine } = require('../../../utils/geo.js');
const policy = require('../../../utils/identity/identity-policy.js');
const merchantTheme = require('../../../utils/merchant-theme.js');

const { validationMethodLabel } = require('../../../utils/validation-method-labels.js');
// 1=文字作答 3=选择题 —— 与后端 PuzzlePlayServiceImpl.selectPuzzleTemplate 同一判据:
// 只有这两类才存在「答案」这回事,其余玩法按钮组退化成「看看模板」单键(稿 J1-B 卡2)。
const ANSWERABLE = [1, 3];
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
// 步行速度 80m/min(≈4.8km/h)。接口没有逐段步行时长,只有站点经纬度,
// 所以这里是直线距离估算,拿不到坐标就整行不画(不编一个数字充数)。
const WALK_METERS_PER_MIN = 80;

function text(v) {
  return v === 0 ? '0' : String(v == null ? '' : v).trim();
}

function chapterTitle(name, index) {
  const raw = text(name);
  if (/^第.{1,3}章/.test(raw)) return raw;
  const ordinal = CN_NUM[index] || String(index + 1);
  return raw ? '第' + ordinal + '章 · ' + raw : '第' + ordinal + '章';
}

function durationText(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h && m) return h + 'h ' + m + 'min';
  if (h) return h + 'h';
  return m + 'min';
}

function walkText(prev, node) {
  if (!prev || !node) return '';
  const la1 = Number(prev.latitude); const lo1 = Number(prev.longitude);
  const la2 = Number(node.latitude); const lo2 = Number(node.longitude);
  if (![la1, lo1, la2, lo2].every(Number.isFinite)) return '';
  if (!la1 || !lo1 || !la2 || !lo2) return '';
  const meters = haversine(la1, lo1, la2, lo2);
  if (!Number.isFinite(meters) || meters <= 0) return '';
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MIN)) + 'min 步行';
}

function joinMeta(parts) {
  return parts.filter(function (p) { return text(p); }).join(' · ');
}

function buildChapters(chaptersList) {
  const list = Array.isArray(chaptersList) ? chaptersList : [];
  let seq = 0;
  return list.map(function (chapter, chapterIndex) {
    const nodes = Array.isArray(chapter.nodes) ? chapter.nodes : [];
    const stops = [];
    const plays = [];
    nodes.forEach(function (node, nodeIndex) {
      seq += 1;
      stops.push({
        id: node.id,
        seq: seq,
        time: text(node.businessTime),
        name: text(node.name),
        address: text(node.address),
        cover: text(node.imgUrl),
        walkText: nodeIndex === 0 ? '' : walkText(nodes[nodeIndex - 1], node),
      });
      const tpl = node.cmsMemberTemplate;
      if (!tpl) return;
      const method = Number(tpl.validationMethod);
      const hasAnswer = ANSWERABLE.indexOf(method) >= 0;
      const label = validationMethodLabel(tpl.validationMethod) || text(tpl.validationMethodStr) || '玩法';   // 传原值:没配码时走后端 validationMethodStr,别被 Number(null)=0 变成「无需验证」
      plays.push({
        nodeId: node.id,
        templateId: tpl.id,
        title: text(tpl.title) || text(node.name),
        badge: hasAnswer ? label : label + ' · 无答案',
        cover: text(tpl.imgUrl) || text(node.imgUrl),
        hasAnswer: hasAnswer,
        meta: joinMeta([
          '第 ' + seq + ' 站 ' + text(node.name),
          text(tpl.players),
          tpl.duration ? tpl.duration + ' 分钟' : '',
          text(tpl.difficulty) ? '难度' + text(tpl.difficulty) : '',
        ]),
      });
    });
    return {
      id: chapter.id,
      title: chapterTitle(chapter.name, chapterIndex),
      chipLabel: chapterTitle(chapter.name, chapterIndex),
      meta: stops.length
        ? joinMeta([durationText(chapter.totalTime), stops.length + ' 站'])
        : '未开放 · 待招商',
      story: text(chapter.description),
      stops: stops,
      plays: plays,
    };
  });
}

Page({
  data: {
    // 商家进来走浅色域(稿 448:*),俱乐部/玩家仍是纯黑
    isMerchantViewer: false,
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    tabs: [{ key: 'route', label: '路线' }, { key: 'play', label: '玩法' }],
    tab: 'route',
    loaded: false,
    loadError: '',
    missingParam: false,
    chapters: [],
    activeChapterIndex: 0,
    activeChapter: null,
    storyExpanded: false,
    answerVisible: false,
    answerTitle: '',
    answerNodeName: '',
    answerLoading: false,
    answerError: '',
    answer: null,
  },

  /* 稿 448:925 / 448:1076 是这一页的**商家浅色版**(J1-A/J1-B「剧情与玩法 · 商家浅」)。
     内容与俱乐部版逐字相同 —— 章节分组、站点时间轴、步行时长、未开放章节的
     「未开放 · 待招商」空态、玩法卡与「玩家可获得」都已经在这一页里,差的只是配色域。
     原来 wxml 第一行写死 theme-dark,商家进来就是一屏纯黑,与他所有其它页都对不上。
     判身份的写法照 pages/activity/official-inbox 的 syncViewerTheme,不另发明一套。 */
  syncViewerTheme() {
    const isMerchantViewer = policy.isMerchantView({
      role: app.getUserRole(),
      userType: app.getUserType(),
      debugView: wx.getStorageSync('debug_user_view'),
    });
    this.setData({ isMerchantViewer });
    if (isMerchantViewer) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
  },

  onShow() { this.syncViewerTheme(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  onLoad(options) {
    this.syncViewerTheme();
    const opts = options || {};
    this.topicId = text(opts.topicId || opts.id);
    this.clubId = text(opts.clubId);
    if (!this.topicId) {
      // E-12(2026-09-16):缺参是终态。原来只给「重试」,点一次失败一次 —— 出口改成返回。
      this.setData({ loaded: true, loadError: '缺少主题标识，请从俱乐部页面重新进入', missingParam: true });
      return;
    }
    this.load();
  },

  load() {
    const that = this;
    this.setData({ loadError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/topic/info-to-user',
      method: 'POST',
      data: { id: this.topicId },
      success(res) {
        if (!res || res.code != '200' || !res.data) {
          that.setData({ loaded: true, loadError: that._msg(res, '剧情与玩法加载失败，请重试') });
          return;
        }
        const chapters = buildChapters(res.data.chaptersList);
        that.setData({
          loaded: true,
          chapters: chapters,
          activeChapterIndex: 0,
          activeChapter: chapters[0] || null,
        });
      },
      fail() {
        that.setData({ loaded: true, loadError: '网络开了点小差，请稍后再试' });
      },
    });
  },

  _msg(res, fallback) {
    return app.getRequestErrorMessage ? app.getRequestErrorMessage(res, fallback) : fallback;
  },

  onRetry() {
    // 缺参时再 load() 也只能重放同一个租户错误:回去才是唯一出路(E-12)。
    if (this.data.missingParam) {
      if (getCurrentPages().length > 1) { wx.navigateBack(); return; }
      wx.switchTab({ url: '/pages/talent/list/index' });
      return;
    }
    this.setData({ loaded: false });
    this.load();
  },

  onTab(e) {
    const tab = e.detail && e.detail.key;
    if (!tab || tab === this.data.tab) return;
    this.setData({ tab: tab });
  },

  onChapterChip(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index) || index === this.data.activeChapterIndex) return;
    this.setData({
      activeChapterIndex: index,
      activeChapter: this.data.chapters[index] || null,
      storyExpanded: false,
    });
  },

  toggleStory() {
    this.setData({ storyExpanded: !this.data.storyExpanded });
  },

  // 「看看模板」→ 既有模板介绍页。
  // CU-C-77:C12 的玩法卡来自 node.cmsMemberTemplate, templateId 是**个人玩法**主键
  // (cms_member_template),而模板详情页缺 scope 时默认按公共库(cms_template_library)
  // 查 /api/template/info,两个 id 空间各自自增 ⇒ 隔离库实测两个玩法都进「模版不存在」
  // 弹层再退回。全仓其它个人玩法入口都带 scope=my,这条是唯一漏的。
  onViewTemplate(e) {
    const templateId = e.currentTarget.dataset.templateId;
    if (!templateId) return;
    wx.navigateTo({ url: '/pages/templatedetail/templatedetail?id=' + templateId + '&scope=my' });
  },

  // 取答案失败时的重试。原来那里只把后端那句话铺在屏幕上(U6 判的「裸错误文案」),
  // 用户看完没有出路 —— 现在走统一错误组件 + 这个重试。
  retryAnswer() {
    if (!this._answerNodeId) return;
    this.onViewAnswer({
      currentTarget: { dataset: { nodeId: this._answerNodeId, title: this._answerTitle } },
    });
  },

  onViewAnswer(e) {
    const nodeId = e.currentTarget.dataset.nodeId;
    const title = e.currentTarget.dataset.title;
    if (!nodeId) return;
    // 记住这次看的是哪个节点 —— 重试时事件对象早没了,没有它就只能让人关掉重点一次
    this._answerNodeId = nodeId;
    this._answerTitle = title;
    this.setData({
      answerVisible: true,
      // CU-C-152:标题只留简短的「答案」。完整玩法名(可能很长)降为可换行的副信息,
      // 不再拼进标题——.ss__title 是 nowrap+ellipsis,拼进去必然在右侧截成「…答...」。
      answerTitle: '答案',
      answerNodeName: title || '',
      answerLoading: true,
      answerError: '',
      answer: null,
    });
    const that = this;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/topic-node-answer',
      method: 'POST',
      // ⚠️ 后端是 @RequestBody 端点:不传 JSON 头就发成 urlencoded,
      //    业务一行都不执行,却照样回 HTTP 200 + code:500 —— 零告警的哑火。
      //    取答案会永远拿不到东西,而界面只会说「答案暂时取不到」。
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ clubId: this.clubId, topicId: this.topicId, nodeId: nodeId }),
      success(res) {
        if (!res || res.code != '200' || !res.data) {
          that.setData({ answerLoading: false, answerError: that._msg(res, '答案暂时取不到，请稍后再试') });
          return;
        }
        const d = res.data;
        that.setData({
          answerLoading: false,
          answer: {
            question: text(d.question),
            answerReveal: text(d.answerReveal),
            hints: (Array.isArray(d.hints) ? d.hints : []).filter(function (h) { return text(h); }),
            feedbackText: text(d.feedbackText),
          },
        });
      },
      fail() {
        that.setData({ answerLoading: false, answerError: '网络开了点小差，请稍后再试' });
      },
    });
  },

  closeAnswer() {
    this.setData({ answerVisible: false, answer: null, answerError: '' });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/index/index' });
  },
});
