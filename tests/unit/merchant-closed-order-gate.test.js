// 拍板 2026-09-16 #10:商家闭店(已打烊)停新报名/购票,入口给明确提示,已售不受影响。
//
// 这里钉的是**行为**:两个下单入口在 merchantClosed=true 时必须原地拦下、不发任何下单请求;
// merchantClosed=false 时照常放行。字符串级提示文案与后端常量同源,这里也一并钉住。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const XCX = path.resolve(__dirname, '../..');
const TOPIC_PAGE = path.resolve(XCX, 'pages/topic/index/index.js');
const BAOMING_PAGE = path.resolve(XCX, 'pages/activity/baoming/baoming.js');
const CLOSED_HINT = '商家暂停营业，暂不可报名';

function loadTopicPage() {
  const requests = [];
  const toasts = [];
  let pageConfig = null;
  const previous = { getApp: global.getApp, Page: global.Page };

  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserType: () => 1,
    getUserID: () => 9,
    tips: message => toasts.push(message),
    sendRequest: options => { requests.push(options); },
    recordConsent: () => Promise.resolve({ code: 200 })
  });
  global.Page = config => { pageConfig = config; };
  global.wx = {
    showLoading: () => {}, hideLoading: () => {},
    showToast: options => toasts.push(options && options.title),
    showModal: () => {},
    requestPayment: () => {},
    navigateTo: () => {}, redirectTo: () => {},
    getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
    createSelectorQuery: () => {
      const q = { in: () => q, select: () => q, selectAll: () => q, boundingClientRect: () => q, scrollOffset: () => q, exec: () => {} };
      return q;
    }
  };

  delete require.cache[TOPIC_PAGE];
  try { require(TOPIC_PAGE); } finally {
    global.getApp = previous.getApp;
    global.Page = previous.Page;
  }

  const vm = Object.assign({}, pageConfig.data, pageConfig, {
    setData(patch, cb) {
      Object.keys(patch).forEach(key => {
        if (key.indexOf('.') >= 0) {
          const parts = key.split('.');
          let cursor = this.data;
          parts.slice(0, -1).forEach(part => { cursor = cursor[part] || (cursor[part] = {}); });
          cursor[parts[parts.length - 1]] = patch[key];
        } else {
          this.data[key] = patch[key];
        }
      });
      if (cb) cb();
    }
  });
  vm.data = Object.assign({}, pageConfig.data);
  return { vm, requests, toasts };
}

function loadBaomingPage() {
  const requests = [];
  const tips = [];
  let pageConfig = null;
  const previous = { getApp: global.getApp, Page: global.Page, wx: global.wx };

  global.getApp = () => ({
    globalData: { user_id: 9, features: {} },
    getUserID: () => 9,
    isDevEnv: () => false,
    tips: message => tips.push(message),
    recordConsent: () => Promise.resolve(),
    sendRequest: options => { requests.push(options); }
  });
  global.getCurrentPages = () => [{}];
  global.Page = config => { pageConfig = config; };
  global.wx = {
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
    navigateBack() {}, redirectTo() {}, navigateTo() {}
  };

  delete require.cache[BAOMING_PAGE];
  try { require(BAOMING_PAGE); } finally {
    global.getApp = previous.getApp;
    global.Page = previous.Page;
    global.wx = previous.wx;
  }

  const vm = Object.assign({}, pageConfig, {
    setData(patch, cb) {
      Object.keys(patch).forEach(key => {
        if (key.indexOf('.') >= 0) {
          const parts = key.split('.');
          let cursor = this.data;
          parts.slice(0, -1).forEach(part => { cursor = cursor[part] || (cursor[part] = {}); });
          cursor[parts[parts.length - 1]] = patch[key];
        } else {
          this.data[key] = patch[key];
        }
      });
      if (cb) cb();
    }
  });
  vm.data = Object.assign({}, pageConfig.data);
  return { vm, requests, tips };
}

test('主题页:闭店时自玩通行证与立即报名都原地拦下,不发下单请求', () => {
  const { vm, requests, toasts } = loadTopicPage();
  vm.data.merchantClosed = true;
  vm.data.info = { id: 500, activityList: [{ id: 61 }] };

  vm.selfPlayBuy();
  assert.ok(toasts.includes(CLOSED_HINT), '买通行证必须先给「商家暂停营业」提示');
  vm.bmClick();
  assert.ok(toasts.filter(t => t === CLOSED_HINT).length >= 2, '立即报名也要给同一句提示');
  assert.equal(requests.length, 0, '闭店时不得发出任何请求');
  assert.equal(vm.data.sessionPicker.show, false, '闭店时不能打开选场次弹层');
});

test('主题页:未闭店时两个入口照常放行(负控)', () => {
  const { vm, toasts } = loadTopicPage();
  vm.data.merchantClosed = false;
  vm.data.info = { id: 500, activityList: [{ id: 61 }] };

  vm.bmClick();
  assert.equal(vm.data.sessionPicker.show, true, '营业中必须能打开选场次弹层');
  assert.ok(!toasts.includes(CLOSED_HINT));
});

test('活动报名页:闭店时 handlePayment 原地拦下并提示,不发建单请求', () => {
  const { vm, requests, tips } = loadBaomingPage();
  vm.data.pageState = 'ready';
  vm.data.merchantClosed = true;
  vm.data.selectedTicket = { id: 9, price: 30 };
  vm.data.selectedAddress = { id: 1 };

  vm.handlePayment();
  assert.ok(tips.includes(CLOSED_HINT), '报名入口必须给「商家暂停营业」提示');
  assert.equal(requests.length, 0, '闭店时不得发出建单请求');
});

test('活动报名页:闭店时 canPay 必须为假(按钮不可点),未闭店不受影响', () => {
  const { vm } = loadBaomingPage();
  const base = {
    pageState: 'ready', selectedTicket: { id: 9, price: 30 }, selectedAddress: { id: 1 },
    hostShareChecked: true, totalAmount: 30, paymentReady: true, isPaying: false,
    ticketSoldOut: false, waitlistState: 'NONE', waitlistEligibility: 'ELIGIBLE'
  };
  Object.assign(vm.data, base);

  vm.data.merchantClosed = false;
  vm.refreshPaymentState();
  assert.equal(vm.data.canPay, true, '营业中的正常报名不能被误禁');
  vm.data.merchantClosed = true;
  vm.refreshPaymentState();
  assert.equal(vm.data.canPay, false, '闭店时付款按钮必须禁用');
});

test('两个入口的详情回包必须把 merchantClosed 带进页面状态(静态接线)', () => {
  const topicJs = fs.readFileSync(TOPIC_PAGE, 'utf8');
  const baomingJs = fs.readFileSync(BAOMING_PAGE, 'utf8');
  const topicWxml = fs.readFileSync(path.resolve(XCX, 'pages/topic/index/index.wxml'), 'utf8');
  const baomingWxml = fs.readFileSync(path.resolve(XCX, 'pages/activity/baoming/baoming.wxml'), 'utf8');

  assert.match(topicJs, /merchantClosed: res\.data\.merchantClosed === true/,
    '主题详情回包要落到页面 merchantClosed(严格 true,未知不冒充闭店)');
  assert.match(baomingJs, /merchantClosed: activityInfo\.merchantClosed === true/,
    '活动详情回包要落到页面 merchantClosed');
  assert.match(topicWxml, /bm-closed[^>]*>商家暂停营业，暂不可报名</,
    '主题页下单入口要有可见提示');
  assert.match(baomingWxml, /bm-closed[^>]*>商家暂停营业，暂不可报名</,
    '报名页下单入口要有可见提示');
});
