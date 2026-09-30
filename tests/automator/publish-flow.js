// Phase 3.1 发布提交控制流回归(B/C 段)——真机运行时,但 stub app.sendRequest/wx 跳转,
// 不创建任何生产数据、不真跳转。验证 activity/fabu 两页与 publish-workflow 的接线:
//  B-load   页面干净加载(新 require/onLoad 生效,submitting 初始 false)
//  B-防重   在途(request 未回)再次 sendData 被忽略,sendRequest 只发一次,submitting=true
//  B-成功   request 成功 → state=done、analytics/“发布成功”toast、redirect 被调用(被 stub 捕获)
//  B-业务败 request code!=200 → app.tips(msg)、submitting 回 false、可重试
//  B-网络败 request fail → “网络错误”toast、submitting 回 false、可重试
//  C-销毁   在途时 onUnload 后再回 request 成功 → 不触发 onSuccess(无 toast/无 redirect)
//
// 运行前提同 login-smoke:WS_ENDPOINT(连已确认的自动化端口)或 DEVTOOLS_CLI(覆盖 harness 的 cli auto 路径)。

const path = require('path');
const { closeMiniProgram, openMiniProgram } = require('./harness');

const PROJECT_PATH = path.resolve(__dirname, '..', '..');
const PAGES = [
  { route: 'pages/publish/fabu/index', name: 'fabu(主题发布)' },
  { route: 'pages/publish/activity/index', name: 'activity(活动发布)' },
];

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) { passed++; console.log('  ✔', label); }
  else { failed++; console.log('  ✖', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// 在运行时安装 stub:只拦发布端点(放行 analytics 等其它请求);回调走 setTimeout 异步,
// 复刻真实网络时序(否则同步回调会让 setData(submitting) 次序与真机相反,产生假阳性)。
async function installStub(mp) {
  await mp.evaluate(() => {
    const app = getApp();
    const PUB = ['/api/topic/create', '/api/activity/publish'];
    app.__t = { reqCount: 0, lastReq: null, redirects: [], toasts: [], tips: [], mode: 'hang' };
    const realSend = app.sendRequest.bind(app);
    app.sendRequest = function (opts) {
      if (!opts || PUB.indexOf(opts.url) < 0) return; // 非发布请求(如 analytics 批量)直接吞掉,不计数
      app.__t.reqCount++;
      app.__t.lastReq = opts;
      const m = app.__t.mode;
      if (m === 'hang') return; // 在途,不回调
      setTimeout(() => {
        if (m === 'success') opts.success && opts.success({ code: '200', data: { id: 999 } });
        else if (m === 'bizfail') opts.success && opts.success({ code: '2', msg: '后端校验未过(stub)' });
        else if (m === 'netfail') opts.fail && opts.fail({ errMsg: 'request:fail(stub)' });
      }, 0);
    };
    app.tips = function (m) { app.__t.tips.push(m); };
    wx.redirectTo = function (o) { app.__t.redirects.push(o && o.url); o && o.complete && o.complete(); };
    wx.showToast = function (o) { app.__t.toasts.push(o && o.title); o && o.success && o.success(); };
  });
}
const setMode = (mp, mode) => mp.evaluate((m) => { getApp().__t.mode = m; }, mode);
const readT = (mp) => mp.evaluate(() => getApp().__t);
const resetT = (mp) => mp.evaluate(() => { const t = getApp().__t; t.reqCount = 0; t.lastReq = null; t.redirects = []; t.toasts = []; t.tips = []; });
// 重置当前页:清掉缓存的工作流(下次 sendData 重建全新状态机)+ submitting 归零。免去逐场景重新导航的抖动。
const resetPage = (mp) => mp.evaluate(() => {
  const pages = getCurrentPages();
  const p = pages[pages.length - 1];
  p._publishWorkflow = null;
  p.setData({ submitting: false });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 一个最小可提交的 payload(stub 不校验内容);直接驱动 sendData 跳过表单填写。
const PAYLOAD = { name: '__回归测试_请勿入库__' };

async function gotoPage(mp, route) {
  await mp.reLaunch('/pages/index/index');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ok = await mp.evaluate(() => !!(getApp() && getApp().isAppReady));
    if (ok) break;
    await wait(300);
  }
  await mp.navigateTo('/' + route);
  await wait(800);
  return mp.currentPage();
}

async function runPage(mp, route, name) {
  console.log('\n=== ' + name + ' (' + route + ') ===');

  // 仅导航一次;之后各场景靠 resetPage 重置状态(不再反复 reLaunch,避免抖动)。
  const page = await gotoPage(mp, route);
  check('页面干净加载(path 正确)', (await page.path).indexOf(route) >= 0, await page.path);
  check('submitting 初始为 false', (await page.data('submitting')) === false);
  await installStub(mp);

  // B-防重(mode=hang:request 不回)
  await resetPage(mp); await setMode(mp, 'hang'); await resetT(mp);
  await page.callMethod('sendData', PAYLOAD);
  await page.callMethod('sendData', PAYLOAD); // 在途再次,应被忽略
  let t = await readT(mp);
  check('防重:sendRequest 只发一次', t.reqCount === 1, t.reqCount);
  check('在途 submitting=true', (await page.data('submitting')) === true);

  // C-销毁守卫(承接上面的在途请求):onUnload 后再回 success,不应触发 onSuccess
  await page.callMethod('onUnload');
  await mp.evaluate(() => { getApp().__t.lastReq.success({ code: '200', data: { id: 1 } }); });
  t = await readT(mp);
  check('销毁后回调不跳转(redirects 为空)', t.redirects.length === 0, t.redirects);
  check('销毁后回调不弹“发布成功”', t.toasts.indexOf('发布成功') < 0, t.toasts);

  // B-成功(mode=success 异步回成功)
  await resetPage(mp); await setMode(mp, 'success'); await resetT(mp);
  await page.callMethod('sendData', PAYLOAD);
  await wait(2300); // 等 success toast 后的 2s redirect 定时器
  t = await readT(mp);
  check('成功:触发“发布成功”toast', t.toasts.indexOf('发布成功') >= 0, t.toasts);
  check('成功:redirect 到成果/管理页', /\/pages\/activity\/detail\/index|\/pages\/topic\/index\/index|\/subpackageA\/pages\/myproject\/index/.test(t.redirects[0] || ''), t.redirects);

  // B-业务失败(mode=bizfail)
  await resetPage(mp); await setMode(mp, 'bizfail'); await resetT(mp);
  await page.callMethod('sendData', PAYLOAD);
  await wait(250);
  t = await readT(mp);
  check('业务失败:走 app.tips(msg)', t.tips.length === 1 && t.tips[0].indexOf('stub') >= 0, t.tips);
  check('业务失败:submitting 回 false', (await page.data('submitting')) === false);
  // 失败后应能再次提交(同一页同一工作流回 idle)
  await setMode(mp, 'success'); await resetT(mp);
  await page.callMethod('sendData', PAYLOAD);
  await wait(250);
  t = await readT(mp);
  check('业务失败后可重试(再次发起成功)', t.reqCount === 1 && t.toasts.indexOf('发布成功') >= 0, t);

  // B-网络失败(mode=netfail)
  await resetPage(mp); await setMode(mp, 'netfail'); await resetT(mp);
  await page.callMethod('sendData', PAYLOAD);
  await wait(250);
  t = await readT(mp);
  check('网络失败:弹“网络错误，请重试”', t.toasts.some((x) => (x || '').indexOf('网络错误') >= 0), t.toasts);
  check('网络失败:submitting 回 false(可重试)', (await page.data('submitting')) === false);
}

async function main() {
  const session = await openMiniProgram({ projectPath: PROJECT_PATH });
  const mp = session.mp;
  try {
    const only = process.env.ONLY; // 可选:只跑路由含该子串的页(规避跨页导航抖动,可分次跑)
    for (const p of PAGES) {
      if (only && p.route.indexOf(only) < 0) continue;
      await runPage(mp, p.route, p.name);
    }
  } finally {
    await closeMiniProgram(session);
  }
  console.log('\n==== 结果:' + passed + ' 通过 / ' + failed + ' 失败 ====');
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error('[publish-flow] 运行失败:', err && err.message ? err.message : err); process.exit(1); });
