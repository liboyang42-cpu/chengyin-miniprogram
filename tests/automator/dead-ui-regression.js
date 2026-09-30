// 死按钮 / 坏路径 / 假交互 —— 运行时回归(需开发者工具「服务端口」已开)。
// 在真实运行的小程序里 hook wx.showToast/openLocation/navigateTo,真实调用页面 handler,
// 断言"死按钮只弹 toast、不触发真实动作""坏分享 path 未指向已删页"。
// 运行:DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" node tests/automator/dead-ui-regression.js
//   或:WS_ENDPOINT=ws://127.0.0.1:9420 node tests/automator/dead-ui-regression.js
const path = require('path');
const { closeMiniProgram, openMiniProgram } = require('./harness');
const PROJECT_PATH = path.resolve(__dirname, '..', '..');

async function hooks(mp) {
  await mp.evaluate(() => {
    if (globalThis.__hooked) return;
    globalThis.__hooked = true;
    globalThis.__ev = { toast: [], openLoc: 0, nav: [] };
    const w = (o, n, cb) => { const f = o[n]; o[n] = function () { cb(arguments[0]); return f ? f.apply(this, arguments) : undefined; }; };
    w(wx, 'showToast', o => globalThis.__ev.toast.push((o && o.title) || ''));
    w(wx, 'navigateTo', o => globalThis.__ev.nav.push((o && o.url) || ''));
    const ol = wx.openLocation; wx.openLocation = function () { globalThis.__ev.openLoc++; return ol ? ol.apply(this, arguments) : undefined; };
  });
}
const snap = mp => mp.evaluate(() => JSON.parse(JSON.stringify(globalThis.__ev)));

const failures = [];
function assert(cond, msg) { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) failures.push(msg); }

async function main() {
  const session = await openMiniProgram({ projectPath: PROJECT_PATH });
  const mp = session.mp;
  try {
    await mp.reLaunch('/pages/index/index');
    await new Promise(r => setTimeout(r, 1500));
    await hooks(mp);

    // 断言的是"修复后的期望行为":当前 UI 未改前会 FAIL(红),修好后自动转绿、再坏则回归报红。
    // 注:死链/坏分享请以 `npm run lint:ui` 静态扫描为准(读磁盘源码,不受开发者工具编译缓存/并发影响);
    //     本运行时用例只覆盖"按钮是否真触发动作"这类静态查不出的行为。

    // 节点详情卡的真实可见「地图导航」按钮应拉起 wx.openLocation。
    // 先注入按钮正常渲染所需的最小节点状态；不拿空页面调用已退场的孤儿方法制造假红。
    await mp.reLaunch('/pages/play/index'); await new Promise(r => setTimeout(r, 1000));
    const p = await mp.currentPage();
    await p.setData({
      'sheet.node': { lat: 31.2304, lng: 121.4737, name: '测试目的地', address: '测试地址' }
    });
    const b = await snap(mp);
    try { await p.callMethod('sheetNav'); } catch (e) {}
    const a = await snap(mp);
    const navToast = a.toast.slice(b.toast.length).join('|');
    assert(a.openLoc > b.openLoc, `play.sheetNav 应调用 wx.openLocation 而非死按钮(当前 toast="${navToast}",openLocation 未触发=未修复)`);

    console.log('\n===== dead-ui-regression: ' + (failures.length ? failures.length + ' FAIL' : 'ALL PASS') + ' =====');
  } finally {
    await closeMiniProgram(session);
  }
  if (failures.length) process.exit(1);
}
main().catch(e => { console.error('[dead-ui] FATAL:', e && e.message ? e.message : e); process.exit(1); });
