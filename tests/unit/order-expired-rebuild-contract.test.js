// 2026-09-17 第二轮拍板 #21(B-RPT-1/FOLD3-10):待支付单已过期时,/pay 回「订单已过期,
// 请重新报名」,前端保留旧幂等键 ⇒ 重放永远撞上那张已被关掉的单,用户只能退出重进。
//
// 拍板口径:识别过期后自动换新幂等键、走正常建单接口重建(同样票种/数量/报名信息),
// 拉起支付让玩家无感;重建失败才提示,且不得绕过闭店/名额/报价等建单校验。
//
// 本文件钉住:
//   ① 判据可机器识别(业务 code 410;文案兜底兼容旧 jar),且与后端两端对齐;
//   ② 报名页与主题自玩页:过期 → 换新键重建 → 继续拉起微信支付,全程零提示;
//   ③ 重建走的是 /api/registration/create(不是绕过校验的第二条造单路径);
//   ④ 重建失败/二次过期 → 退回可见提示,且不会无限重建;
//   ⑤ 非过期失败照旧不重建(不能把所有 /pay 失败都当成过期)。
const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isOrderExpiredFailure, isTerminalOrderConflict, ORDER_EXPIRED_USER_MESSAGE, ORDER_REBUILD_REQUIRED,
} = require('../../utils/checkout/checkout-workflow.js');

const BAOMING_PATH = path.resolve(__dirname, '../../pages/activity/baoming/baoming.js');
const TOPIC_PATH = path.resolve(__dirname, '../../pages/topic/index/index.js');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXPIRED_COPY = '订单已过期,请重新报名';

const FULL_PAY_PARAMS = {
  timeStamp: '1720000000', nonceStr: 'nonce', package: 'prepay_id=rebuilt',
  signType: 'RSA', paySign: 'sig',
};

let sandbox;

function installGlobals() {
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44, user_id: 9 },
    getUserType: () => 1,
    getUserID: () => 9,
    tips: message => sandbox.toasts.push(message),
    sendRequest: options => {
      sandbox.requests.push(options);
      return { abort: () => { sandbox.aborts += 1; } };
    },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback || '未知错误',
    getPageSize: () => 10,
    recordConsent: input => {
      sandbox.consentInputs.push(input);
      const settled = { then(resolve) { resolve(); return settled; }, catch() { return settled; } };
      return settled;
    },
    goBack: () => {},
    isDevEnv: () => false,
  });
  global.Page = config => { sandbox.pageConfig = config; };
  global.Component = config => {
    sandbox.pageConfig = Object.assign({}, config.methods, { data: config.data });
  };
  global.wx = {
    showLoading: () => { sandbox.loadingCalls += 1; },
    hideLoading: () => { sandbox.loadingHiddenCount += 1; },
    showToast: opts => { sandbox.toasts.push(opts.title); },
    showModal: opts => { sandbox.modals.push(opts); if (opts.success) opts.success({ confirm: true }); },
    showActionSheet: opts => { sandbox.actionSheet = opts; },
    requestPayment: opts => { sandbox.payments.push(opts); },
    requestSubscribeMessage: opts => { if (opts.success) opts.success({}); },
    navigateTo: opts => sandbox.navigations.push(opts.url),
    redirectTo: opts => sandbox.navigations.push(opts.url),
    reLaunch: opts => sandbox.navigations.push(opts.url),
    navigateBack: () => {},
    getStorageSync: () => '',
    setStorageSync: () => {},
    getSystemInfo: opts => opts && opts.success && opts.success({ windowHeight: 800 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    createSelectorQuery: () => ({
      in: function () { return this; },
      select: () => ({ boundingClientRect: cb => { if (cb) cb({}); return { exec: () => {} }; } }),
      selectViewport: () => ({ scrollOffset: cb => { if (cb) cb({ scrollTop: 0 }); return { exec: () => {} }; } }),
    }),
    setClipboardData: () => {},
  };
}

function loadModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  delete require.cache[require.resolve('../../utils/loading.js')];
  require(modulePath);
  const vm = Object.assign({}, sandbox.pageConfig, {
    setData(patch, cb) {
      if (!this.data) this.data = {};
      Object.assign(this.data, patch);
      if (cb) cb();
    },
  });
  vm.data = Object.assign({}, sandbox.pageConfig.data);
  return vm;
}

beforeEach(() => {
  sandbox = {
    requests: [], toasts: [], navigations: [], payments: [], modals: [],
    loadingCalls: 0, loadingHiddenCount: 0, consentInputs: [], aborts: 0,
  };
  installGlobals();
});

function httpOk(data) { return { code: '200', data: data || {} }; }

// ---- ① 判据本身 ----

test('#21 过期判据:410 与后端原文都能识别,别的失败不误判', () => {
  assert.equal(isOrderExpiredFailure({ code: 410, msg: EXPIRED_COPY }), true);
  assert.equal(isOrderExpiredFailure({ code: '410' }), true, '后端 JSON 数字到了前端可能是字符串');
  assert.equal(isOrderExpiredFailure({ code: 500, msg: EXPIRED_COPY }), true,
    '旧 jar 还没升级成 410 时,文案兜底也要能识别');
  assert.equal(isOrderExpiredFailure({ code: 500, msg: '支付服务暂不可用，请稍后再试' }), false,
    '不能把所有 /pay 失败都当成过期去重建订单');
  assert.equal(isOrderExpiredFailure(null), false);
  assert.equal(isOrderExpiredFailure({ code: 200, data: {} }), false);
});

test('#21 两端对齐:前端兜底文案与后端拒绝原文逐字一致,后端确有 410 映射', () => {
  assert.equal(ORDER_EXPIRED_USER_MESSAGE, EXPIRED_COPY,
    '重建失败时的兜底话术必须与后端拒绝原文同源');
  const service = fs.readFileSync(path.join(REPO_ROOT,
    'chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/CmsRegistrationServiceImpl.java'), 'utf8');
  assert.ok(service.includes('new RegistrationOrderExpiredException("' + EXPIRED_COPY + '")'),
    'Python 侧文案漂移会让「重建失败才提示」显示错误的话术');
  const controller = fs.readFileSync(path.join(REPO_ROOT,
    'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiRegistrationController.java'), 'utf8');
  assert.equal((controller.match(/new AjaxResult\(410, e\.getMessage\(\)\)/g) || []).length, 2,
    '/pay 与 /pay/app 都必须把过期映射成业务 code 410');
});

// ---- ①b fix-be-0917(B-R2):/create 的终态单冲突 409 ----
// 该分支把「同一 requestId 对应的单已取消(3)/已过期(4)」从「重放旧单」改成 409 拒绝,
// 文案「该幂等键对应的报名已取消/已过期，请重新发起报名」。报名页旧逻辑把所有 409 都当
// 「价格已更新」,用户会被提示重报价却永远走不出去 —— 这里钉住按 msg 分流。

const TERMINAL_CANCELLED = '该幂等键对应的报名已取消，请重新发起报名';
const TERMINAL_EXPIRED = '该幂等键对应的报名已过期，请重新发起报名';

test('#21 终态单冲突判据:只认 409 + 该幂等键对应报名文案,价格变更 409 不误判', () => {
  assert.equal(isTerminalOrderConflict({ code: 409, msg: TERMINAL_CANCELLED }), true);
  assert.equal(isTerminalOrderConflict({ code: '409', msg: TERMINAL_EXPIRED }), true);
  assert.equal(isTerminalOrderConflict({ code: 409, msg: '价格已更新，请重新确认' }), false,
    '价格变更 409 必须继续走重报价逻辑');
  assert.equal(isTerminalOrderConflict({ code: 409, msg: '该幂等键已用于不同的报名内容，请重新提交' }), false,
    '内容冲突不是终态单,不在本次拍板范围');
  assert.equal(isTerminalOrderConflict({ code: 500, msg: TERMINAL_EXPIRED }), false);
  assert.equal(isTerminalOrderConflict(null), false);
});

// release-0917 集成:fix-player 按 msg 前缀分流,fix-be 的后端原文一旦漂移,前端会退回「价格已更新」
// 旧行为而不报错 —— 两端必须逐字钉住(读后端源码,不信注释)。
test('#21 两端对齐:fix-be 终态单冲突 409 原文与前端判据逐字一致', () => {
  const orderService = fs.readFileSync(path.join(REPO_ROOT,
    'chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/RegistrationOrderServiceImpl.java'), 'utf8');
  assert.ok(orderService.includes('"' + TERMINAL_CANCELLED + '"'), '后端「已取消」终态冲突原文必须与前端测试常量逐字一致');
  assert.ok(orderService.includes('"' + TERMINAL_EXPIRED + '"'), '后端「已过期」终态冲突原文必须与前端测试常量逐字一致');
  assert.equal(isTerminalOrderConflict({ code: 409, msg: TERMINAL_CANCELLED }), true);
  assert.equal(isTerminalOrderConflict({ code: 409, msg: TERMINAL_EXPIRED }), true);
});

// ---- ② 报名页(baoming) ----

function loadBaomingCheckout() {
  const vm = loadModule(BAOMING_PATH);
  vm.data.pageState = 'ready';
  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 7, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000', email: '', point: 100 };
  vm.data.hostShareChecked = true;
  vm.data.hostShareConsentReady = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_abc';
  vm._initWorkflow();
  return vm;
}

function replayThenExpire(vm) {
  // 第一次建单重放命中已有订单(后端对重放不下发 payParams)
  vm.handlePayment();
  sandbox.requests[0].success({ code: 200, data: { registrationId: 1001, payableAmount: 50, payParams: null } });
  // 旧单已过期:/pay 拒绝(410)
  sandbox.requests[1].success({ code: 410, msg: EXPIRED_COPY });
}

test('baoming:过期待支付单自动换新幂等键重建并继续拉起支付,全程零提示', () => {
  const vm = loadBaomingCheckout();
  replayThenExpire(vm);

  assert.equal(sandbox.requests.length, 3, '过期后必须自动追一次重建请求');
  const firstKey = JSON.parse(sandbox.requests[0].data).requestId;
  const rebuilt = sandbox.requests[2];
  assert.equal(rebuilt.url, '/api/registration/create', '重建必须走正常建单接口,不许绕过校验');
  const rebuiltBody = JSON.parse(rebuilt.data);
  assert.notEqual(rebuiltBody.requestId, firstKey, '继续用旧键只会重放那张已关掉的单');
  assert.equal(rebuiltBody.ticketId, 7, '同样的票种');
  assert.equal(rebuiltBody.realName, '测试');
  assert.equal(rebuiltBody.phone, '13800138000');
  assert.equal(sandbox.toasts.length, 0, '玩家无感:过期重建不得先弹一句错误');
  assert.equal(vm.data.submitError, '', '页内也不能留可见错误');

  rebuilt.success(httpOk({ registrationId: 1002, payableAmount: 50, payParams: FULL_PAY_PARAMS }));
  assert.equal(sandbox.payments.length, 1, '重建成功后必须继续拉起微信支付');
});

// release-0917 集成(第三阶段 C):fix-player 的过期自动换单 + fix-consent 的支付成功同意勾选 + rule-merchant 闭店闸
// 三者同改 baoming.js。钉住:过期换键重建后付款成功,走的仍是同一个成功面板,商家营销同意勾选行照样出现。
test('baoming:过期自动换单后付款成功,成功面板同样出现商家营销同意勾选', () => {
  const vm = loadBaomingCheckout();
  vm.data.activityInfo = { memberId: 900, merchantClosed: false };
  replayThenExpire(vm);

  const rebuilt = sandbox.requests[2];
  assert.equal(rebuilt.url, '/api/registration/create');
  rebuilt.success(httpOk({ registrationId: 1002, payableAmount: 50, payParams: FULL_PAY_PARAMS }));
  assert.equal(sandbox.payments.length, 1, '重建成功后拉起微信支付');
  sandbox.payments[0].success();
  const verify = sandbox.requests.filter(r => r.url === '/api/registration/info').pop();
  assert.ok(verify, '付款后按后端终态确认');
  verify.success(httpOk({ paymentStatus: 2, registrationStatus: 2 }));

  assert.equal(vm.data.resultSheet.show, true);
  assert.equal(vm.data.resultSheet.kind, 'success', '重建单付款成功走同一个成功面板');
  const load = sandbox.requests.filter(r => r.url === '/api/merchant/crm/marketing-consents').pop();
  assert.ok(load, '成功面板必须去取这单背后商家的同意状态');
  load.success({ code: 200, data: [{ merchantRowId: 77, merchantOwnerMemberId: 900, merchantName: '旧城咖啡', inAppOptedIn: false }] });
  // 本文件的 setData 桩是浅合并,页面用的是 'resultSheet.consentName' 点路径写法,按原样取键。
  assert.equal(vm.data['resultSheet.consentName'], '旧城咖啡', '换单后的成功面板同样出现同意勾选行');
  assert.equal(vm.data['resultSheet.consentChecked'], false, '默认不勾');
});

test('baoming:重建失败才提示,且不再自动重建', () => {
  const vm = loadBaomingCheckout();
  replayThenExpire(vm);

  sandbox.requests[2].success({ code: '500', msg: '该票种已售罄' });

  assert.equal(sandbox.requests.length, 3, '重建失败后不得反复建单');
  assert.equal(vm.data.isPaying, false, '失败必须解锁提交态给用户重试');
  assert.ok(sandbox.toasts.includes('该票种已售罄'), '重建失败的原因必须可见');
  assert.equal(vm.data.submitError, '该票种已售罄');
});

test('baoming:重建出来的单仍然过期时退回可见提示,不会无限重建', () => {
  const vm = loadBaomingCheckout();
  replayThenExpire(vm);

  sandbox.requests[2].success({ code: 200, data: { registrationId: 1002, payableAmount: 50, payParams: null } });
  sandbox.requests[3].success({ code: 410, msg: EXPIRED_COPY });

  const creates = sandbox.requests.filter(r => r.url === '/api/registration/create');
  assert.equal(creates.length, 2, '每次结账意图只自动重建一次');
  assert.ok(sandbox.toasts.includes(EXPIRED_COPY), '两次都过期才显示原来的过期文案');
  assert.equal(vm.data.isPaying, false, '不能把提交态永久锁死');
  assert.ok(sandbox.loadingHiddenCount > 0, '失败收尾必须关掉 loading');
});

test('baoming:非过期失败不换键重建(支付服务不可用照旧原样提示)', () => {
  const vm = loadBaomingCheckout();
  vm.handlePayment();
  sandbox.requests[0].success({ code: 200, data: { registrationId: 1001, payableAmount: 50, payParams: null } });
  sandbox.requests[1].success({ code: 503, msg: '支付服务暂不可用，请稍后再试' });

  assert.equal(sandbox.requests.length, 2, '只有确认过期才重建');
  assert.equal(vm.data.isPaying, false);
  assert.ok(sandbox.toasts.includes('支付服务暂不可用，请稍后再试'));
});

test('baoming:终态单冲突(已取消)409 自动换新键重建,不再误报「价格已更新」', () => {
  const vm = loadBaomingCheckout();
  vm.handlePayment();
  const firstKey = JSON.parse(sandbox.requests[0].data).requestId;
  sandbox.requests[0].success({ code: 409, msg: TERMINAL_CANCELLED });

  assert.equal(sandbox.requests.length, 2, '终态单冲突必须直接换键重建,不再重报价');
  assert.equal(sandbox.requests.some(r => r.url === '/api/registration/quote'), false,
    '终态单冲突不是价格变更,不该走重报价');
  const rebuiltBody = JSON.parse(sandbox.requests[1].data);
  assert.equal(sandbox.requests[1].url, '/api/registration/create');
  assert.notEqual(rebuiltBody.requestId, firstKey, '旧键对应的单已取消,必须换新键');
  assert.deepEqual(sandbox.toasts, [], '玩家无感:不得先弹「价格已更新」或过期文案');

  sandbox.requests[1].success(httpOk({ registrationId: 1002, payableAmount: 50, payParams: FULL_PAY_PARAMS }));
  assert.equal(sandbox.payments.length, 1, '重建成功后继续拉起支付');
});

test('baoming:价格变更 409 维持原逻辑(重报价,不换键)', () => {
  const vm = loadBaomingCheckout();
  vm.handlePayment();
  const firstKey = JSON.parse(sandbox.requests[0].data).requestId;
  sandbox.requests[0].success({ code: 409, msg: '价格已更新，请重新确认' });

  assert.ok(sandbox.requests.some(r => r.url === '/api/registration/quote'), '价格变更必须重报价');
  assert.equal(vm.data.isPaying, false);
  assert.ok(sandbox.toasts.includes('价格已更新，请重新确认'));
  assert.equal(vm._reqId, firstKey, '价格变更不换幂等键');
});

test('baoming:终态单冲突重建失败时用后端原文提示,不冒充过期', () => {
  const vm = loadBaomingCheckout();
  vm.handlePayment();
  sandbox.requests[0].success({ code: 409, msg: TERMINAL_CANCELLED });
  sandbox.requests[1].success({ code: '500', msg: '该票种已售罄' });

  assert.equal(sandbox.requests.length, 2, '一次结账意图只自动重建一次');
  assert.ok(sandbox.toasts.includes('该票种已售罄'), '重建失败要提示真实原因');
  assert.equal(vm.data.isPaying, false);
});

test('baoming:重建重入时若建单前置条件已不满足,早退也必须收掉 loading', () => {
  const vm = loadBaomingCheckout();
  vm.handlePayment();
  // 旧键撞终态冲突的同一刻票已售罄:重建重入 handlePayment 会在早退分支只给 tips,
  // 若重建路径不先关 loading,遮罩会把页面永久盖死。
  vm.data.ticketSoldOut = true;
  sandbox.requests[0].success({ code: 409, msg: TERMINAL_CANCELLED });

  assert.equal(sandbox.requests.length, 1, '前置条件不满足时不得继续建单');
  assert.ok(sandbox.loadingHiddenCount > 0, 'loading 遮罩必须被收掉');
  assert.ok(sandbox.toasts.length > 0, '早退原因必须可见');
});

test('baoming:重建后的单再次终态冲突,退回后端原文案而不是过期默认话术', () => {
  const vm = loadBaomingCheckout();
  vm.handlePayment();
  sandbox.requests[0].success({ code: 409, msg: TERMINAL_CANCELLED });
  const secondKey = JSON.parse(sandbox.requests[1].data).requestId;
  sandbox.requests[1].success({ code: 409, msg: TERMINAL_EXPIRED });

  assert.equal(sandbox.requests.length, 2, '不得无限重建');
  assert.notEqual(secondKey, JSON.parse(sandbox.requests[0].data).requestId);
  assert.ok(sandbox.toasts.includes(TERMINAL_EXPIRED), '用户看到的是本次冲突的真实原因');
  assert.equal(sandbox.toasts.includes(EXPIRED_COPY), false, '已取消/已过期的原因不能被替换成 /pay 过期话术');
});

// ---- ③ 主题自玩页(topic) ----

function loadTopicPageWithWorkflow() {
  const vm = loadModule(TOPIC_PATH);
  vm._initWorkflow();
  // RUN-41:建单要带真实姓名+手机号(后端 @NotBlank),资料不全时页面会先拦下来给补全出路。
  // 本文件钉的是过期重建与幂等键,资料齐不齐不是它的变量,所以预置成齐。
  vm._signupProfile = { realName: '张三', phone: '13800001111' };
  return vm;
}

test('topic:自玩过期待支付单自动换新幂等键重建并继续拉起支付', () => {
  const vm = loadTopicPageWithWorkflow();
  vm._createSelfPlayOrder(500);
  sandbox.requests[0].success(httpOk({ registrationId: 1001, payableAmount: 100 }));
  sandbox.requests[1].success({ code: 410, msg: EXPIRED_COPY });

  assert.equal(sandbox.requests.length, 3);
  const firstKey = JSON.parse(sandbox.requests[0].data).requestId;
  assert.equal(sandbox.requests[2].url, '/api/registration/create');
  const rebuiltBody = JSON.parse(sandbox.requests[2].data);
  assert.notEqual(rebuiltBody.requestId, firstKey, '过期的旧键必须作废');
  assert.equal(rebuiltBody.ownerType, 1);
  assert.equal(rebuiltBody.ownerId, 500);
  assert.equal(sandbox.toasts.length, 0, '玩家无感');

  sandbox.requests[2].success(httpOk({ registrationId: 1002, payableAmount: 100, payParams: FULL_PAY_PARAMS }));
  assert.equal(sandbox.payments.length, 1);
});

test('topic:重建失败提示原因;二次过期退回原文案且不无限重建', () => {
  const failed = loadTopicPageWithWorkflow();
  failed._createSelfPlayOrder(500);
  sandbox.requests[0].success(httpOk({ registrationId: 1001, payableAmount: 100 }));
  sandbox.requests[1].success({ code: 410, msg: EXPIRED_COPY });
  sandbox.requests[2].success({ code: '500', msg: '支付服务暂不可用' });
  assert.equal(sandbox.requests.length, 3);
  assert.ok(sandbox.toasts.includes('支付服务暂不可用'));

  const base = sandbox.requests.length;
  const twice = loadTopicPageWithWorkflow();
  twice._createSelfPlayOrder(500);
  const at = i => sandbox.requests[base + i];
  at(0).success(httpOk({ registrationId: 1001, payableAmount: 100 }));
  at(1).success({ code: 410, msg: EXPIRED_COPY });
  at(2).success(httpOk({ registrationId: 1002, payableAmount: 100 }));
  at(3).success({ code: 410, msg: EXPIRED_COPY });
  assert.equal(sandbox.requests.slice(base).filter(r => r.url === '/api/registration/create').length, 2,
    '一次购买意图只自动重建一次');
  assert.ok(sandbox.toasts.includes(EXPIRED_COPY));
});

test('topic:终态单冲突(已过期)409 自动换新键重建并继续拉起支付', () => {
  const vm = loadTopicPageWithWorkflow();
  vm._createSelfPlayOrder(500);
  const firstKey = JSON.parse(sandbox.requests[0].data).requestId;
  sandbox.requests[0].success({ code: 409, msg: TERMINAL_EXPIRED });

  assert.equal(sandbox.requests.length, 2);
  assert.equal(sandbox.requests[1].url, '/api/registration/create');
  assert.notEqual(JSON.parse(sandbox.requests[1].data).requestId, firstKey);
  assert.deepEqual(sandbox.toasts, [], '玩家无感');

  sandbox.requests[1].success(httpOk({ registrationId: 1002, payableAmount: 100, payParams: FULL_PAY_PARAMS }));
  assert.equal(sandbox.payments.length, 1);
});

test('baoming:连续两次终态冲突后,用户再点一次仍是全新一单(旧键已作废,不卡死)', () => {
  const vm = loadBaomingCheckout();
  vm.handlePayment();
  sandbox.requests[0].success({ code: 409, msg: TERMINAL_CANCELLED });
  sandbox.requests[1].success({ code: 409, msg: TERMINAL_EXPIRED });
  assert.equal(sandbox.requests.length, 2, '自动重建只做一次');

  // 用户按提示再点一次「付款」:必须换新键,而不是拿旧键继续撞同一堵墙
  vm.handlePayment();
  assert.equal(sandbox.requests.length, 3);
  const stuckKey = JSON.parse(sandbox.requests[1].data).requestId;
  const freshKey = JSON.parse(sandbox.requests[2].data).requestId;
  assert.notEqual(freshKey, stuckKey, '旧键已在重建检测点作废,重试必须是新键');
});

// ---- ④ 负控:把「换新键」改回「保留旧键」必须真红 ----

test('#21 负控:重建时不清旧幂等键必须判红(旧行为重放已关单)', () => {
  const source = fs.readFileSync(BAOMING_PATH, 'utf8');
  // 负控把「检测到旧键不可用时作废旧键」摘掉(旧行为:保留旧键重放)
  const broken = source.replace(
    `              that._reqId = null;
              that._rebuildFallbackMessage = res.msg || '';
              cb({ ok: false, msg: ORDER_REBUILD_REQUIRED });`,
    `              that._rebuildFallbackMessage = res.msg || '';
              cb({ ok: false, msg: ORDER_REBUILD_REQUIRED });`);
  assert.notEqual(broken, source, '负控锚点失效:终态冲突分支的 _reqId 清理未命中');

  const Module = require('node:module');
  delete require.cache[require.resolve(BAOMING_PATH)];
  delete require.cache[require.resolve('../../utils/loading.js')];
  const m = new Module(BAOMING_PATH, null);
  m.filename = BAOMING_PATH;
  m.paths = Module._nodeModulePaths(path.dirname(BAOMING_PATH));
  m._compile(broken, BAOMING_PATH);

  const vm = Object.assign({}, sandbox.pageConfig, {
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb(); },
  });
  vm.data = Object.assign({}, sandbox.pageConfig.data);
  vm.data.pageState = 'ready';
  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 7, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000', email: '' };
  vm.data.hostShareChecked = true;
  vm.data.hostShareConsentReady = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_abc';
  vm._initWorkflow();
  vm.handlePayment();
  sandbox.requests[0].success({ code: 409, msg: TERMINAL_CANCELLED });

  const rebuiltBody = JSON.parse(sandbox.requests[1].data);
  const firstKey = JSON.parse(sandbox.requests[0].data).requestId;
  assert.equal(rebuiltBody.requestId, firstKey,
    '负控必须真的保留旧键(旧行为),否则这条负控没在证明换键是修复的必要条件');
});
