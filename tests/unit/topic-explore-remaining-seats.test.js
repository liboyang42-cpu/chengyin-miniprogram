// 探店日场次卡「余席」的行为测试(喂真实响应形状，不看源码文本)。
//
// 病：客户端自己算 `totalInventory - 有效报名数`，而
//   ① `PublicTicketVO.fromWithoutRegistrationIdentities` 走的是 `from(source, null)`
//      ⇒ `cmsRegistrationList` 在这条投影上**恒为空数组**；
//   ② 即使换成会回填列表的路径，`PublicRegistrationSummaryVO` 只有 id/memberId/avatar/nickname，
//      **根本没有** registrationStatus / verificationStatus ⇒ 过滤器仍恒返 0；
//   ③ D1 已裁「探店日走活动壳(ownerType=2)」，买家持的是**活动票**，
//      主题线 owner_type=1 的票上永远 0 报名。
//   ⇒ remaining 恒 = totalInventory。一场卖光的 30 席，页面永远写「余 30 席」。
//   而注释自称「宁少勿多由服务端下单闸兜底」—— 方向正好相反。
//
// 真上界在同一个响应里：`perkSellableCapacity`（PerkLedgerServiceImpl.topicSellableCapacity
// = 各必选章 `Σ(quota_total-quota_used) − 已售未核销` 的**最小值**，裁决表 §2.1
// 「能卖票数 = 各必选章容量的最小值，不是总和」）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../pages/topic/index/index.js');

function loadTopicPage() {
  let pageConfig = null;
  const requests = [];
  const previous = { getApp: global.getApp, Page: global.Page };
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserType: () => 1,
    tips: () => {},
    sendRequest: (request) => { requests.push(request); },
  });
  global.Page = (config) => { pageConfig = config; };
  global.wx = {
    showLoading: () => {}, hideLoading: () => {}, showToast: () => {},
    getStorageSync: () => '', setStorageSync: () => {},
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => {} }) }) }),
  };
  delete require.cache[PAGE_PATH];
  try {
    require(PAGE_PATH);
  } finally {
    global.getApp = previous.getApp;
    global.Page = previous.Page;
  }
  const vm = Object.assign({}, pageConfig);
  vm.data = Object.assign({}, pageConfig.data);
  vm.setData = function (patch) { Object.assign(this.data, patch); };
  vm.requests = requests;
  return vm;
}

/** 服务端 PublicTicketVO 的真实形状：报名列表被剥空，只回填 registrationCount。 */
function session(overrides) {
  return Object.assign({
    id: 9001,
    totalInventory: 80,
    registrationCount: 60,
    cmsRegistrationList: [],
    dateTime: '2026-09-05 10:00:00',
    endDateTime: '2026-09-05 18:00:00',
  }, overrides);
}

test('场次余席优先取活动壳 remainingInventory,不拿本期权益容量覆盖每张卡', () => {
  const vm = loadTopicPage();
  const out = vm.processTopicDate.call(vm, [session({ remainingInventory: 7 })], 20);
  assert.equal(out[0].remaining, 7, '场次卡必须显示对应活动票库存');
});

test('remainingInventory 缺失时不猜主题壳库存,明确保留 unknown', () => {
  const vm = loadTopicPage();
  const out = vm.processTopicDate.call(vm, [session()], 2);
  assert.equal(out[0].remaining, null);
});

test('库存字段为 0 时必须保留 0,不能因 falsy 回落成总量', () => {
  const vm = loadTopicPage();
  assert.equal(vm.processTopicDate.call(vm, [session({ remainingInventory: 0 })], 99)[0].remaining, 0);
});

test('本期权益可售容量只显示一次,MAX_VALUE/缺失不印出来', () => {
  const vm = loadTopicPage();
  assert.equal(vm.formatPerkCapacity.call(vm, 12), '本期可售 12 张');
  assert.equal(vm.formatPerkCapacity.call(vm, 0), '本期可售 0 张');
  assert.equal(vm.formatPerkCapacity.call(vm, 2147483647), '');
  assert.equal(vm.formatPerkCapacity.call(vm, null), '');
});

test('getData 把服务端期级容量格式化后写进真实页面状态', () => {
  const vm = loadTopicPage();
  vm.data.id = 9;
  vm.getTabSectionPosition = () => {};
  vm.getTabHeight = () => {};
  vm.getData();
  assert.equal(vm.requests.length, 1);
  vm.requests[0].success({ code: '200', data: {
    id: 9,
    name: '老城探店日',
    startDate: '2026-09-01 10:00:00',
    endDate: '2026-09-01 18:00:00',
    totalTime: 120,
    omsTicketList: [session({ remainingInventory: 7 })],
    perkSellableCapacity: 12,
  } });

  assert.equal(vm.data.info.perkCapacityText, '本期可售 12 张');
  assert.equal(vm.data.info.omsTicketList[0].remaining, 7,
    '期级容量与每张活动票余席必须同时保留，不能互相覆盖');
});

test('模板只在场次列表外显示一次期级容量并保留 unknown 文案', () => {
  const wxml = require('node:fs').readFileSync(path.resolve(__dirname, '../../pages/topic/index/index.wxml'), 'utf8');
  assert.equal((wxml.match(/class="sess__capacity"/g) || []).length, 1,
    '期级容量不能复制到每张场次卡');
  assert.match(wxml, /余席待确认/, '活动壳真值缺失时必须照实显示 unknown');
});

test('展示评分星不得缩短投票五星', () => {
  const vm = loadTopicPage();
  vm.data.id = 9;
  vm.getTabSectionPosition = () => {};
  vm.getTabHeight = () => {};
  vm.getData();
  vm.requests[0].success({ code: '200', data: {
    id: 9,
    name: '外滩夜行',
    averageRating: 4.2,
    commentCount: 3,
    omsTicketList: [],
  } });
  assert.equal(vm.data.starsBox.length, 5, '投票弹层必须仍是五档');
  assert.equal(vm.data.ratingStars.length, 4, '展示星按四舍五入的评分颗数');
  const wxml = require('node:fs').readFileSync(path.resolve(__dirname, '../../pages/topic/index/index.wxml'), 'utf8');
  assert.match(wxml, /wx:for="\{\{ratingStars\}\}"/);
  assert.match(wxml, /bindtap="changePic"[\s\S]{0,80}starsBox|starsBox[\s\S]{0,120}bindtap="changePic"/);
});
