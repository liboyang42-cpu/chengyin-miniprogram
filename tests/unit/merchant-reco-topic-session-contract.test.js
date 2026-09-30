/**
 * CU-M-85(2026-09-24 走查)· 同名推荐主题无法辨别场次。
 *
 * 走查现象:参谋页给出两张「E2E 探店日一期」,没有日期也没有主办方 —— 进了合作广场才看得出
 * 它们是不同日期的两条招商;推荐卡的「去申请承接」又只把用户丢进广场列表,得自己再认一遍。
 *
 * 修复两侧:
 *   ① 后端 recommendedTopics 行补 startDate/endDate/hostName(MerchantInsightServiceImpl.topicRow);
 *   ② 前端卡面按广场 dateText 的写法补一行场次,点卡带 ?topicId= 过去;合作广场 onLoad 收下该参数,
 *      命中那条加描边并滚进视野(「查看全部」仍走纯列表,行为不变)。
 *
 * 负控全部在内存里做(源码字符串改一遍再解释执行),不落盘、不碰工作区文件。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const COOP_CENTER_JS = 'pages/merchant/coop-center/index.js';
const AI_INSIGHT_JS = 'pages/merchant/marketing/ai-insight/index.js';

/** 把一个页面源码解释执行,拿到 definition + 桩记录(wx/请求/滚动都按次收)。 */
function loadPage(source, relativePath, extraWx) {
  let definition = null;
  const requests = [];
  const navigated = [];
  const scrolled = [];
  const noop = () => {};
  const app = {
    globalData: { user_id: 9, statusBarHeight: 20 },
    isDevEnv: () => false,
    getUserID: () => 9,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: (request) => { requests.push(request) },
    tips: noop,
    chooseImage: noop,
    getUploadClient: () => ({ uploadAll: noop }),
  };
  const wx = {
    getStorageSync: () => '',
    setStorageSync: noop,
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 44 }),
    showToast: noop, showModal: noop, showLoading: noop, hideLoading: noop,
    switchTab: noop, navigateBack: noop,
    navigateTo: (o) => { navigated.push(o.url) },
    setNavigationBarColor: noop,
    pageScrollTo: (o) => { scrolled.push(o) },
  };
  const file = path.join(ROOT, relativePath);
  vm.runInNewContext(source, {
    Page: (value) => { definition = value; },
    getApp: () => app,
    wx: Object.assign(wx, extraWx || {}),
    console,
    require: (id) => (id.includes('/toast') ? Object.assign(noop, { success: noop })
      : id.includes('/merchant-theme') ? { merchantPageShow: noop, merchantPageRestore: noop }
        : require(path.resolve(path.dirname(file), id))),
  });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  // 真机 setData 支持 'routes[1].focus' 这类下标路径(产品代码就在用),桩也得支持。
  page.setData = (patch, callback) => {
    Object.keys(patch).forEach((key) => {
      const tokens = key.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
      let cursor = page.data;
      tokens.slice(0, -1).forEach((token) => {
        if (cursor[token] === undefined || cursor[token] === null) cursor[token] = {};
        cursor = cursor[token];
      });
      cursor[tokens[tokens.length - 1]] = patch[key];
    });
    if (typeof callback === 'function') callback();
  };
  return { page, requests, navigated, scrolled };
}

// normalizeMarketingHome 校验很严,夹具必须字段齐全
function marketingHome(items) {
  return {
    code: 200,
    data: {
      recruiting: { count: items.length, items },
      coupons: { couponCount: 0, received: 0, verified: 0 },
      content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
      funnel: [],
    },
  };
}

/** 走查里的两条:同名、不同日期。 */
const SAME_NAME_SESSIONS = [
  { id: 21, name: 'E2E 探店日一期', imgUrl: '', productType: 1, startDate: '2026-09-01 00:00:00', endDate: '2026-09-02 00:00:00' },
  { id: 22, name: 'E2E 探店日一期', imgUrl: '', productType: 1, startDate: '2026-09-20 00:00:00', endDate: '2026-09-21 00:00:00' },
];

function openPlaza(options) {
  const env = loadPage(read(COOP_CENTER_JS), COOP_CENTER_JS);
  env.page.onLoad(options);
  env.requests[0].success(marketingHome(SAME_NAME_SESSIONS));
  return env;
}

test('带 ?topicId= 进广场:命中那条被标出来并滚进视野,其余不动', () => {
  const { page, scrolled } = openPlaza({ topicId: '22' });
  const focused = page.data.routes.filter((item) => item.focus);
  assert.equal(focused.length, 1, '只许标一条,不能把同名的两条一起标');
  assert.equal(focused[0].id, 22);
  // 跨 realm 的对象不做 deepStrictEqual(原型不同),逐字段比。
  assert.equal(scrolled.length, 1);
  assert.equal(scrolled[0].selector, '#cc-route-22');
  assert.equal(scrolled[0].duration, 300);
  assert.equal(page.data.routes.length, 2, '定位不是过滤:两条同名招商都还在列表里');
});

test('topicId 不在本页(已下架/未进池):安静停在完整列表,不报错', () => {
  const { page, scrolled } = openPlaza({ topicId: '999' });
  assert.equal(page.data.routes.length, 2);
  assert.equal(page.data.routes.some((item) => item.focus), false);
  assert.equal(scrolled.length, 0);
});

test('不带 topicId 的老入口(查看全部/直接进广场)行为不变', () => {
  const { page, scrolled } = openPlaza({});
  assert.equal(page.data.routes.length, 2);
  assert.equal(page.data.routes.every((item) => !item.focus), true, '无 topicId 时不标任何条目');
  assert.equal(scrolled.length, 0);
});

test('广场卡上有 id 锚点,命中态才有描边类', () => {
  const wxml = read('pages/merchant/coop-center/index.wxml');
  assert.match(wxml, /id="cc-route-\{\{item\.id\}\}"/, '定位靠这个 id,删了滚动就落空');
  assert.match(wxml, /class="cc-route \{\{item\.focus \? 'cc-route--focus' : ''\}\}"/);
  assert.match(read('pages/merchant/coop-center/index.wxss'), /\.cc-route--focus \{/);
});

test('负控:渲染完成后的定位钩子摘掉时,标记与滚动都必须落空', () => {
  const source = read(COOP_CENTER_JS);
  const regressed = source.replace('}, () => this._locateFocusTopic());', '});');
  assert.notEqual(regressed, source, '负控锚点失效:定位钩子已改名,扫描口径需同步');
  const { page, requests, scrolled } = loadPage(regressed, COOP_CENTER_JS);
  page.onLoad({ topicId: '22' });
  requests[0].success(marketingHome(SAME_NAME_SESSIONS));
  assert.equal(page.data.routes.some((item) => item.focus), false);
  assert.equal(scrolled.length, 0);
});

// ---------- 参谋页:卡面场次行 + 带 topicId 的跳转 ----------

function loadAiInsight(source) {
  return loadPage(source, AI_INSIGHT_JS);
}

test('推荐卡场次行:起止日期按广场同一写法拼,同名主题分得出场次', () => {
  const { page } = loadAiInsight(read(AI_INSIGHT_JS));
  const cards = page._decorateTopics([
    { topicId: 21, name: 'E2E 探店日一期', startDate: '2026-09-01 00:00:00', endDate: '2026-09-02 00:00:00', hostName: '夜航俱乐部' },
    { topicId: 22, name: 'E2E 探店日一期', startDate: '2026-09-20 00:00:00', endDate: '2026-09-21 00:00:00', hostName: '官方' },
  ]);
  assert.equal(cards[0].metaText, '9月1日 – 9月2日 · 主办 夜航俱乐部');
  assert.equal(cards[1].metaText, '9月20日 – 9月21日 · 主办 官方');
  assert.notEqual(cards[0].metaText, cards[1].metaText, '两张同名卡必须能区分开');
});

test('缺日期/主办方时该行留空,不编内容', () => {
  const { page } = loadAiInsight(read(AI_INSIGHT_JS));
  const cards = page._decorateTopics([{ topicId: 30, name: '咖啡地图' }]);
  assert.equal(cards[0].metaText, '');
});

test('点推荐卡带 topicId 进广场;非法 id 退回纯列表', () => {
  const { page, navigated } = loadAiInsight(read(AI_INSIGHT_JS));
  page.goRecTopic({ currentTarget: { dataset: { topicId: 22 } } });
  assert.deepEqual(navigated, ['/pages/merchant/coop-center/index?topicId=22']);
  page.goRecTopic({ currentTarget: { dataset: { topicId: 'abc' } } });
  assert.equal(navigated[1], '/pages/merchant/coop-center/index');
});

test('推荐卡本体、卡面场次行、「查看全部」三者都对上', () => {
  const wxml = read('pages/merchant/marketing/ai-insight/index.wxml');
  assert.match(wxml, /class="tcard" wx:for="\{\{recTopics\}\}" wx:key="topicId" bindtap="goRecTopic"\s+data-topic-id="\{\{item\.topicId\}\}"/);
  assert.match(wxml, /<text class="tcard-meta" wx:if="\{\{item\.metaText\}\}">\{\{item\.metaText\}\}<\/text>/);
  assert.match(wxml, /class="sec-link" bindtap="goCoopCenter"/, '「查看全部」仍去完整列表');
});

test('负控:卡面改回只渲染名字时,场次断言必须真红', () => {
  const source = read(AI_INSIGHT_JS);
  const regressed = source.replace(
    "const dateText = start && end && start !== end ? start + ' – ' + end : start;",
    "const dateText = '';"
  );
  assert.notEqual(regressed, source, '负控锚点失效:场次拼接已改名,扫描口径需同步');
  const { page } = loadAiInsight(regressed);
  const cards = page._decorateTopics([
    { topicId: 21, name: 'E2E 探店日一期', startDate: '2026-09-01 00:00:00', endDate: '2026-09-02 00:00:00' },
    { topicId: 22, name: 'E2E 探店日一期', startDate: '2026-09-20 00:00:00', endDate: '2026-09-21 00:00:00' },
  ]);
  assert.equal(cards[0].metaText, '');
  assert.throws(() => assert.notEqual(cards[0].metaText, cards[1].metaText), assert.AssertionError);
});
