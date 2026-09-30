// H09:订单列表内容与逻辑已搬到 components/cy/scene-member-order-history(页面退化成深链薄壳),
// 断言随之指向组件文件;判据本身一条没放宽。
// Q块 checkout 状态机收敛:页面级支付路径单元测试。
//
// 覆盖:
//  - baoming.js 工作流创建报名、quoteSign 补偿、409 价格变动、hostShareChecked 保留
//  - order.js 重新支付路径、onShow 刷新恢复
//  - 支付成功后的后端终态验证(verifyPayment 轮询),不能只信客户端 SDK success 回调
//  - HTTP 异常时结果未知不盲重试(参照 play-request-recovery.test.js 严谨标准)
const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BAOMING_PATH = path.resolve(__dirname, '../../pages/activity/baoming/baoming.js');
const ORDER_PATH = path.resolve(__dirname, '../../components/cy/scene-member-order-history/index.js');
const ORDERINFO_PATH = path.resolve(__dirname, '../../components/cy/scene-member-order-detail/index.js');

let sandbox;
let loadSpy; // 用于 capture 每个 page require 期间 side-effect

beforeEach(() => {
  sandbox = {
    requests: [],
    toasts: [],
    navigations: [],
    payments: [],
    modals: [],
    loadingCalls: 0,
    loadingHiddenCount: 0,
    consentInputs: [],
    recordConsent: null,
    aborts: 0
  };
  loadSpy = null;

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
      if (sandbox.recordConsent) return sandbox.recordConsent(input);
      const settled = {
        then(resolve) { resolve(); return settled; },
        catch() { return settled; }
      };
      return settled;
    },
    goBack: () => {},
    isDevEnv: () => false
  });
  global.Page = config => { sandbox.pageConfig = config; };
  // H09 之后订单列表是 Component 不是 Page。摊平成同样的形状(data + 方法在一层),
  // 让下面的 loadPage / 断言逐字不变 —— 换的是承载形式,不是被验的行为。
  global.Component = config => {
    sandbox.pageConfig = Object.assign(
      {},
      config.methods,
      { data: config.data },
      config.lifetimes && config.lifetimes.attached ? { onLoad: config.lifetimes.attached } : {},
      config.pageLifetimes && config.pageLifetimes.show ? { onShow: config.pageLifetimes.show } : {}
    );
  };
  global.wx = {
    showLoading: (opts) => { sandbox.loadingCalls++; },
    hideLoading: () => { sandbox.loadingHiddenCount++; },
    showToast: (opts) => { sandbox.toasts.push(opts.title); },
    showModal: (opts) => { sandbox.modals.push(opts); if (opts.success) opts.success({ confirm: true }); },
    showActionSheet: (opts) => { sandbox.actionSheet = opts; },
    requestPayment: (opts) => { sandbox.payments.push(opts); },
    requestSubscribeMessage: (opts) => { if (opts.success) opts.success({}); },
    navigateTo: (opts) => sandbox.navigations.push(opts.url),
    redirectTo: (opts) => sandbox.navigations.push(opts.url),
    navigateBack: () => {},
    getStorageSync: () => '',
    setStorageSync: () => {},
    getSystemInfo: (opts) => opts && opts.success && opts.success({ windowHeight: 800 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    createSelectorQuery: () => ({
      in: function () { return this; },
      select: () => ({ boundingClientRect: (cb) => { if (cb) cb({}); return { exec: () => {} }; } }),
      selectViewport: () => ({ scrollOffset: (cb) => { if (cb) cb({ scrollTop: 0 }); return { exec: () => {} }; } })
    }),
    setClipboardData: () => {}
  };
});

function loadPage(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  // utils/loading.js 的原生回落带 show/hide 计数,跟页面一起重装,别让上一条用例的余额漏进来
  delete require.cache[require.resolve('../../utils/loading.js')];
  require(modulePath);
  const vm = Object.assign({}, sandbox.pageConfig, {
    setData(patch, cb) {
      if (!this.data) this.data = {};
      Object.assign(this.data, patch);
      if (cb) cb();
    }
  });
  vm.data = Object.assign({}, sandbox.pageConfig.data);
  return vm;
}

function httpOk(data) { return { code: '200', data: data || {} }; }

function validRepayData() {
  return {
    registrationId: 1001,
    id: 1001,
    payParams: {
      timeStamp: '1720000000',
      nonceStr: 'nonce',
      package: 'prepay_id=repay',
      signType: 'RSA',
      paySign: 'signature',
    },
  };
}

function malformedRepayCases() {
  const cases = [
    ['data', null],
    ['payParams', { registrationId: 1001, id: 1001 }],
  ];
  for (const field of ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign']) {
    const data = validRepayData();
    delete data.payParams[field];
    cases.push([field, data]);
  }
  return cases;
}

// ---- baoming.js 支付路径 ----

test('baoming:工作流创建报名时带 requestId,quoteSign,使用 JSON body', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.data.pageState = 'ready'; // 详情已就绪:支付路径断言不受加载三态闸门影响

  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000', email: '', point: 100 };
  vm.data.agreementChecked = true;
  vm.data.hostShareChecked = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_abc';
  vm._initWorkflow();

  vm.handlePayment();

  assert.equal(sandbox.requests.length, 1, '应发出一次建单请求');
  const req = sandbox.requests[0];
  assert.equal(req.url, '/api/registration/create');
  assert.equal(req.method, 'POST');
  const body = JSON.parse(req.data);
  assert.equal(body.ownerType, 2);
  assert.equal(body.ownerId, 100);
  assert.equal(body.quoteSign, 'qs_abc');
  assert.ok(body.requestId, '缺少 requestId,幂等键是 BE-03 要求');
});

test('baoming:建单返回 200 空 payload 必须失败关闭提交态，不得进入支付', () => {
  const vm = loadPage(BAOMING_PATH);
  vm.data.pageState = 'ready';
  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000', email: '', point: 100 };
  vm.data.hostShareChecked = true;
  vm.data.hostShareConsentReady = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_abc';
  vm._initWorkflow();

  vm.handlePayment();
  assert.doesNotThrow(() => sandbox.requests[0].success({ code: 200, data: null }));

  assert.equal(vm.data.isPaying, false);
  assert.equal(sandbox.payments.length, 0);
});

test('baoming:建单缺 payableAmount 不得被误判为免费报名成功', () => {
  const vm = loadPage(BAOMING_PATH);
  vm.data.pageState = 'ready';
  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000', email: '', point: 100 };
  vm.data.hostShareChecked = true;
  vm.data.hostShareConsentReady = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_abc';
  vm._initWorkflow();

  vm.handlePayment();
  const data = validRepayData();
  assert.doesNotThrow(() => sandbox.requests[0].success({ code: 200, data }));

  assert.equal(vm.data.isPaying, false);
  assert.equal(sandbox.payments.length, 0);
  assert.equal(vm.data.resultSheet.show, false);   // 2026-09-05 paySuccess → resultSheet(换成共享面板)
});

// B-01:建单重放命中已有订单时后端不下发 payParams(RegistrationCheckoutServiceImpl:107),
// 旧契约把这一档判成「支付参数不完整 → 取消订单」,同一 requestId 再点又重放这张已取消的单,
// 页面永远走不出去。现在照主题自玩页先例,回 /api/registration/pay 取参数继续支付。
function loadBaomingCheckout() {
  const vm = loadPage(BAOMING_PATH);
  vm.data.pageState = 'ready';
  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
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

test('baoming:重放命中已有订单(无 payParams)走 /api/registration/pay 取参数并继续支付', () => {
  const vm = loadBaomingCheckout();

  vm.handlePayment();
  assert.doesNotThrow(() => sandbox.requests[0].success({
    code: 200,
    data: { registrationId: 1001, payableAmount: 50, payParams: null },
  }));

  assert.equal(sandbox.requests.length, 2, '重放单必须追一次取参数请求');
  assert.equal(sandbox.requests[1].url, '/api/registration/pay');
  assert.equal(sandbox.requests[1].data.id, 1001, '取参数必须带上重放命中的报名 id');
  sandbox.requests[1].success(httpOk(Object.assign(validRepayData(), { payableAmount: 50 })));

  assert.equal(sandbox.payments.length, 1, '拿到完整支付参数后才拉起微信支付');
  assert.equal(vm.data.isPaying, true, '支付拉起前不得提前解锁提交态');
  assert.equal(sandbox.requests.some(r => r.url === '/api/registration/cancel'), false,
    '重放单不能被取消');
});

test('baoming:重放取参数失败时不取消订单,保留可重试出口', () => {
  const vm = loadBaomingCheckout();

  vm.handlePayment();
  assert.doesNotThrow(() => sandbox.requests[0].success({
    code: 200,
    data: { registrationId: 1001, payableAmount: 50, payParams: null },
  }));
  sandbox.requests[1].success({ code: '500', msg: '支付服务暂不可用' });

  assert.equal(vm.data.isPaying, false, '取参数失败必须恢复可重试态');
  assert.equal(sandbox.payments.length, 0);
  assert.equal(sandbox.requests.some(r => r.url === '/api/registration/cancel'), false,
    '取参数失败不得顺手取消用户订单');
  assert.ok(String(vm.data.submitError).includes('支付服务暂不可用'), '失败原因必须留在页内');
});

test('baoming:取消订单成功后才换幂等键,下次提交不再重放已取消单', () => {
  const vm = loadBaomingCheckout();
  vm._reqId = 'req_replay';
  vm.data.orderInfo = { registrationId: 1001 };

  vm.cancelPendingOrder({ stayOnPage: true });
  const cancelReq = sandbox.requests.find(r => r.url === '/api/registration/cancel');
  assert.ok(cancelReq, '取消必须发出请求');
  assert.equal(vm._reqId, 'req_replay', '取消还没落库时不得换键');
  cancelReq.success(httpOk({}));
  assert.equal(vm._reqId, null, '取消落库后旧幂等键必须作废,否则重试重放已取消单');
});

test('baoming:hostShareChecked 未勾选时阻止支付,不发请求', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.data.pageState = 'ready'; // 详情已就绪:支付路径断言不受加载三态闸门影响

  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000' };
  vm.data.agreementChecked = true;
  vm.data.hostShareChecked = false;
  vm._initWorkflow();

  vm.handlePayment();

  assert.equal(sandbox.requests.length, 0, 'hostShareChecked 不勾不许下单');
  assert.ok(sandbox.toasts.some(t => t.includes('主办方')));
});

test('baoming:单独同意未落库前不创建报名单,落库后才继续', async () => {
  let resolveConsent;
  sandbox.recordConsent = () => new Promise(resolve => { resolveConsent = resolve; });
  const vm = loadPage(BAOMING_PATH);
  vm.data.pageState = 'ready';
  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000' };
  vm.data.hostShareChecked = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_abc';
  vm._initWorkflow();

  vm.handlePayment();
  assert.equal(sandbox.requests.length, 0, '同意记录仍在途时不得抢先创建报名单');
  assert.equal(vm.data.isPaying, true, '记录同意期间应锁住重复提交');
  assert.equal(vm.data.hostShareConsentReady, false, '同意仍在途时不得把可审计状态标成 ready');

  resolveConsent();
  await Promise.resolve();
  assert.equal(vm.data.hostShareConsentReady, true, '同意落库后必须同步可审计的 checkout 状态');
  assert.equal(sandbox.requests.length, 1, '同意记录成功后才创建报名单');
  assert.equal(sandbox.requests[0].url, '/api/registration/create');
});

test('baoming:单独同意在途时卸载页面,回调成功也不得创建报名单', async () => {
  let resolveConsent;
  sandbox.recordConsent = () => new Promise(resolve => { resolveConsent = resolve; });
  const vm = loadPage(BAOMING_PATH);
  vm.data.pageState = 'ready';
  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000' };
  vm.data.hostShareChecked = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_abc';
  vm._initWorkflow();

  vm.handlePayment();
  vm.onUnload();
  resolveConsent();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sandbox.requests.length, 0, '页面已卸载时不得后台创建报名单或占库存');
  assert.equal(sandbox.loadingHiddenCount, 1, '离开页面后仍要关闭本次提交的全局 loading');
});

test('baoming:单独同意落库失败时停止下单并允许重试', async () => {
  sandbox.recordConsent = () => Promise.reject(new Error('network'));
  const vm = loadPage(BAOMING_PATH);
  vm.data.pageState = 'ready';
  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000' };
  vm.data.hostShareChecked = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_abc';
  vm._initWorkflow();

  vm.handlePayment();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sandbox.requests.length, 0);
  assert.equal(vm.data.isPaying, false);
  assert.ok(sandbox.toasts.some(t => t.includes('同意记录')));
});

test('baoming:409 价格变动后不进入支付,提示并重报价', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.data.pageState = 'ready'; // 详情已就绪:支付路径断言不受加载三态闸门影响

  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000' };
  vm.data.agreementChecked = true;
  vm.data.hostShareChecked = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_abc';
  vm._initWorkflow();

  vm.handlePayment();
  assert.equal(sandbox.requests.length, 1);
  sandbox.requests[0].success({ code: '409', msg: '价格已更新' });

  assert.equal(vm.data.isPaying, false, '409 后 isPaying 必须复位');
});

test('baoming:免费订单(零元)走 onFreeSuccess 不拉起支付', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.data.pageState = 'ready'; // 详情已就绪:支付路径断言不受加载三态闸门影响

  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 0 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000' };
  vm.data.agreementChecked = true;
  vm.data.hostShareChecked = true;
  vm.data.totalAmount = 0;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_ok';
  vm._initWorkflow();

  vm.handlePayment();
  sandbox.requests[0].success(httpOk({ payableAmount: 0, registrationId: 999, id: 999 }));

  assert.equal(sandbox.payments.length, 0, '零元不应拉起微信支付');
  assert.equal(vm.data.isPaying, false);
});

test('baoming:A 模式确认报名页不再提供报名后建队分支', () => {
  const vm = loadPage(BAOMING_PATH);
  vm.data.activityId = 100;
  vm.data.activityInfo = { teamMode: 1, teamMaxMembers: 4 };

  vm.finishSignup({ title: '报名成功', detail: '票已放入票夹' });

  assert.equal(sandbox.requests.filter((request) => request.url === '/api/team/create').length, 0);
  /* 2026-09-05:自愈计时从本页搬进了 cy-result-sheet(见 components/cy/result-sheet)。
     被保护的行为一字未变 —— A 模式成功后仍要自己收掉并跳订单 —— 断言随之从
     「本页起了 _successHoldTimer」改成「面板拿到的是一个会自愈的配置」:
     没有按钮(不等人选)且 duration > 0。 */
  assert.equal(vm.data.resultSheet.primaryText, '', 'A 模式面板不该有按钮,否则它就不自愈了');
  assert.ok(vm.data.resultSheet.duration > 0, 'A 模式成功后仍按普通报名自动跳订单');
  assert.equal(vm.data.resultSheet.kind, 'success');
});

/* 2026-09-06 用户裁决:买完就直接跳,成功面板不放按钮 —— B 模式也一样。
 * 建队入口没有消失,它在**落地页**:订单详情的「和队友一起出发」卡
 * (components/cy/scene-member-order-detail/index.wxml 的 teamMode == 2 分支)。
 * 所以本用例从「面板上有建队按钮」改成钉两件事:
 *   ① B 模式和 A 模式一样自愈(无按钮 + duration>0),不再半路拦一次;
 *   ② 面板收掉后跳的正是那个带建队卡的订单详情页。
 * 这不是把闸放松:入口仍被断言存在,只是断言它在用户下一秒真正会看到的地方。 */
/* 2026-09-06 用户裁决:在途是这个面板的**前一拍**,不是另一件事 ——
 * 正在支付 → 支付成功/失败 是同一块面板里的连续序列(稿 Payment Sheet States 帧 2→3/1),
 * 不是「先盖一层全屏遮罩、再弹一个面板」。
 * 这条钉两头:① 在途真的是面板的 loading 态且不自愈;② 每个出口都有交代,
 * 不留一块永不消失的遮罩(这正是当初漏 wx.hideLoading 的那个坑)。 */
test('baoming:支付在途是面板的 loading 态,且不自愈', () => {
  const vm = loadPage(BAOMING_PATH);
  vm.data.activityId = 100;
  vm.data.activityInfo = { teamMode: 1 };
  const src = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../../pages/activity/baoming/baoming.js'), 'utf8');
  const verifying = src.slice(src.indexOf('onPayVerifying:'), src.indexOf('onPaySuccess:'));
  assert.ok(verifying.length > 0, '切不出 onPayVerifying 就等于下面是空断言');
  assert.match(verifying, /kind: 'loading'/, '在途必须是面板的 loading 态');
  assert.match(verifying, /duration: 0/, '在途没有终点,不能自愈');
  assert.doesNotMatch(verifying, /cyLoading\.show/,
    '支付这条链路有结果面板,不该再盖一层全屏遮罩 —— 那会变成先遮罩再弹窗两拍');

  /* 每个出口都要有交代:要么改写成结果(success/fail),要么收掉(cancel/unknown)。
     漏一个就是一块永不消失的遮罩挡死整页。 */
  // ⚠️ 终点必须从起点之后找:checkPaymentReadiness 在文件里第一次出现远早于 onPayVerifying,
  //    直接 indexOf 会让终点落在起点之前 ⇒ 切出空串 ⇒ 下面全是空断言(第一版实测踩到)。
  const flowFrom = src.indexOf('onPayVerifying:');
  const flow = src.slice(flowFrom, src.indexOf('checkPaymentReadiness(', flowFrom));
  assert.ok(flow.length > 200, '支付回调整段切得太短,八成锚点错了 —— 空串会让下面变成空断言');
  // ⚠️ 按「下一个 onPay* handler」切,别按第一个 `},` 切 —— setData 的回调里就有一个,
  //    那样会切出半句话,断言变成对着残句判(第一版实测踩到)。
  const bounds = { onPayCancel: 'onPayFail', onPayUnknown: '});' };
  for (const [exit, next] of Object.entries(bounds)) {
    const from = flow.indexOf(exit);
    assert.ok(from >= 0, '切不到 ' + exit);
    const block = flow.slice(from, flow.indexOf(next, from));
    assert.ok(block.length > 40, exit + ' 切出来的段太短,八成切错了');
    assert.match(block, /'resultSheet\.show': false/, exit + ' 必须收掉在途面板');
  }
});

test('baoming:B 模式成功弹窗与 A 模式一样自愈,建队入口交给订单详情页', () => {
  const vm = loadPage(BAOMING_PATH);
  vm.data.activityId = 100;
  vm.data.activityInfo = { teamMode: 2, teamMaxMembers: 3 };
  vm._regId = 77;

  vm.showSignupSuccess({ title: '支付成功', detail: '票已放入票夹' });
  assert.equal(vm.data.resultSheet.primaryText, '', 'B 模式面板不该再有按钮');
  assert.equal(vm.data.resultSheet.secondaryText, '');
  assert.ok(vm.data.resultSheet.duration > 0, 'B 模式也要自愈');

  vm.onResultSheetClose();
  assert.ok(vm._successLeaveTimer, '收掉后必须排跳转');

  const orderWxml = fs.readFileSync(
    path.join(__dirname, '../../components/cy/scene-member-order-detail/index.wxml'), 'utf8');
  assert.match(orderWxml, /teamMode == 2[\s\S]{0,400}叫上队友/,
    '建队入口必须真的在落地的订单详情页上,否则这一删就是把入口弄丢了');
});

test('baoming:付费订单后 verifyPayment 轮询后端终态才跳转', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.data.pageState = 'ready'; // 详情已就绪:支付路径断言不受加载三态闸门影响

  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000' };
  vm.data.agreementChecked = true;
  vm.data.hostShareChecked = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_ok';
  vm._initWorkflow();

  vm.handlePayment();
  sandbox.requests[0].success(httpOk(Object.assign(validRepayData(), { payableAmount: 50 })));

  assert.equal(sandbox.payments.length, 1, '应拉起微信支付');
  // 微信支付成功 → workflow 进入 verifying 态
  sandbox.payments[0].success();
  assert.equal(vm.data.verifyingPayment, true, '微信成功后应进入 verifying 态而非直接跳转');

  var verifyReqs = sandbox.requests.filter(r => r.url === '/api/registration/info');
  assert.ok(verifyReqs.length >= 1, 'verifyPayment 应发出后端终态确认请求');
  assert.equal(verifyReqs[0].data.id, 1001);

  verifyReqs[0].success(httpOk({ paymentStatus: 2, registrationStatus: 2 }));
  assert.equal(vm.data.verifyingPayment, false, '确认后 verifyingPayment 应复位');
  assert.equal(vm.data.isPaying, false);
});

test('baoming:verifyPayment 网络异常时结果未知,不盲重试支付', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.data.pageState = 'ready'; // 详情已就绪:支付路径断言不受加载三态闸门影响

  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000' };
  vm.data.agreementChecked = true;
  vm.data.hostShareChecked = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_ok';
  vm._initWorkflow();

  vm.handlePayment();
  sandbox.requests[0].success(httpOk(Object.assign(validRepayData(), { registrationId: 1002, id: 1002, payableAmount: 50 })));
  sandbox.payments[0].success();

  var verifyReqs = sandbox.requests.filter(r => r.url === '/api/registration/info');
  assert.ok(verifyReqs.length >= 1, '应发起验证请求');
  for (var i = 0; i < verifyReqs.length; i++) {
    verifyReqs[i].fail({ errMsg: 'network error' });
  }
  assert.equal(vm.data.verifyingPayment, true, '验证未完成前不应清除 verifying 态');
  vm.onUnload();
});

test('order:attached + 首次 show 只请求一次列表，后续 show 才刷新', () => {
  const vm = loadPage(ORDER_PATH);
  vm.onLoad();
  vm.onShow();
  assert.equal(sandbox.requests.filter(r => r.url === '/api/registration/list').length, 1);
  const initial = sandbox.requests.find(r => r.url === '/api/registration/list');
  initial.success(httpOk({ rows: [] }));
  initial.complete();
  vm.onShow();
  assert.equal(sandbox.requests.filter(r => r.url === '/api/registration/list').length, 2);
});

test('orderinfo:attached + 首次 show 只请求一次详情，后续 show 才刷新', () => {
  const vm = loadPage(ORDERINFO_PATH);
  vm.data.orderId = '1001';
  vm.onLoad();
  vm.onShow();
  assert.equal(sandbox.requests.filter(r => r.url === '/api/registration/info').length, 1);
  const initial = sandbox.requests.find(r => r.url === '/api/registration/info');
  initial.success(httpOk({ id: 1001, registrationStatus: 2, ownerType: 2 }));
  vm.onShow();
  assert.equal(sandbox.requests.filter(r => r.url === '/api/registration/info').length, 2);
});

test('baoming:在途 isPaying 防重——重复点击被忽略', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.data.pageState = 'ready'; // 详情已就绪:支付路径断言不受加载三态闸门影响

  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000' };
  vm.data.agreementChecked = true;
  vm.data.hostShareChecked = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = true;
  vm._quoteSign = 'qs_abc';
  vm._initWorkflow();

  vm.refreshPaymentState();
  assert.equal(vm.data.canPay, true, '满足支付条件且空闲时 CTA 应可用');

  vm.handlePayment();
  var firstReqCount = sandbox.requests.length;
  assert.ok(firstReqCount >= 1, '第一次应发起请求');
  assert.equal(vm.data.canPay, false, '进入 isPaying 后 CTA 必须立即禁用');
  vm.handlePayment(); // isPaying=true, handlePayment 立即返回
  assert.equal(sandbox.requests.length, firstReqCount, 'isPaying=true 时 handlePayment 应直接返回不新增请求');
});

// ---- order.js 重新支付路径 ----

test('order:re-pay 走 /api/registration/pay 接口获取支付参数', () => {
  const vm = loadPage(ORDER_PATH);

  vm._initWorkflow();
  vm.payOrderRequest(1001, 0);

  assert.equal(sandbox.requests.length, 1);
  assert.equal(sandbox.requests[0].url, '/api/registration/pay');
  assert.equal(sandbox.requests[0].data.id, 1001);
});

test('order:re-pay 支付成功后 verifyPayment 确认终态', () => {
  const vm = loadPage(ORDER_PATH);

  vm._initWorkflow();
  vm.payOrderRequest(1001, 0);
  sandbox.requests[0].success(httpOk(validRepayData()));

  sandbox.payments[0].success();

  var verifyReqs = sandbox.requests.filter(r => r.url === '/api/registration/info');
  assert.ok(verifyReqs.length >= 1);
  verifyReqs[0].success(httpOk({ paymentStatus: 2, registrationStatus: 2 }));

  assert.equal(vm.data.isPaying, false);
  assert.equal(vm.data.verifyingPayment, false);
});

test('R2 order:re-pay 畸形200缺任一必需支付字段都明确失败', () => {
  for (const [missing, data] of malformedRepayCases()) {
    sandbox.requests = [];
    sandbox.toasts = [];
    sandbox.payments = [];
    sandbox.modals = [];
    const vm = loadPage(ORDER_PATH);
    vm.data.isPaying = true;
    vm._initWorkflow();
    vm.payOrderRequest(1001, 0);

    sandbox.requests[0].success({ code: '200', data });

    assert.equal(sandbox.payments.length, 0, `缺 ${missing} 不得拉起微信支付`);
    assert.equal(sandbox.modals.length, 0, `缺 ${missing} 不得弹出「支付成功」`);
    assert.equal(vm.data.isPaying, false, `缺 ${missing} 必须恢复可重试态`);
    assert.ok(sandbox.toasts.includes('支付参数不完整，请重试'), `缺 ${missing} 必须明确报错`);
  }
});

test('R2 orderinfo:re-pay 畸形200缺任一必需支付字段都明确失败', () => {
  for (const [missing, data] of malformedRepayCases()) {
    sandbox.requests = [];
    sandbox.toasts = [];
    sandbox.payments = [];
    const vm = loadPage(ORDERINFO_PATH);
    vm.data.info = { id: 1001 };
    vm._initWorkflow();
    vm.payOrder();

    sandbox.requests[0].success({ code: '200', data });

    assert.equal(sandbox.payments.length, 0, `缺 ${missing} 不得拉起微信支付`);
    assert.equal(vm.data.paying, false, `缺 ${missing} 必须恢复可重试态`);
    assert.equal(sandbox.toasts.includes('支付成功'), false, `缺 ${missing} 不得提示支付成功`);
    assert.ok(sandbox.toasts.includes('支付参数不完整，请重试'), `缺 ${missing} 必须明确报错`);
  }
});

test('order:onShow 会重新拉取列表以检测未确认支付恢复', () => {
  const vm = loadPage(ORDER_PATH);

  vm.onShow();
  var listReqs = sandbox.requests.filter(r => r.url === '/api/registration/list');
  assert.ok(listReqs.length >= 1, 'onShow 应触发列表刷新以恢复未完成支付订单状态');
});

test('order:HTTP 异常支付参数获取失败不盲重试,而是恢复 isPaying', () => {
  const vm = loadPage(ORDER_PATH);

  vm._initWorkflow();
  vm.payOrderRequest(1001, 0);

  sandbox.requests[0].fail({ errMsg: 'request:fail' });
  assert.equal(vm.data.isPaying, false, '网络失败后 isPaying 必须恢复');
});

// ---- orderinfo.js onShow 刷新 ----

test('orderinfo:onShow 重新获取订单详情,可检测支付状态变化', () => {
  const vm = loadPage(ORDERINFO_PATH);

  vm._orderId = 1001;
  vm.onShow();

  var infoReqs = sandbox.requests.filter(r => r.url === '/api/registration/info');
  assert.ok(infoReqs.length >= 1, 'onShow 应刷新订单详情以检测支付恢复');

  infoReqs[0].success(httpOk({ paymentStatus: 2, registrationStatus: 2 }));
  assert.equal(vm.data.info.paymentStatus, 2);
});

// ---- 共同:paymentReady 未就绪时阻止支付 ----

test('baoming:paymentReady=false 时不下单并触发可恢复的 readiness 重试', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.data.pageState = 'ready'; // 详情已就绪:支付路径断言不受加载三态闸门影响

  vm.data.activityId = 100;
  vm.data.selectedTicket = { id: 1, price: 50 };
  vm.data.selectedAddress = { id: 1, fullName: '测试', mobilePhone: '13800138000' };
  vm.data.userInfo = { realName: '测试', phone: '13800138000' };
  vm.data.agreementChecked = true;
  vm.data.hostShareChecked = true;
  vm.data.totalAmount = 50;
  vm.data.paymentReady = false;
  vm._initWorkflow();

  vm.handlePayment();

  assert.equal(sandbox.requests.length, 1, 'paymentReady 为 false 时只允许重试 readiness，不得下单');
  assert.equal(sandbox.requests[0].url, '/api/registration/payment-readiness');
  assert.ok(sandbox.toasts.some(t => t.includes('正在重新检查支付服务')));
  sandbox.requests[0].fail();
  assert.equal(vm.data.paymentReady, false);
  assert.equal(vm.data.paymentReadinessChecking, false);
  assert.ok(sandbox.toasts.some(t => t.includes('检查失败')));
});

test('baoming:readiness 200 空对象必须 fail-closed，不能放行支付', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.checkPaymentReadiness(true);
  sandbox.requests[0].success({ code: '200', data: {} });

  assert.equal(vm.data.paymentReady, false);
  assert.equal(vm.data.paymentReadinessChecking, false);
  assert.ok(sandbox.toasts.some(t => t.includes('支付服务暂不可用')));
});

test('baoming:迟到的旧 readiness 响应不得覆盖较新的失败结果', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.checkPaymentReadiness(false);
  vm.checkPaymentReadiness(false);
  assert.equal(sandbox.aborts, 1);

  sandbox.requests[1].success({ code: '200', data: { ready: false } });
  sandbox.requests[0].success({ code: '200', data: { ready: true } });

  assert.equal(vm.data.paymentReady, false);
});

test('baoming:离页会取消 readiness，迟到回调不得改死页面或弹提示', () => {
  const vm = loadPage(BAOMING_PATH);

  vm.checkPaymentReadiness(true);
  vm.onUnload();
  const toastCount = sandbox.toasts.length;
  sandbox.requests[0].success({ code: '200', data: { ready: true } });

  assert.equal(sandbox.aborts, 1);
  assert.equal(vm.data.paymentReady, false);
  assert.equal(sandbox.toasts.length, toastCount);
});
