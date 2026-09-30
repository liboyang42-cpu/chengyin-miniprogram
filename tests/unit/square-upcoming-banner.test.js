'use strict';

// 广场「即将开始」横幅的筛选契约。
//
// 为什么要有这个测试:这块的失败形态是【静默不显示】—— 筛错了就永远是 null,
// 页面正常渲染、控制台零报错,截图也只能证明"造出来的态长得对",证明不了
// "真实数据会不会被选中"。所以这里走真实 handler(stub 掉 sendRequest 后
// 调 getUpcoming(),让它自己跑 success 回调),不用 setData 直接灌展示字段。

const assert = require('assert');
const test = require('node:test');

let pageConfig;
let lastRequest = null;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, user_id: 1 },
  getUserID: () => 1,
  getAvatar: () => '',
  getUserRole: () => '',
  getUserType: () => 0,
  isDevEnv: () => false,
  sendRequest(opts) { lastRequest = opts; },
});
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  hideTabBar() {},
  getWindowInfo: () => ({ statusBarHeight: 20, windowHeight: 800 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20, windowHeight: 800 }),
  getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32, bottom: 56 }),
  navigateTo() {},
  createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec() {} }) }), exec() {} }),
};
global.Page = (config) => { pageConfig = config; };

function loadSquarePage() {
  delete require.cache[require.resolve('../../pages/square/list/index.js')];
  require('../../pages/square/list/index.js');
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return page;
}

const HOUR = 3600000;
// 一条「本该被选中」的基准活动:开关开、报名中、2 小时后开场
function ok(extra) {
  return Object.assign({
    id: 1, title: '城市点亮日', subtitle: '静安寺场', city: '上海',
    bannerEnabled: 1, status: 2,
    activityStart: new Date(Date.now() + 2 * HOUR).toISOString(),
  }, extra || {});
}

function runWith(rows) {
  const page = loadSquarePage();
  page.getUpcoming();
  assert.strictEqual(lastRequest.url, '/api/official/events', '必须打官方活动列表接口');
  lastRequest.success({ code: '200', data: rows });
  return page.data.upcoming;
}

function runPageWith(rows) {
  const page = loadSquarePage();
  page.getUpcoming();
  assert.strictEqual(lastRequest.url, '/api/official/events', '必须打官方活动列表接口');
  lastRequest.success({ code: '200', data: rows });
  return page;
}

test('正控:开关开 + 报名中 + 24h 内开场 ⇒ 选中并给出倒计时', () => {
  const up = runWith([ok()]);
  assert.ok(up, '基准活动必须被选中');
  assert.strictEqual(up.id, 1);
  assert.strictEqual(up.title, '城市点亮日');
  assert.strictEqual(up.sub, '静安寺场');
  assert.match(up.countdown, /小时后开始/);
});

test('负控:banner 开关关掉就不该出现(复用运营既有推广位开关)', () => {
  assert.strictEqual(runWith([ok({ bannerEnabled: 0 })]), null);
});

test('负控:已开赛/已结束状态不算「即将」', () => {
  assert.strictEqual(runWith([ok({ status: 3 })]), null, 'status=3 进行中不该进横幅');
  assert.strictEqual(runWith([ok({ status: 5 })]), null, 'status=5 已结束不该进横幅');
});

test('负控:开场时刻已过 / 超出 24h 窗口都不算「临近」', () => {
  assert.strictEqual(
    runWith([ok({ activityStart: new Date(Date.now() - HOUR).toISOString() })]), null,
    '已经开场的不该还挂「即将开始」');
  assert.strictEqual(
    runWith([ok({ activityStart: new Date(Date.now() + 48 * HOUR).toISOString() })]), null,
    '48 小时后开场不算临近');
});

test('多场临近时取最早的一场,其余计入 more', () => {
  const up = runWith([
    ok({ id: 7, title: '晚场', activityStart: new Date(Date.now() + 8 * HOUR).toISOString() }),
    ok({ id: 3, title: '早场', activityStart: new Date(Date.now() + 1 * HOUR).toISOString() }),
    ok({ id: 9, title: '中场', activityStart: new Date(Date.now() + 5 * HOUR).toISOString() }),
  ]);
  assert.strictEqual(up.id, 3, '必须取开场最早的那场');
  assert.strictEqual(up.title, '早场');
  assert.strictEqual(up.more, 2, '另外两场计入 more');
});

test('多场临近活动全部进入横向卡轨，按开始时间排序且保留主卡兼容字段', () => {
  const page = runPageWith([
    ok({ id: 7, title: '晚场', activityStart: new Date(Date.now() + 8 * HOUR).toISOString() }),
    ok({ id: 3, title: '早场', activityStart: new Date(Date.now() + 1 * HOUR).toISOString() }),
    ok({ id: 9, title: '中场', activityStart: new Date(Date.now() + 5 * HOUR).toISOString() }),
  ]);

  assert.deepStrictEqual(page.data.upcomingCards.map((item) => item.id), [3, 9, 7]);
  assert.strictEqual(page.data.upcoming.id, 3, '旧的主卡字段仍指向最早活动');
});

test('参与者头像最多展示三张并给出 +N；接口没有头像时不伪造头像堆', () => {
  const withAvatars = runPageWith([ok({
    participants: 8,
    participantAvatars: ['a.png', 'b.png', 'c.png', 'd.png'],
  })]).data.upcomingCards[0];
  assert.deepStrictEqual(withAvatars.avatars, ['a.png', 'b.png', 'c.png']);
  assert.strictEqual(withAvatars.avatarOverflow, 5);

  const withoutAvatars = runPageWith([ok({ participants: 8 })]).data.upcomingCards[0];
  assert.deepStrictEqual(withoutAvatars.avatars, []);
  assert.strictEqual(withoutAvatars.avatarOverflow, 0, '没有真实头像时不得只画一个 +8 假头像堆');
});

test('副标题缺省时退到城市;两者都空则 sub 为空串(WXML 侧整行不渲染)', () => {
  assert.strictEqual(runWith([ok({ subtitle: '' })]).sub, '上海');
  assert.strictEqual(runWith([ok({ subtitle: '', city: '' })]).sub, '');
});

test('一条都不合格 / 接口非 200 / 网络失败 ⇒ upcoming 归 null,不留半个空壳', () => {
  assert.strictEqual(runWith([]), null);

  const page = loadSquarePage();
  page.getUpcoming();
  lastRequest.success({ code: '500', msg: 'boom' });
  assert.strictEqual(page.data.upcoming, null, '非 200 必须收成 null');

  const page2 = loadSquarePage();
  page2.getUpcoming();
  lastRequest.fail();
  assert.strictEqual(page2.data.upcoming, null, 'fail 分支必须收成 null');
});

test('时区:开场时间用 +08:00 锚定,不随运行环境时区漂移', () => {
  // CI 恒 UTC、真机在 +08:00。同一个后端字符串必须算出同一个瞬时,
  // 否则 CI 绿而线上横幅早 8 小时消失(或晚 8 小时才出现)。
  const startCN = '2099-01-01 10:00:00';           // 后端惯用的无时区字符串
  const expected = Date.parse('2099-01-01T10:00:00+08:00');
  const realNow = Date.now;
  Date.now = () => expected - 3 * HOUR;            // 距开场 3 小时
  try {
    const up = runWith([ok({ activityStart: startCN })]);
    assert.ok(up, '距开场 3 小时必须选中');
    assert.strictEqual(up.countdown, '3 小时后开始');
  } finally {
    Date.now = realNow;
  }
});
