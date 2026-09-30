const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function loadPage(relativePath, app, wx) {
  let config;
  global.getApp = () => app;
  global.wx = wx;
  global.Page = (definition) => { config = definition; };
  const absolute = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(absolute)];
  require(absolute);
  return config;
}

function makePage(config) {
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = (patch, done) => {
    Object.keys(patch).forEach((key) => {
      if (!key.includes('.')) page.data[key] = patch[key];
    });
    if (done) done();
  };
  return page;
}

function block(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, `缺少 ${selector} 样式块`);
  return match[1];
}

function assertNoDivider(source, selector) {
  assert.doesNotMatch(block(source, selector), /border(?:-top|-right|-bottom|-left)?\s*:/, `${selector} 不得用横线/描边分层`);
}

// 2026-08-11:旧「承接商家」页收成兼容壳,标签/相册的对象型兜底随商家资料搬进
// components/cy/profile 的「关于」(阶段C 域,格式化契约在那边)。旧壳这边改钉
// 「资料读取已经彻底不在这一页」—— 否则删干净和悄悄留一份的区别没人守得住。
test('G1 profile: 兼容壳不再自己读取或渲染商家资料', () => {
  const js = read('pages/merchant/profile/index.js');
  assert.doesNotMatch(js, /public-detail/, '兼容壳不得再消费旧商家资料接口');
  assert.doesNotMatch(js, /parseDisplayList|gallery|tags/, '兼容壳不得再持有资料展示态');
  assert.doesNotMatch(read('pages/merchant/profile/index.wxml'), /\{\{(?:m|gallery|tags)\./,
    '兼容壳 WXML 不得再绑定商家资料');
});

test('G1 official-inbox: success 自己结束 loading，不能依赖测试桩可能不触发的 complete', () => {
  const requests = [];
  const app = {
    getUserRole: () => 'merchant',
    getUserType: () => 2,
    sendRequest: (options) => requests.push(options),
    getRequestErrorMessage: () => '邀约加载失败',
  };
  const config = loadPage('pages/activity/official-inbox/index.js', app, { getStorageSync: () => '' });
  const page = makePage(config);
  page.fetch();
  requests[0].success({
    code: 200,
    data: [{ partyId: 9, eventTitle: '外滩夜行档案', city: '上海', role: 'FULFILLMENT_MERCHANT', status: 'INVITED' }],
  });

  assert.equal(page.data.loading, false);
  assert.equal(page.data.invites.length, 1);
  assert.equal(page.data.invites[0]._display.eventTitle, '外滩夜行档案');
});

test('G1 六页: 白卡无描边/无卡内横线，圆角与整屏底色统一', () => {
  const workbench = read('pages/merchant/index/index.wxss');
  assert.match(block(workbench, '.rv-project-card'), /border-radius:\s*var\(--cy-radius-lg\)/);
  assertNoDivider(workbench, '.rv-project-card');
  assertNoDivider(workbench, '.rv-project-item + .rv-project-item');
  assertNoDivider(workbench, '.rv-project-line1');
  assertNoDivider(workbench, '.rv-msg');

  // profile 已收成兼容壳,白卡/分组样式随资料一起下线(去处见 §3.2);
  // 剩下的只有过场态,不参与"六页白卡"这组视觉合同。
  // 2026-08-26 营销页重做:.stats-row/.stat/.mine-row 已下线,规则不变(不许用横线分层),
  // 换成改版后承接同一职责的三块。
  const marketing = read('pages/merchant/marketing/index.wxss');
  assertNoDivider(marketing, '.tile');
  assertNoDivider(marketing, '.mine-tile');
  assertNoDivider(marketing, '.deck-card');

  const inbox = read('pages/activity/official-inbox/index.wxss');
  assert.match(block(inbox, '.oi-card'), /border-radius:\s*var\(--cy-radius-lg\)/);
  assertNoDivider(inbox, '.oi-card');
  assertNoDivider(inbox, '.oi-scope');
  assert.doesNotMatch(block(inbox, '.oi-btn.accept'), /action-primary|btn-solid/);

  const mine = read('pages/activity/official-mine/index.wxss');
  assert.match(block(mine, '.om-page'), /background:\s*var\(--cy-bg-page\)/);
  assert.match(block(mine, '.om-card'), /border-radius:\s*var\(--cy-radius-lg\)/);
  assertNoDivider(mine, '.om-card');

  const listWxml = read('pages/activity/list/index.wxml');
  const listWxss = read('pages/activity/list/index.wxss');
  /* 2026-09-03:原来这里数三处 chip tabs(列表筛选 / 发布模式 / 通知模式)并检查
     .op-card 的卡面规范 —— 后两处与 .op-* 全在「发起官方活动」面板里,面板已整块删掉。
     剩下的列表筛选仍必须是 chip。 */
  assert.ok((listWxml.match(/<cy-tabs\b[^>]*variant="chip"/g) || []).length >= 1, '列表筛选必须走 chip cy-tabs');
  assert.doesNotMatch(listWxss, /\.op-card\b/, '发布面板样式不许复活');
});

test('G1 每屏至多一个 Primary：列表动作走次级，缺关键字段不渲染半成品卡', () => {
  const inbox = read('pages/activity/official-inbox/index.wxss');
  const coopCenter = read('pages/merchant/coop-center/index.wxml');
  const activityList = read('pages/activity/list/index.js');
  assert.doesNotMatch(block(inbox, '.oi-btn.accept'), /action-primary|btn-solid/);
  /* 2026-09-06 修正判据的适用面。用户 2026-08 就把「一屏一个 primary」讲清楚过一次:
     它不是字面意思 —— 单列列表(我**已经拥有**的东西)整行可点、不放按钮;
     推荐卡(我**还没有**的东西)每张都可以满宽实心(当时对的是 Strava)。
     合作中心的路线卡正是后者:每一张都是「我还没接的路线」,稿 234:276 上它们
     一律是黑底白字。所以这里改成盯真正该盯的那件事 ——
     **邀约列表**(我已经在里面的关系)不许出现 primary,路线推荐卡不在此列。 */
  assert.doesNotMatch(coopCenter, /wx:for="\{\{invites\}\}"[\s\S]*?variant="primary"/);
  assert.match(activityList, /filter\(this\._isCompleteEvent\)\.map\(this\._decorate\)/);
});

// 2026-08-11:旧页收成兼容壳后,「错误态可重试 / 不存在给说明空态」这两条约束没失效,
// 只是钉在壳自己的状态机上(loading / redirecting / invalid / business-unavailable / network-error)。
test('G1 profile：兼容壳请求失败进入可重试错误态，不用假图', () => {
  const wxml = read('pages/merchant/profile/index.wxml');
  const js = read('pages/merchant/profile/index.js');
  assert.match(wxml, /<cy-error[^>]*bind:retry="retryLoad"/);
  assert.match(js, /resolveMerchant\(\) \{[\s\S]*?setData\(\{ state: 'loading', message: '' \}\)/);
  assert.match(js, /retryLoad\(\) \{[\s\S]*?resolveMerchant\(\)/);
  assert.doesNotMatch(wxml, /\/images\/mer1\.jpg/);
});

test('G1 profile：兼容壳解析失败可重试，重试期间回到骨架态', () => {
  const requests = [];
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserRole: () => 'merchant',
    getUserType: () => 2,
    sendRequest: (options) => requests.push(options),
    getRequestErrorMessage: (_res, fallback) => fallback,
  };
  const config = loadPage('pages/merchant/profile/index.js', app, { getStorageSync: () => '' });
  const page = makePage(config);
  page.data.id = '7';
  page.resolveMerchant();
  requests[0].fail({});
  assert.equal(page.data.state, 'network-error');
  assert.ok(page.data.message, '错误态必须给出可读原因');
  page.retryLoad();
  assert.equal(page.data.state, 'loading', '重试期间要回到骨架态,不能停在错误屏上');
  assert.equal(requests.length, 2, '重试必须真的重发解析请求');
});

test('G1 profile：后端明确判定不存在时进入说明空态，不伪装成网络错误', () => {
  const requests = [];
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserRole: () => 'merchant',
    getUserType: () => 2,
    sendRequest: (options) => requests.push(options),
    getRequestErrorMessage: () => '不应进入错误态',
  };
  const config = loadPage('pages/merchant/profile/index.js', app, { getStorageSync: () => '' });
  const page = makePage(config);
  page.data.id = '404';
  page.resolveMerchant();
  requests[0].success({ code: 500, msg: '商家不存在或未开放' });
  assert.equal(page.data.state, 'business-unavailable');
  assert.equal(page.data.message, '');

  // 反过来也要分得清:非业务判定的失败是「没查到」,归可重试错误态,不许当成「这家不存在」
  const other = makePage(config);
  other.data.id = '404';
  other.resolveMerchant();
  requests[1].success({ code: 500, msg: '系统繁忙' });
  assert.equal(other.data.state, 'network-error');
});

test('G1 六页: 禁止残留近黑字面量，活动入口原生底色改为浅灰', () => {
  const pageDirs = [
    'pages/merchant/index', 'pages/merchant/profile', 'pages/merchant/marketing',
    'pages/activity/official-inbox', 'pages/activity/official-mine', 'pages/activity/list',
  ];
  pageDirs.forEach((dir) => {
    ['wxml', 'wxss', 'json'].forEach((ext) => {
      const source = read(`${dir}/index.${ext}`);
      assert.doesNotMatch(source, /#(?:181818|111111|1a1a1a|33363c|333333|0a0a0b)\b/i, `${dir}/index.${ext} 残留近黑字面量`);
    });
  });
  // 从 tokens 读真值,不钉字面量:钉死会让「改一次底色 → 改一圈测试」,而且断言的是
  // 「跟 token 同步」这个语义,不是某个具体颜色(2026-08-10 改 #F9F9F9→#F3F4F4 时踩到)。
  const pageBg = /--cy-color-bg-page:\s*(#[0-9A-Fa-f]{6})/.exec(read('style/merchant-light.wxss'))[1];
  assert.equal(JSON.parse(read('pages/activity/list/index.json')).backgroundColor.toUpperCase(), pageBg.toUpperCase());
  assert.equal(JSON.parse(read('pages/activity/official-mine/index.json')).backgroundColor.toUpperCase(), pageBg.toUpperCase());
});

test('negative control: 恢复任一卡内横线或绿色主按钮时 G1 视觉合同必须判红', () => {
  const inbox = read('pages/activity/official-inbox/index.wxss');
  const activityList = read('pages/activity/list/index.js');
  const profileJs = read('pages/merchant/profile/index.js');
  const brokenDivider = inbox.replace('.oi-scope {', '.oi-scope { border-top:1rpx solid #ECECEC;');
  const brokenPrimary = inbox.replace('var(--cy-color-action-secondary-bg)', 'var(--cy-color-status-success)');
  const brokenCompleteness = activityList.replaceAll('.filter(this._isCompleteEvent).map(this._decorate)', '.map(this._decorate)');
  const brokenRetrySkeleton = profileJs.replaceAll("this.setData({ state: 'loading', message: '' });", "this.setData({ message: '' });");
  assert.notEqual(brokenDivider, inbox);
  assert.notEqual(brokenPrimary, inbox);
  assert.notEqual(brokenCompleteness, activityList);
  assert.notEqual(brokenRetrySkeleton, profileJs);
  assert.throws(() => assertNoDivider(brokenDivider, '.oi-scope'), assert.AssertionError);
  assert.throws(() => assert.doesNotMatch(block(brokenPrimary, '.oi-btn.accept'), /cy-color-status-success/), assert.AssertionError);
  assert.throws(() => assert.match(brokenCompleteness, /filter\(this\._isCompleteEvent\)\.map\(this\._decorate\)/), assert.AssertionError);
  assert.throws(() => assert.match(brokenRetrySkeleton, /resolveMerchant\(\) \{[\s\S]*?setData\(\{ state: 'loading', message: '' \}\)/), assert.AssertionError);
});
