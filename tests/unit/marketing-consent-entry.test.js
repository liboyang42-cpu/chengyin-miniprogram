// 商家营销消息同意入口(2026-09-17 用户拍板第 40 条 A):
//   下单/核销成功后可选勾选「接收该商家的活动消息」,默认不勾、失败可见可重试、不打断主流程。
//
// 行为测试:真装页面/组件进沙箱,断言真实发出的请求与屏幕状态;另有一条负控式断言
// (已同意 / 无匹配 / 有歧义一律不出现)。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { flattenComponentToPage } = require('../helpers/component-as-page.js');

const ROOT = path.resolve(__dirname, '../..');
const TOPIC_JS = path.join(ROOT, 'pages/topic/index/index.js');
const BAOMING_JS = path.join(ROOT, 'pages/activity/baoming/baoming.js');
const ORDER_JS = path.join(ROOT, 'components/cy/scene-member-order-detail/index.js');
const util = require(path.join(ROOT, 'utils/marketing-consent-entry.js'));

const OFFER_ROW = {
  merchantRowId: 77,
  merchantOwnerMemberId: 900,
  merchantName: '旧城咖啡',
  inAppOptedIn: false,
  couponOptedIn: false,
};

function makeSetData(holder) {
  // 与真机同形:支持 'a.b' 路径写入,否则「勾选行出现了没有」这类断言会假绿。
  return function setData(patch, cb) {
    Object.keys(patch || {}).forEach((key) => {
      if (key.indexOf('.') === -1) { holder[key] = patch[key]; return; }
      const parts = key.split('.');
      let cursor = holder;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
        cursor = cursor[parts[i]];
      }
      cursor[parts[parts.length - 1]] = patch[key];
    });
    if (cb) cb();
  };
}

function installGlobals() {
  const sandbox = { requests: [], toasts: [], navigations: [] };
  global.getApp = () => ({
    globalData: {},
    getUserType: () => 1,
    tips: m => sandbox.toasts.push(m),
    sendRequest: options => { sandbox.requests.push(options); },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  });
  global.Page = config => { sandbox.pageConfig = config; };
  global.Component = config => { sandbox.pageConfig = flattenComponentToPage(config); };
  global.wx = {
    showToast: o => sandbox.toasts.push(o && o.title),
    showLoading() {}, hideLoading() {},
    navigateTo: o => sandbox.navigations.push(o && o.url),
    redirectTo: o => sandbox.navigations.push(o && o.url),
    getStorageSync: () => '', setStorageSync() {},
  };
  return sandbox;
}

function mountPage(modulePath, sandbox) {
  delete require.cache[modulePath];
  require(modulePath);
  const vm = Object.assign({}, sandbox.pageConfig, sandbox.pageConfig.methods || {});
  vm.data = JSON.parse(JSON.stringify(sandbox.pageConfig.data || {}));
  vm.setData = makeSetData(vm.data);
  return vm;
}

function requestsOf(sandbox, url) {
  return sandbox.requests.filter(r => r.url === url);
}

test('pickOffer:只认服务端下发的 owner 匹配行;已同意 / 有歧义 / 无匹配一律不出', () => {
  assert.equal(util.pickOffer([OFFER_ROW], 900).merchantRowId, 77);
  assert.equal(util.pickOffer([Object.assign({}, OFFER_ROW, { inAppOptedIn: true })], 900), null,
    '已同意过的商家不得再出现');
  assert.equal(util.pickOffer([OFFER_ROW, Object.assign({}, OFFER_ROW, { merchantRowId: 78 })], 900), null,
    '同 owner 多行=归属有歧义,必须 fail-closed');
  assert.equal(util.pickOffer([OFFER_ROW], 901), null, 'owner 对不上不出');
  assert.equal(util.pickOffer([], 900), null);
  assert.equal(util.pickOffer(null, 900), null);
});

test('自玩通行证:买完面板先照常自愈;商家可用时出现勾选行,勾选走的正是既有 POST 合同', () => {
  const sandbox = installGlobals();
  const vm = mountPage(TOPIC_JS, sandbox);
  vm.data.info = { id: 500, memberId: 900 };

  vm._goSelfPlay.call(vm, 500);

  assert.equal(vm.data.resultSheet.show, true, '面板照常弹出');
  assert.equal(vm.data.resultSheet.duration, 2000, '未勾选时自动收时长不变(不打断主流程)');
  assert.equal(vm.data.resultSheet.consentName, '', '商家信息没回来之前不占位');

  const load = requestsOf(sandbox, '/api/merchant/crm/marketing-consents')[0];
  assert.ok(load, '必须以订单 owner memberId 读一次同意列表');
  assert.equal(load.method, 'GET');
  load.success({ code: 200, data: [Object.assign({}, OFFER_ROW)] });
  assert.equal(vm.data.resultSheet.consentName, '旧城咖啡');
  assert.equal(vm.data.resultSheet.consentChecked, false, '默认不勾');
  assert.equal(vm.data.resultSheet.consentState, 'idle');

  vm.onResultConsentChange.call(vm, { detail: { checked: true } });
  const posts = requestsOf(sandbox, '/api/merchant/crm/marketing-consents').filter(r => r.method === 'POST');
  assert.equal(posts.length, 1);
  assert.notEqual(posts[0].silentError, true, '保存是用户主动动作,失败不许静默(只有附属读取静默)');
  const body = JSON.parse(posts[0].data);
  assert.equal(body.merchantRowId, 77);
  assert.equal(body.merchantOwnerMemberId, 900);
  assert.equal(body.channel, 'IN_APP');
  assert.equal(body.optedIn, true);
  assert.match(body.requestId, /^[A-Za-z0-9._:-]{6,64}$/, 'requestId 必须过后端格式闸');
  assert.equal(vm.data.resultSheet.consentState, 'saving');

  posts[0].success({ code: 200, data: { id: 1 } });
  assert.equal(vm.data.resultSheet.consentState, 'saved', '成功态落在面板内那行回执上,不靠 toast');
});

test('保存失败必须留在面板内可见并可重试;重试复用同一个 requestId(不写第二条同意)', () => {
  const sandbox = installGlobals();
  const vm = mountPage(TOPIC_JS, sandbox);
  vm.data.info = { id: 500, memberId: 900 };
  vm._goSelfPlay.call(vm, 500);
  requestsOf(sandbox, '/api/merchant/crm/marketing-consents')[0].success({ code: 200, data: [OFFER_ROW] });

  vm.onResultConsentChange.call(vm, { detail: { checked: true } });
  const posts = () => requestsOf(sandbox, '/api/merchant/crm/marketing-consents').filter(r => r.method === 'POST');
  posts()[0].success({ code: 409, msg: '授权状态保存失败' });

  assert.equal(vm.data.resultSheet.consentState, 'failed');
  assert.match(vm.data.resultSheet.consentError, /保存失败|授权/, '失败原因必须落在面板内');
  assert.equal(vm.data.resultSheet.consentChecked, true, '失败后勾选态保留,不偷偷回退');

  vm.onResultConsentRetry.call(vm);
  const second = posts()[1];
  assert.ok(second, '重试必须真的再发一次');
  assert.equal(JSON.parse(second.data).requestId, JSON.parse(posts()[0].data).requestId,
    '同一次勾选意图的重试复用同一 requestId,服务端才能识别重放');
  second.success({ code: 200, data: { id: 1 } });
  assert.equal(vm.data.resultSheet.consentState, 'saved');
});

test('活动报名:结果面板同样接线;商家已同意 / 拿不到商家时整行不出现', () => {
  const sandbox = installGlobals();
  const vm = mountPage(BAOMING_JS, sandbox);
  vm.data.activityInfo = { id: 9, memberId: 900 };

  vm.showSignupSuccess.call(vm, { title: '支付成功', detail: '票已放入票夹' });
  const load = requestsOf(sandbox, '/api/merchant/crm/marketing-consents')[0];
  assert.ok(load, '必须以活动 owner memberId 读同意列表');
  load.success({ code: 200, data: [Object.assign({}, OFFER_ROW, { inAppOptedIn: true })] });
  assert.equal(vm.data.resultSheet.consentName, '', '已同意过的不再出现');

  sandbox.requests.length = 0;
  vm.showSignupSuccess.call(vm, { title: '支付成功', detail: '票已放入票夹' });
  const retryLoad = requestsOf(sandbox, '/api/merchant/crm/marketing-consents')[0];
  retryLoad.success({ code: 200, data: [] });
  assert.equal(vm.data.resultSheet.consentName, '', '没有生效商家关系时整行不出现');

  sandbox.requests.length = 0;
  vm.showSignupSuccess.call(vm, { title: '支付成功', detail: '票已放入票夹' });
  const failedLoad = requestsOf(sandbox, '/api/merchant/crm/marketing-consents')[0];
  // 2026-09-17 总控裁定:支付刚成功就弹通道默认「网络错误」会让玩家以为没付成功 —— 这条附属读取必须静默,
  // 失败只隐藏勾选行;保存(POST)不在此列,仍要可见。
  assert.equal(failedLoad.silentError, true, '支付成功面板上取商家信息失败不得弹通道默认错误 toast');
  failedLoad.fail({ errMsg: 'timeout' });
  assert.equal(vm.data.resultSheet.consentName, '', '拿不到就 fail-closed,不硬塞一行会失败的勾选');
  assert.deepEqual(sandbox.toasts, [], '读取失败不出任何提示,主流程(自愈跳转)不受影响');
});

test('订单详情:已支付成功(含不核销的自玩通行证)即出同意行;未支付不出不查;owner 从订单回执取', () => {
  const sandbox = installGlobals();
  // 2026-09-17 总控裁定:门槛从「权益已核销」放宽为「已支付成功」。先钉反面:待支付且未核销的单不出、不白查。
  const unpaid = mountPage(ORDER_JS, sandbox);
  unpaid.data.orderId = '1000';
  unpaid.onLoad();
  requestsOf(sandbox, '/api/registration/info')[0].success({ code: '200', data: {
    id: 1000, ownerType: 1, registrationStatus: 1, paymentStatus: 0, verificationStatus: 0,
    cmsTopic: { id: 7, memberId: 900, name: '城市迷雾' },
  } });
  assert.equal(unpaid.data.consentOffer.show, false, '未支付的单不出同意行');
  assert.equal(requestsOf(sandbox, '/api/merchant/crm/marketing-consents').length, 0, '未支付不白查一次同意列表');

  const vm = mountPage(ORDER_JS, sandbox);
  vm.data.orderId = '1001';
  vm.onLoad();
  const infoReq = requestsOf(sandbox, '/api/registration/info')[1];
  infoReq.success({ code: '200', data: {
    id: 1001, ownerType: 1, registrationStatus: 2, paymentStatus: 2, verificationStatus: 0,
    cmsTopic: { id: 7, memberId: 900, name: '城市迷雾' },
  } });
  const paidLoad = requestsOf(sandbox, '/api/merchant/crm/marketing-consents').slice(-1)[0];
  assert.ok(paidLoad, '已支付未核销(自玩通行证等不核销的票)也要读同意列表');
  paidLoad.success({ code: 200, data: [OFFER_ROW] });
  assert.equal(vm.data.consentOffer.show, true, '已支付成功即出同意行');
  assert.equal(vm.data.consentChecked, false, '默认不勾');
  // 其余口径不变:已同意不再出现、同 owner 多门店 fail-closed
  const agreed = mountPage(ORDER_JS, sandbox);
  agreed.data.orderId = '1003';
  agreed.onLoad();
  requestsOf(sandbox, '/api/registration/info').slice(-1)[0].success({ code: '200', data: {
    id: 1003, ownerType: 1, registrationStatus: 2, paymentStatus: 2, verificationStatus: 0,
    cmsTopic: { id: 7, memberId: 900, name: '城市迷雾' },
  } });
  requestsOf(sandbox, '/api/merchant/crm/marketing-consents').slice(-1)[0]
    .success({ code: 200, data: [Object.assign({}, OFFER_ROW, { inAppOptedIn: true })] });
  assert.equal(agreed.data.consentOffer.show, false, '已同意过的商家不再出现');
  const ambiguous = mountPage(ORDER_JS, sandbox);
  ambiguous.data.orderId = '1004';
  ambiguous.onLoad();
  requestsOf(sandbox, '/api/registration/info').slice(-1)[0].success({ code: '200', data: {
    id: 1004, ownerType: 1, registrationStatus: 2, paymentStatus: 2, verificationStatus: 0,
    cmsTopic: { id: 7, memberId: 900, name: '城市迷雾' },
  } });
  requestsOf(sandbox, '/api/merchant/crm/marketing-consents').slice(-1)[0]
    .success({ code: 200, data: [OFFER_ROW, Object.assign({}, OFFER_ROW, { merchantRowId: 78 })] });
  assert.equal(ambiguous.data.consentOffer.show, false, '同 owner 多门店歧义 fail-closed');

  const vm2 = mountPage(ORDER_JS, sandbox);
  vm2.data.orderId = '1002';
  vm2.onLoad();
  requestsOf(sandbox, '/api/registration/info').slice(-1)[0].success({ code: '200', data: {
    id: 1002, ownerType: 2, registrationStatus: 2, paymentStatus: 2, verificationStatus: 1,
    cmsActivity: { id: 8, memberId: 900, name: '夜跑场' },
  } });
  const load = requestsOf(sandbox, '/api/merchant/crm/marketing-consents').slice(-1)[0];
  assert.ok(load, '已核销的单同样读一次同意列表(旧口径保留)');
  assert.equal(load.silentError, true, '订单详情的附属读取失败同样静默,只隐藏同意行');
  load.success({ code: 200, data: [OFFER_ROW] });
  assert.equal(vm2.data.consentOffer.show, true);
  assert.equal(vm2.data.consentOffer.merchantName, '旧城咖啡');
  assert.equal(vm2.data.consentChecked, false);

  vm2.onConsentChange.call(vm2, { detail: { checked: true } });
  const post = requestsOf(sandbox, '/api/merchant/crm/marketing-consents').filter(r => r.method === 'POST').slice(-1)[0];
  const body = JSON.parse(post.data);
  assert.equal(body.merchantRowId, 77);
  assert.equal(body.channel, 'IN_APP');
  assert.equal(body.optedIn, true);
  post.success({ code: 200, data: { id: 2 } });
  assert.equal(vm2.data.consentState, 'saved');
});

test('结果面板:不勾照常自愈;勾了才停表;保存成功短暂停留后照常走 close', () => {
  const timers = [];
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  global.clearTimeout = () => {};
  global.Behavior = () => {};
  let sheet;
  global.Component = c => { sheet = flattenComponentToPage(c); };
  delete require.cache[path.join(ROOT, 'components/cy/result-sheet/index.js')];
  require(path.join(ROOT, 'components/cy/result-sheet/index.js'));
  const vm = Object.assign({}, sheet);
  vm.data = Object.assign({}, sheet.data, { show: true, kind: 'success', duration: 2000, consentName: '旧城咖啡' });
  vm.setData = makeSetData(vm.data);

  vm._schedule();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 2000, '没勾的用户:面板行为与今天完全一致');

  vm.data.consentChecked = true;
  vm.data.consentState = 'saving';
  vm._schedule();
  assert.equal(timers.length, 1, '勾了之后不得再自动收走(保存中还没结果)');

  vm.data.consentState = 'failed';
  vm._schedule();
  assert.equal(timers.length, 1, '保存失败留在原位可重试,不自动收');

  vm.data.consentState = 'saved';
  vm._schedule();
  assert.equal(timers.length, 2);
  assert.equal(timers[1].ms, 1200, '保存成功后短暂停留让人看到回执,然后照常 close');
});

test('两端对齐:三个入口都把同意行接到 cy-consent-check,POST 字段与后端 DTO 同名', () => {
  const topicWxml = fs.readFileSync(path.join(ROOT, 'pages/topic/index/index.wxml'), 'utf8');
  const baomingWxml = fs.readFileSync(path.join(ROOT, 'pages/activity/baoming/baoming.wxml'), 'utf8');
  const orderWxml = fs.readFileSync(path.join(ROOT, 'components/cy/scene-member-order-detail/index.wxml'), 'utf8');
  const sheetWxml = fs.readFileSync(path.join(ROOT, 'components/cy/result-sheet/index.wxml'), 'utf8');
  assert.match(sheetWxml, /cy-consent-check[^>]*checked="\{\{consentChecked\}\}"/);
  assert.match(sheetWxml, /bind:change="onConsentChange"/);
  assert.match(sheetWxml, /bindtap="onConsentRetry"/);
  assert.match(sheetWxml, /可随时在设置里退订/);
  assert.match(topicWxml, /consent-name="\{\{resultSheet\.consentName\}\}"/);
  assert.match(topicWxml, /bind:consentchange="onResultConsentChange"/);
  assert.match(baomingWxml, /consent-name="\{\{resultSheet\.consentName\}\}"/);
  assert.match(orderWxml, /cy-consent-check[^>]*checked="\{\{consentChecked\}\}"/);
  assert.match(orderWxml, /bind:change="onConsentChange"/);
  assert.match(orderWxml, /consentOffer\.merchantName/);
});
