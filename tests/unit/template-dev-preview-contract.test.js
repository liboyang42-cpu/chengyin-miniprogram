const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PAGE_JS = path.join(ROOT, 'pages/template/index.js');
const PAGE_WXML = path.join(ROOT, 'pages/template/index.wxml');
const mockData = require('../../utils/mockData');

const INTERACTION_TITLES = [
  '今晚的暗号', '老板的秘密题', '拍下这一刻', '收集这枚风味印章',
  '新品盲测局', '今日搭配任务', '集合点亮', '小队竞速点亮',
  '街角谜题', '城市取景任务', '城市接力棒', '今日角色任务',
];

const TOPIC_NAMES = [
  '风味巡游', '不惑之年', '预制人生', '高温末日逃生', '上海像一部旧电影',
];

const INTERACTION_ICON_PATHS = {
  今晚的暗号: '/images/interaction-templates/merchant-secret-code.svg',
  老板的秘密题: '/images/interaction-templates/merchant-secret-question.svg',
  拍下这一刻: '/images/interaction-templates/merchant-photo-moment.svg',
  收集这枚风味印章: '/images/interaction-templates/merchant-flavor-stamp.svg',
  新品盲测局: '/images/interaction-templates/merchant-blind-test.svg',
  今日搭配任务: '/images/interaction-templates/merchant-style-mission.svg',
  集合点亮: '/images/interaction-templates/club-gather.svg',
  小队竞速点亮: '/images/interaction-templates/club-team-race.svg',
  街角谜题: '/images/interaction-templates/club-street-puzzle.svg',
  城市取景任务: '/images/interaction-templates/club-city-camera.svg',
  城市接力棒: '/images/interaction-templates/club-relay.svg',
  今日角色任务: '/images/interaction-templates/club-role-mission.svg',
};

function mountTemplatePage(envVersion) {
  const requests = [];
  const toasts = [];
  const navigations = [];
  let definition;
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: {} },
    getUserRole: () => 'player',
    getUserType: () => 0,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) { requests.push(options); },
  };
  global.getApp = () => app;
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
    showToast(options) { toasts.push(options); },
    navigateTo(options) { navigations.push(options); },
  };
  global.Page = (config) => { definition = config; };
  delete require.cache[require.resolve(PAGE_JS)];
  require(PAGE_JS);
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return { page, requests, toasts, navigations };
}

test('开发数据包含已新增的 12 个商家/俱乐部交互模板', () => {
  const titles = mockData.getTemplates().map((item) => item.title);
  INTERACTION_TITLES.forEach((title) => {
    assert.equal(titles.includes(title), true, `缺少交互模板:${title}`);
  });
  const interactionPreviews = mockData.getTemplates().filter((item) => INTERACTION_TITLES.includes(item.title));
  assert.equal(interactionPreviews.every((item) => item.previewOnly === true), true,
    '未落库的交互模板必须明确标记为开发预览');

  const home = mockData.getHomeData();
  const visibleTitles = new Set([
    ...home.bannerList, ...home.recommendList, ...home.latestList,
  ].map((item) => item.title));
  INTERACTION_TITLES.forEach((title) => {
    assert.equal(visibleTitles.has(title), true, `开发首页切片中找不到交互模板:${title}`);
  });
});

function assertUnknownTemplateFallbackUsesDsIcon(markup) {
  // 2026-08-26:列表统一成 .cml-pic 之后,「没有专属资源」的兜底不再是 cy-icon 图标位,
  // 而是明确失败态(no_data + 「封面暂不可用」)。守的不变量没变:不许伪造资产。
  assert.match(markup, /class="cml-pic cover-error"[\s\S]*?<text class="cover-error-text">封面暂不可用<\/text>/,
    '没有专属资源的模板必须落到明确失败态,不能留空白');
  assert.doesNotMatch(markup, /\{\{\s*item\._initial\s*\}\}/,
    '未知模板不得用首字冒充图形资产');
  assert.doesNotMatch(markup, /linear-gradient\([^)]*item\./,
    '未知模板不得用 CSS 渐变冒充内容图');
}

test('12 个交互模板使用具象游戏图标，未知模板使用设计系统兜底图标', () => {
  // 2026-08-26:首页四刀切退役,玩法走单一列表(gameRows ← decorateGame)。
  // 图标映射这条不变量原样保留,只是取样口从「四个切片」换成「装饰器输出」。
  const dev = mountTemplatePage('develop');
  const decorated = dev.page.decorateGame(mockData.getTemplates());

  Object.entries(INTERACTION_ICON_PATHS).forEach(([title, iconPath]) => {
    const item = decorated.find((row) => row.title === title);
    assert.ok(item, `页面切片中找不到交互模板:${title}`);
    assert.equal(item._iconUrl, iconPath, `${title} 图标映射不正确`);
    assert.equal(fs.existsSync(path.join(ROOT, iconPath.slice(1))), true, `${title} 图标资源不存在`);
  });

  const wxml = fs.readFileSync(PAGE_WXML, 'utf8');
  assert.match(wxml, /<image[^>]*wx:if="\{\{ item\._iconUrl \}\}"[^>]*src="\{\{ item\._iconUrl \}\}"/,
    '模板图标位应优先渲染具象图标');
  assertUnknownTemplateFallbackUsesDsIcon(wxml);

  // 负控:把兜底态拆掉,检查器必须真的判红(只比字符串变没变是恒真的假负控)
  const mutant = wxml.replaceAll('class="cml-pic cover-error"', 'class="cml-pic"');
  assert.notEqual(mutant, wxml, '负控锚点失效：找不到未知模板兜底态');
  assert.throws(() => assertUnknownTemplateFallbackUsesDsIcon(mutant),
    '拆掉兜底态后检查器仍然放行 —— 这条断言是恒绿的');
  assert.throws(() => assertUnknownTemplateFallbackUsesDsIcon(mutant));
});

test('开发数据包含 5 个上海单人自由探索主题，且保持 EXPERIMENTAL 预览状态', () => {
  const topics = mockData.getTopicTemplates();
  assert.deepEqual(topics.map((item) => item.name), TOPIC_NAMES);
  topics.forEach((item) => {
    assert.equal(item.templateStatus, 'EXPERIMENTAL');
    assert.equal(item.previewOnly, true);
    assert.equal(item.productType, 2);
    assert.equal(item.chapterCount, 1);
    assert.equal(item.gameCount, 1);
    assert.equal(item.locationCount, 4);
    // 封面已搬去服务端静态目录(主包 2MB 硬限);母版留在仓库 docs/assets/template-covers/。
    // 2026-08-25 换轨:实拍照 → ci/render_template_covers.py 产出的自绘场景 key art。
    assert.match(item.imgUrl,
      /^https:\/\/www\.chengyinhub\.com\/prod-api\/profile\/template-covers\/t\d{2}-[a-z-]+\.webp$/);
    const stem = item.imgUrl.split('/').pop();
    assert.equal(
      fs.existsSync(path.join(ROOT, '../docs/assets/template-covers/final', stem)),
      true, `线上封面必须在仓库留有母版:${item.imgUrl}`);
  });
});

test('主题模板接口失败时仅 develop 展示实验预览，release 不伪造数据', () => {
  const dev = mountTemplatePage('develop');
  dev.page.getTopicTemplates();
  dev.requests[0].fail({ errMsg: 'request:fail' });
  assert.deepEqual(dev.page._topicRows.map((item) => item.name), TOPIC_NAMES);
  assert.equal(dev.page._topicRows.every((item) => item._statusText === '实验预览'), true);

  const release = mountTemplatePage('release');
  release.page.getTopicTemplates();
  release.requests[0].fail({ errMsg: 'request:fail' });
  assert.deepEqual(release.page._topicRows, []);
});

test('主题模板业务失败时 develop 同样回退；真实成功响应始终优先', () => {
  const devFailure = mountTemplatePage('develop');
  devFailure.page.getTopicTemplates();
  devFailure.requests[0].success({ code: '500', msg: '服务异常' });
  assert.deepEqual(devFailure.page._topicRows.map((item) => item.name), TOPIC_NAMES);

  const live = mountTemplatePage('develop');
  live.page.getTopicTemplates();
  live.requests[0].success({
    code: '200',
    data: [{ id: 7, name: '后端已验证主题', templateStatus: 'VERIFIED', chapterCount: 2, gameCount: 3 }],
  });
  assert.deepEqual(live.page._topicRows.map((item) => item.name), ['后端已验证主题']);
  assert.equal(live.page._topicRows[0]._statusText, '');
});

test('主题模板接口 200 但空列表时仅 develop 展示实验预览', () => {
  const dev = mountTemplatePage('develop');
  dev.page.getTopicTemplates();
  dev.requests[0].success({ code: '200', data: [] });
  assert.deepEqual(dev.page._topicRows.map((item) => item.name), TOPIC_NAMES);

  const release = mountTemplatePage('release');
  release.page.getTopicTemplates();
  release.requests[0].success({ code: '200', data: [] });
  assert.deepEqual(release.page._topicRows, []);
});

test('实验预览不能调用复制接口，避免把未落库内容伪装成可用模板', () => {
  const dev = mountTemplatePage('develop');
  const preview = mockData.getTopicTemplates()[0];
  dev.page.useTt({ currentTarget: { dataset: { item: preview } } });
  assert.equal(dev.requests.length, 0);
  assert.equal(dev.toasts.length, 1);
  assert.match(dev.toasts[0].title, /预览模板/);
});

test('未落库的交互模板不进入真实详情，避免把本地 ID 带进接口', () => {
  const dev = mountTemplatePage('develop');
  const preview = mockData.getTemplates().find((item) => item.title === '今晚的暗号');
  dev.page.jumpDetail({ currentTarget: { dataset: { item: preview } } });
  assert.equal(dev.navigations.length, 0);
  assert.equal(dev.toasts.length, 1);
  assert.match(dev.toasts[0].title, /预览模板/);
});

test('已落库的玩法模板卡片直接进入当前详情页，不再中转半屏预览', () => {
  const live = mountTemplatePage('release');
  live.page.jumpDetail({
    currentTarget: { dataset: { item: { id: 27, title: '街角密码', previewOnly: false } } },
  });

  assert.deepEqual(live.navigations, [{ url: '/pages/templatedetail/templatedetail?id=27' }]);
  assert.equal(live.page.data.templateInfoShow, undefined, '退役的半屏预览状态不应残留');
});

// 图标映射按标题字符串匹配,写错一个字或漏传一个文件都不会报错 ——
// 页面只是静默回退成首字母色块,肉眼分不出「没配」和「配错了」。
// 这里把映射从页面源码里逐条读出来,断言文件真的躺在磁盘上。
test('交互模板图标映射覆盖 19 个官方玩法,且每个文件都真实存在', () => {
  const src = fs.readFileSync(PAGE_JS, 'utf8');
  const block = src.match(/const INTERACTION_ICON_BY_TITLE = \{([\s\S]*?)\n\};/);
  assert.ok(block, '找不到 INTERACTION_ICON_BY_TITLE,常量名或结构变了');

  const entries = [...block[1].matchAll(/'([^']+)':\s*'(\/images\/interaction-templates\/[^']+\.svg)'/g)]
    .map(([, title, iconPath]) => ({ title, iconPath }));

  assert.equal(entries.length, 19,
    `映射应覆盖 19 个官方玩法(12 交互 + 7 生活备份),实际 ${entries.length}`);
  assert.equal(new Set(entries.map((e) => e.title)).size, 19, '标题不得重复');
  assert.equal(new Set(entries.map((e) => e.iconPath)).size, 19, '两个玩法不得共用同一枚图标');

  entries.forEach(({ title, iconPath }) => {
    const abs = path.join(ROOT, iconPath.replace(/^\//, ''));
    assert.ok(fs.existsSync(abs), `${title} 的图标文件不存在:${iconPath}`);
    const svg = fs.readFileSync(abs, 'utf8');
    // 全套统一石墨底 + 骨白描边;混进渐变说明有人绕过了这套规范
    assert.ok(svg.includes('#121215'), `${title} 图标底色不是规范的 #121215`);
    assert.ok(!/Gradient/i.test(svg), `${title} 图标里出现了渐变,与图标规范不符`);
  });
});
