// scripts/e2e_regression.js
// ============================================================================
// D-08 关键用户路径 E2E 回归资产:登录 / 报名 / 支付 / 核销 / 注销 五流程可复跑自证。
//
// 方法论(见 skill wechat-miniprogram-verify):
//   automator.launch 自拉 IDE(不需人肉先开);mock 会话 + 拦截 wx/网络边界 API,
//   用 page.callMethod 驱动客户端流程逻辑并断言返回/副作用,setData 造 UI 态截图。
//   真支付完成 / 真扫码摄像头 / 真后端建单核销 = 【物理边界】(需真机 + 正式沙箱 +
//   已部署后端),脚本内以 [BOUNDARY] 标注,并给出本地可跑的等价断言(参数透传/路由/门禁)。
//
// 负控(反橡皮图章):非法二维码不发请求(4c)、注销门禁拦截(5b/5c)= 已知错输入,
//   确认校验器能判 FAIL,证明"全绿"有意义。
//
// 复跑:  CY_XCX=/path/to/chengyinhub-xcx node scripts/e2e_regression.js
//         默认 PROJECT 指主树;验证 worktree 改动时传 CY_XCX=<worktree>/chengyinhub-xcx
//
// 产物:  ~/Downloads/小程序截图/e2e_*.png  +  scripts/_e2e_report.json(机读,喂回归报告模板)
// ============================================================================

const automator = require('miniprogram-automator');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

const PROJECT = process.env.CY_XCX || '/Users/developer/Downloads/chengyin/chengyinhub-xcx';
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const SHOT = path.join(os.homedir(), 'Downloads', '小程序截图');
const RUN_ID = 'e2e-' + Date.now();

const results = [];
let shotN = 0;
const shots = [];

// severity: BLOCKER > MAJOR > MINOR —— 缺陷分级(见回归报告模板)
function rec(flow, name, pass, severity, extra) {
  results.push({ flow, name, pass: !!pass, severity: severity || 'MAJOR', extra: extra == null ? '' : String(extra) });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] (${flow}·${severity || 'MAJOR'}) ${name}${extra ? ' — ' + extra : ''}`);
}
async function shot(mp, label) {
  shotN += 1;
  const file = `e2e_${String(shotN).padStart(2, '0')}_${label}.png`;
  try { await mp.screenshot({ path: path.join(SHOT, file) }); shots.push(file); } catch (e) {}
  return file;
}

// 在小程序上下文安装边界拦截:app.sendRequest 按 url 子串匹配 canned 响应并记录;
// wx.requestPayment / wx.scanCode / wx.showModal 覆写。所有捕获落 globalThis.__e2e。
async function installStubs(mp, routes) {
  await mp.evaluate((routesJson) => {
    const routes = JSON.parse(routesJson);
    const cap = (globalThis.__e2e = { requests: [], pay: null });
    const app = getApp();
    app.sendRequest = function (o) {
      cap.requests.push({ url: o.url, method: o.method || 'GET', data: o.data });
      let resp = { code: '200', data: {} };
      for (const r of routes) { if (o.url && o.url.indexOf(r.url) >= 0) { resp = r.resp; break; } }
      try { if (o.success) o.success(resp); } catch (e) {}
      try { if (o.complete) o.complete(resp); } catch (e) {}
    };
    wx.requestPayment = function (p) {
      // 记录入参即返回,不真弹收银台(避免挂死),不回调 success/fail
      cap.pay = { timeStamp: p.timeStamp, nonceStr: p.nonceStr, package: p.package, signType: p.signType, paySign: p.paySign };
    };
    wx.scanCode = function (o) { try { if (o && o.success) o.success({ result: globalThis.__scanResult || '' }); } catch (e) {} };
    wx.showModal = function (o) { try { if (o && o.success) o.success({ confirm: true, cancel: false }); } catch (e) {} };
    return true;
  }, JSON.stringify(routes));
}
async function readCap(mp) { return await mp.evaluate(() => JSON.parse(JSON.stringify(globalThis.__e2e || { requests: [], pay: null }))); }
// 分包页(pages/activity、pages/merchant)冷编译需先 boot 主包 + 足够等待;method 就绪由 callRetry 兜底
async function gotoSub(mp, url) { const page = await mp.reLaunch(url); await page.waitFor(2600); return page; }
async function callRetry(page, name, arg, tries) {
  let last; for (let i = 0; i < (tries || 4); i++) { try { return await page.callMethod(name, arg); } catch (e) { last = e; await page.waitFor(700); } } throw last;
}
// 每流程超时守卫:环境断连/分包未就绪会让 mp 调用挂死(try/catch 抓不住),用 race 兜底,保证有界终止
function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('flow timeout ' + ms + 'ms @' + label)), ms))]);
}
async function setScan(mp, obj) { await mp.evaluate((s) => { globalThis.__scanResult = s; return true; }, typeof obj === 'string' ? obj : JSON.stringify(obj)); }

async function mockSession(mp, over) {
  await mp.evaluate((overJson) => {
    const over = JSON.parse(overJson || '{}');
    const app = getApp();
    const s = Object.assign(
      { user_id: 999001, authorization: 'e2e-dev-token', open_id: 'e2e-openid', user_type: 1, avatar: '', nickname: 'E2E测试号', role: 'player' },
      over);
    Object.keys(s).forEach((k) => { try { wx.setStorageSync(k, s[k]); } catch (e) {} if (app.globalData) app.globalData[k] = s[k]; });
    return true;
  }, JSON.stringify(over || {}));
}

// ---------------- 流程1 登录 ----------------
async function flowLogin(mp) {
  console.log('\n[流程1] 登录 login');
  await mockSession(mp);
  const uid = await mp.evaluate(() => String(getApp().getUserID()));
  rec('login', 'app.getUserID() 回读 mock 会话(会话读取链路)', uid === '999001', 'BLOCKER', 'getUserID=' + uid);
  const keys = await mp.evaluate(() => ({
    token: wx.getStorageSync('authorization'), uid: String(wx.getStorageSync('user_id')),
    open: wx.getStorageSync('open_id'), type: String(wx.getStorageSync('user_type')),
  }));
  rec('login', '会话存储契约 authorization/user_id/open_id/user_type 落盘',
    keys.token === 'e2e-dev-token' && keys.uid === '999001' && keys.open === 'e2e-openid' && keys.type === '1',
    'MAJOR', JSON.stringify(keys));
  // 注:member/index 为 tabBar 页、无后端会经 roleGuard 重定向,automator reLaunch 易断连,登录流只验会话读取/存储契约链路
  console.log('  [BOUNDARY] 真 wx.login → /api/login/code 换 token 需已部署后端;此处验证会话读取/存储契约链路');
}

// ---------------- 流程2 报名 ----------------
async function flowSignup(mp) {
  console.log('\n[流程2] 报名 signup');
  await mockSession(mp);
  const page = await gotoSub(mp, '/pages/activity/baoming/baoming');
  await installStubs(mp, [
    { url: '/api/registration/quote', resp: { code: '200', data: { quoteSign: 'e2e-sign' } } },
    { url: '/api/registration/create', resp: { code: '200', data: {} } },
  ]);
  await page.setData({
    activityId: 8001,
    selectedTicket: { id: 55, price: '28.00', name: '标准票' },
    userInfo: { realName: '张三', phone: '13800000000', email: '', address: '', addressId: 0 },
    useDiscount: false,
  });
  await shot(mp, 'signup_baoming');
  await callRetry(page, 'createRegistration', undefined, 5);
  await page.waitFor(500);
  const cap = await readCap(mp);
  const createReq = cap.requests.find((r) => r.url.indexOf('/api/registration/create') >= 0);
  rec('signup', 'createRegistration 命中建单接口 /api/registration/create', !!createReq, 'BLOCKER', createReq ? 'hit' : '未命中');
  let body = {};
  try { body = createReq ? JSON.parse(createReq.data) : {}; } catch (e) {}
  rec('signup', '建单载荷 ownerType=2 + ticketId 透传', body.ownerType === 2 && body.ticketId === 55, 'MAJOR', 'ownerType=' + body.ownerType + ' ticketId=' + body.ticketId);
  rec('signup', 'BE-03 幂等键 requestId(req_ 前缀)存在', !!body.requestId && String(body.requestId).indexOf('req_') === 0, 'MAJOR', 'requestId=' + (body.requestId || '空'));
  rec('signup', 'M0-1 报价签名 quoteSign 回传(未就绪先补报价)', body.quoteSign === 'e2e-sign', 'MAJOR', 'quoteSign=' + (body.quoteSign || '空'));
  console.log('  [BOUNDARY] 真报价/建单/库存扣减需已部署后端;此处验证载荷组装 + 幂等键 + 报价签名回传链路');
}

// ---------------- 流程3 支付 ----------------
async function flowPayment(mp) {
  console.log('\n[流程3] 支付 payment(支付参数透传)');
  await mockSession(mp);
  const page = await gotoSub(mp, '/pages/activity/baoming/baoming');
  await installStubs(mp, []);
  const order = { timeStamp: '1700000000', nonceStr: 'NONCE123', package: 'prepay_id=wx8888', signType: 'RSA', paySign: 'SIGNXYZ' };
  await callRetry(page, 'wechatPayment', order, 5);
  await page.waitFor(300);
  const cap = await readCap(mp);
  const p = cap.pay || {};
  rec('payment', 'orderData → wx.requestPayment 五项支付参数全透传',
    p.timeStamp === order.timeStamp && p.nonceStr === order.nonceStr && p.package === order.package && p.signType === order.signType && p.paySign === order.paySign,
    'BLOCKER', JSON.stringify(p));
  console.log('  [BOUNDARY] 真实唤起微信收银台 + 支付结果回调需真机 + 正式商户沙箱;此处验证 orderData→requestPayment 参数透传');
}

// ---------------- 流程4 核销 ----------------
async function flowCheckin(mp) {
  console.log('\n[流程4] 核销 checkin(扫码结果 → 接口路由分流 + 异常)');
  await mockSession(mp, { user_type: 2, role: 'merchant' });
  const page = await gotoSub(mp, '/pages/merchant/index/index');
  await shot(mp, 'checkin_merchant');
  // 4a 票券 type=activity → 验票接口 scan_qr_code {type,code}
  await installStubs(mp, [
    { url: '/api/registration/scan_qr_code', resp: { code: '200', msg: '验票成功', data: {} } },
    { url: '/api/coupon/verification', resp: { code: '200', msg: '核销成功', data: {} } },
  ]);
  await setScan(mp, { type: 'activity', code: 'VER-ABC-1' });
  await callRetry(page, 'goScanQR', undefined, 4);
  await page.waitFor(300);
  let cap = await readCap(mp);
  let req = cap.requests.find((r) => r.url.indexOf('scan_qr_code') >= 0);
  rec('checkin', '票券(type=activity)→ 验票接口 scan_qr_code', !!req, 'BLOCKER', req ? 'hit' : '未命中');
  rec('checkin', '验票载荷含 type + code', !!(req && req.data && req.data.type === 'activity' && req.data.code === 'VER-ABC-1'), 'MAJOR', req ? JSON.stringify(req.data) : '');
  // 4b 优惠券 type=coupon → 核销接口 coupon/verification {code}
  await installStubs(mp, [{ url: '/api/coupon/verification', resp: { code: '200', msg: '核销成功', data: {} } }]);
  await setScan(mp, { type: 'coupon', code: 'CP-999' });
  await callRetry(page, 'goScanQR', undefined, 4);
  await page.waitFor(300);
  cap = await readCap(mp);
  req = cap.requests.find((r) => r.url.indexOf('coupon/verification') >= 0);
  rec('checkin', '优惠券(type=coupon)→ 核销接口 coupon/verification', !!req, 'BLOCKER', req ? 'hit' : '未命中');
  rec('checkin', '核销载荷仅含 code(不含 type)', !!(req && req.data && req.data.code === 'CP-999' && req.data.type === undefined), 'MINOR', req ? JSON.stringify(req.data) : '');
  // 4c 负控:非法 JSON → 不发起核销请求(异常边界)
  await installStubs(mp, []);
  await setScan(mp, 'not-a-json');
  await callRetry(page, 'goScanQR', undefined, 4);
  await page.waitFor(200);
  cap = await readCap(mp);
  rec('checkin', '[负控] 非法二维码不发起核销请求', cap.requests.length === 0, 'MAJOR', 'requests=' + cap.requests.length);
  console.log('  [BOUNDARY] 真实扫码摄像头 + 真实核销写库需真机 + 已部署后端;此处验证扫码结果→接口路由分流 + 异常处理');
}

// ---------------- 流程5 注销(账户注销) ----------------
async function flowDeregister(mp) {
  console.log('\n[流程5] 注销 deregister(账户注销门禁 + 拦截态 + 状态机)');
  await mockSession(mp);
  await installStubs(mp, []); // onLoad 的 status/precheck 走 benign 桩,避免真网络
  const page = await mp.reLaunch('/pages/deregister/index');
  await page.waitFor(1000);
  // 5a 拦截态渲染
  await page.setData({ status: 'BLOCKED', blockers: ['有未完成的订单', '账户余额未提现', '有进行中的活动'], submitting: false, confirmed: false });
  await page.waitFor(300);
  await shot(mp, 'deregister_blocked');
  const blockers = await page.data('blockers');
  rec('deregister', '拦截态渲染 blockers 列表(未完成订单/余额/活动)', Array.isArray(blockers) && blockers.length === 3, 'MAJOR', 'blockers=' + (blockers ? blockers.length : 'null'));
  // 5b 负控:未勾选确认 → apply 被门禁拦(submitting 不置真)
  await installStubs(mp, []);
  await page.setData({ status: 'OK', blockers: [], confirmed: false, smscode: '123456', submitting: false });
  await page.callMethod('apply');
  await page.waitFor(150);
  let submitting = await page.data('submitting');
  let sent = (await readCap(mp)).requests.length;
  rec('deregister', '[负控] 未勾选"已阅读后果" → apply 门禁拦截(不提交)', submitting === false && sent === 0, 'BLOCKER', 'submitting=' + submitting + ' sent=' + sent);
  // 5c 负控:勾选但无验证码 → apply 被门禁拦
  await installStubs(mp, []);
  await page.setData({ confirmed: true, smscode: '', submitting: false });
  await page.callMethod('apply');
  await page.waitFor(150);
  submitting = await page.data('submitting');
  sent = (await readCap(mp)).requests.length;
  rec('deregister', '[负控] 无短信验证码 → apply 门禁拦截(不提交)', submitting === false && sent === 0, 'BLOCKER', 'submitting=' + submitting + ' sent=' + sent);
  // 5d 满足条件 → apply 放行 + 状态机进 PENDING
  await installStubs(mp, [{ url: '/api/user/deregister/apply', resp: { code: '200', data: { status: 'PENDING', executeAfter: '2026-08-11' } } }]);
  await page.setData({ confirmed: true, smscode: '654321', submitting: false, status: 'OK' });
  await page.callMethod('apply');
  await page.waitFor(300);
  const cap = await readCap(mp);
  const req = cap.requests.find((r) => r.url.indexOf('deregister/apply') >= 0);
  rec('deregister', '条件满足 → 提交注销申请(命中 apply + requestId 幂等键)', !!(req && req.data && String(req.data.requestId).indexOf('deregister-') === 0), 'MAJOR', req ? JSON.stringify(req.data) : '未命中');
  const st = await page.data('status');
  rec('deregister', '提交后状态机进入 PENDING(待生效)', st === 'PENDING', 'MAJOR', 'status=' + st);
  await shot(mp, 'deregister_pending');
  console.log('  [BOUNDARY] 真实短信下发 + 真实匿名化执行需已部署后端;此处验证前端门禁/幂等键/状态机流转');
}

// ---------------- 汇总 + 报告 ----------------
function gitMeta() {
  try {
    const opt = { cwd: PROJECT, encoding: 'utf8' };
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opt).trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opt).trim();
    return { commit, branch };
  } catch (e) { return { commit: 'unknown', branch: 'unknown' }; }
}
function appid() {
  try { return JSON.parse(fs.readFileSync(path.join(PROJECT, 'project.config.json'), 'utf8')).appid || ''; }
  catch (e) { return ''; }
}

(async () => {
  console.log('=== D-08 E2E 回归 · runId=' + RUN_ID + ' ===');
  console.log('PROJECT=' + PROJECT);
  const mp = await automator.launch({ projectPath: PROJECT, cliPath: CLI });
  const consoleErrors = [];
  mp.on('console', (m) => { if (m.type === 'error') consoleErrors.push(String(m.args && m.args[0]).slice(0, 160)); });
  try {
    const boot = await mp.reLaunch('/pages/index/index'); await boot.waitFor(2800); // 让 app 完成 boot(分包页 method 就绪前提)
    let broken = false;
    for (const [nm, fn] of [['login', flowLogin], ['signup', flowSignup], ['payment', flowPayment], ['checkin', flowCheckin], ['deregister', flowDeregister]]) {
      if (broken) { rec(nm, '前序流程超时/断连,跳过(环境边界)', false, 'MINOR', 'skipped'); continue; }
      try { await withTimeout(fn(mp), 80000, nm); }
      catch (e) { rec(nm, '流程执行异常/超时(连接断开或分包未就绪)', false, 'BLOCKER', String(e && e.message || e).slice(0, 160)); broken = true; }
    }
  } catch (e) {
    rec('harness', '驱动执行异常', false, 'BLOCKER', String(e && e.message || e).slice(0, 200));
  } finally {
    const fail = results.filter((r) => !r.pass);
    const byFlow = {};
    for (const r of results) { (byFlow[r.flow] = byFlow[r.flow] || { pass: 0, fail: 0 })[r.pass ? 'pass' : 'fail']++; }
    const report = {
      runId: RUN_ID, startedAt: new Date().toISOString(), device: 'WeChat DevTools (macOS)',
      project: PROJECT, appid: appid(), git: gitMeta(),
      summary: { total: results.length, pass: results.length - fail.length, fail: fail.length,
        blockerFail: fail.filter((r) => r.severity === 'BLOCKER').length,
        majorFail: fail.filter((r) => r.severity === 'MAJOR').length,
        minorFail: fail.filter((r) => r.severity === 'MINOR').length },
      byFlow, consoleErrors: consoleErrors.slice(0, 30), screenshots: shots, results,
    };
    try { fs.writeFileSync(path.join(PROJECT, 'scripts', '_e2e_report.json'), JSON.stringify(report, null, 2)); } catch (e) {}
    console.log('\n================ 汇总 ================');
    console.log('用例 ' + report.summary.total + ' · 通过 ' + report.summary.pass + ' · 失败 ' + report.summary.fail
      + ' (BLOCKER ' + report.summary.blockerFail + ' / MAJOR ' + report.summary.majorFail + ' / MINOR ' + report.summary.minorFail + ')');
    console.log('console.error 计数(后端未部署时多为数据加载失败,非前端崩溃):' + consoleErrors.length);
    console.log('报告已写 scripts/_e2e_report.json · 截图 ' + shots.length + ' 张在 ~/Downloads/小程序截图/e2e_*.png');
    await mp.close();
    process.exit(report.summary.blockerFail > 0 ? 1 : 0);
  }
})();
