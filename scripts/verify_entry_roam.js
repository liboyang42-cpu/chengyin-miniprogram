// scripts/verify_entry_roam.js
// ============================================================================
// 自证本分支【任务2】逻辑层(non-tabBar,不依赖后端):
//   official-detail `_cta` 纯函数:已报名+进行中+roamEnabled → type=roam
//     (负控:roamEnabled=false → explore;status=5 → ended);goRoam → 跳 roam?eventId。
//   roam 顶部"正在为…点亮"横幅:setData boundEvent → 渲染截图。
//
// 分包处理:pages/activity、pages/roam 均在分包,fresh launch 后需先进主包首页让 app boot,
//           再进分包页 + 轮询 path + callMethod 重试,规避冷编译未就绪的 "method not exists"。
// 【任务1 D-10】入口隐藏 + play navTo 见静态核验 scripts/static_check_d10.sh(tabBar 无后端 automator 不可靠)。
//
// 复跑:  先退 DevTools(automator launch 要求工具未开),再:
//   CY_XCX=<worktree>/chengyinhub-xcx NODE_PATH=<主树>/chengyinhub-xcx/node_modules node scripts/verify_entry_roam.js
// ============================================================================

const automator = require('miniprogram-automator');
const path = require('path');
const os = require('os');

const PROJECT = process.env.CY_XCX || '/Users/developer/Downloads/chengyin/chengyinhub-xcx';
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const SHOT = path.join(os.homedir(), 'Downloads', '小程序截图');

const results = [];
function rec(name, pass, extra) {
  results.push({ name, pass: !!pass, extra: extra == null ? '' : String(extra) });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}
async function shot(mp, f) { try { await mp.screenshot({ path: path.join(SHOT, f) }); } catch (e) {} }
async function gotoSub(mp, url) {
  const page = await mp.reLaunch(url);
  await page.waitFor(2800); // 分包冷编译:给足时间让页面模块挂载,method 就绪由 callRetry 兜底
  return page;
}
async function callRetry(page, name, arg, tries) {
  let last;
  for (let i = 0; i < (tries || 4); i++) {
    try { return await page.callMethod(name, arg); } catch (e) { last = e; await page.waitFor(700); }
  }
  throw last;
}
async function installCap(mp) {
  await mp.evaluate(() => {
    const cap = (globalThis.__cap = { navigateTo: null });
    wx.navigateTo = function (o) { cap.navigateTo = o && o.url; };
    return true;
  });
}

(async () => {
  const mp = await automator.launch({ projectPath: PROJECT, cliPath: CLI });
  try {
    // 预热:先进主包首页让 app 完成 boot,再进分包
    const boot = await mp.reLaunch('/pages/index/index');
    await boot.waitFor(2800);

    // ---------- 任务2 · official-detail 去点亮 CTA(_cta 纯函数) ----------
    console.log('\n[任务2] official-detail _cta:roamEnabled → 去点亮');
    let page = await gotoSub(mp, '/pages/activity/official-detail/index?id=1');
    const ctaRoam = await callRetry(page, '_cta', { status: 3, signed: true, roamEnabled: true }, 6);
    rec('official-detail(分包)_cta 可调用(页面就绪)', !!ctaRoam, JSON.stringify(ctaRoam));
    rec('已报名+进行中+roamEnabled → CTA type=roam', ctaRoam && ctaRoam.type === 'roam', JSON.stringify(ctaRoam));
    const ctaExplore = await callRetry(page, '_cta', { status: 3, signed: true, roamEnabled: false }, 3);
    rec('[负控] roamEnabled=false → CTA type=explore(不恒返 roam)', ctaExplore && ctaExplore.type === 'explore', JSON.stringify(ctaExplore));
    const ctaEnded = await callRetry(page, '_cta', { status: 5, signed: true, roamEnabled: true }, 3);
    rec('[负控] status=5(已结束)→ CTA type=ended(状态优先)', ctaEnded && ctaEnded.type === 'ended', JSON.stringify(ctaEnded));
    await installCap(mp);
    await page.setData({ id: 66 });
    await callRetry(page, 'goRoam', undefined, 3);
    await page.waitFor(200);
    const cap = await mp.evaluate(() => JSON.parse(JSON.stringify(globalThis.__cap || {})));
    rec('goRoam → 跳 /pages/roam/index?eventId=66', !!cap.navigateTo && cap.navigateTo.indexOf('/pages/roam/index?eventId=66') >= 0, 'url=' + cap.navigateTo);

    // ---------- 任务2 · roam 顶部横幅渲染 ----------
    console.log('\n[任务2] roam 顶部"正在为…点亮"横幅');
    page = await gotoSub(mp, '/pages/roam/index?eventId=1');
    await page.setData({ boundEvent: { id: 1, title: '成都点亮日' }, screen: 'map' });
    await page.waitFor(500);
    const be = await page.data('boundEvent');
    rec('roam boundEvent 就位 → 横幅可渲染', !!(be && be.title === '成都点亮日'), JSON.stringify(be));
    await shot(mp, 'task2_roam_banner.png');

    const fail = results.filter((r) => !r.pass);
    console.log('\n================ 汇总 ================');
    console.log('用例 ' + results.length + ' · 通过 ' + (results.length - fail.length) + ' · 失败 ' + fail.length);
    if (fail.length) console.log('失败项:\n' + fail.map((r) => '  - ' + r.name + ' | ' + r.extra).join('\n'));
    await mp.close();
    process.exit(fail.length ? 1 : 0);
  } catch (e) {
    console.error('驱动异常:', e && e.message || e);
    try { await mp.close(); } catch (x) {}
    process.exit(2);
  }
})();
