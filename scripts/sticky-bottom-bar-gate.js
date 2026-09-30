#!/usr/bin/env node
/*
 * 底栏不透明门禁:position:fixed|sticky + bottom:0 的规则块必须自带背景色。
 *
 *   node scripts/sticky-bottom-bar-gate.js            # 扫全仓
 *   node scripts/sticky-bottom-bar-gate.js --selftest # 负控
 *
 * 病(2026-08-19 实拍坐实,两次):
 *   pages/topic/merchantinfo 的 .bm-btn 是 sticky;bottom:0;z-index:21 但没有 background,
 *   下方内容从它的 padding 区透出来 ⇒「报名」看上去压在「活动信息」标题上(C27)。
 *   同一病因在 pages/topic/index 的 .bm-btn 上有一份**孪生**,以及 project-join /
 *   project-host 的 .bottom-bar、merchant/apply 的 .bottom —— 共 4 处。
 *   ⚠️ merchant/apply 同一个文件里 .wizard-actions 有背景、.bottom 没有,自己就不自洽。
 *
 * 豁免(不是漏判,是这三类本来就不该有自己的底色):
 *   · 背景画在 ::before 上的磨砂玻璃弹窗(.ds-pop / .pop-model),属既有玻璃半屏规范
 *   · 背景画在子元素上的输入条(.david_npl 的 .david_npl_right)
 *   · 悬浮 pill 式底栏(.cy-tabbar),它本来就不铺满
 *   豁免靠**显式白名单**,不靠正则猜 —— 猜出来的豁免等于给未来的 bug 开后门。
 */
const fs = require('fs');
const path = require('path');

const ALLOW = new Set([
  'components/cy/date-sheet/index.wxss::.ds-pop',      // 玻璃:背景在 ::before
  'style/common.wxss::.pop-model',                     // 玻璃:背景在 ::before
  'style/components.wxss::.cy-tabbar',                 // 悬浮 pill,不铺满
  'pages/square/detail/index.wxss::.david_npl',        // 背景在子元素 .david_npl_right
  // ↓ 2026-09-19 端到端审查 #28:这五条逐条读过 wxss,全是「整屏层」而不是底栏 ——
  //   尺子的判据是 fixed/sticky + bottom:0,而满屏层(top:0 且 bottom:0)必然含 bottom:0,
  //   于是背景画在子层、或刻意不画底的两类都被扫进来。逐条写明背景落在哪一层。
  // (2026-09-20 合批:cy-popover 随 #1103 主包瘦身下沉到 pages/square/ 下,等量换 key、理由一字未改)
  'pages/square/components/cy/popover/index.wxss::.pop__catch',       // 只接「点外面」的捕获层,源码注释:刻意无背景不压暗
  'pages/play/components/playkit-dailysign/index.wxss::.ds',          // 满屏模态根,不透明底在同文件 .ds__bg
  'pages/play/index.wxss::.fx-bg',                                    // 满屏背景层(pointer-events:none),图与蒙版在 .fx-bg__im / .fx-bg__veil
  'pages/play/index.wxss::.fx-hero',                                  // 满屏展开层,兜底底色在 .fx-hero__bg
  'pages/roam/index.wxss::cy-proto-cam',                              // 满屏取景浮层(pointer-events:none),不是一根条
]);

function scanText(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const sel = m[1].trim().split('\n').pop().trim();
    const body = m[2];
    if (!/position\s*:\s*(sticky|fixed)/.test(body)) continue;
    if (!/\bbottom\s*:\s*0/.test(body)) continue;
    if (/background(-color)?\s*:/.test(body)) continue;
    out.push(sel);
  }
  return out;
}

function selftest() {
  const cases = [
    ['全绿:有背景', '.a{position:fixed;bottom:0;background:#000;}', 0],
    ['负控:sticky 无背景必须红', '.a{position:sticky;bottom:0;z-index:9;}', 1],
    ['负控:fixed 无背景必须红', '.a{position:fixed;bottom:0;padding:8rpx;}', 1],
    ['不误报:bottom 不是 0', '.a{position:fixed;bottom:80rpx;}', 0],
    ['不误报:不是固定定位', '.a{bottom:0;padding:8rpx;}', 0],
    ['不误报:background-color 也算数', '.a{position:fixed;bottom:0;background-color:#111;}', 0],
  ];
  let bad = 0;
  for (const [name, css, want] of cases) {
    const got = scanText(css).length;
    const ok = want === 0 ? got === 0 : got >= 1;
    console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` → 实得 ${got}`}`);
    if (!ok) bad += 1;
  }
  if (bad) { console.error(`selftest 失败 ${bad} 例`); process.exit(1); }
  console.log('selftest 通过:2 个负控真能判红,4 个「不该红」的场景没被误报');
}

if (process.argv.includes('--selftest')) { selftest(); process.exit(0); }

// 默认扫本脚本所属的 xcx 根(cwd 无关,与 CI script CWD independence gate 一致);
// --root <dir> 只为做负控:把门禁指向一棵**未修**的树,确认它真的会红。
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(__dirname, '..');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.wxss')) files.push(p);
  }
})(ROOT);

const bad = [];
for (const f of files) {
  const rel = path.relative(ROOT, f);
  for (const sel of scanText(fs.readFileSync(f, 'utf8'))) {
    if (ALLOW.has(`${rel}::${sel}`)) continue;
    bad.push(`${rel}  {${sel}}`);
  }
}
if (!files.length) { console.error('没扫到任何 wxss —— 判红,不当作通过'); process.exit(1); }
if (bad.length) {
  console.error(`底栏不透明门禁不通过(扫了 ${files.length} 个 wxss):`);
  bad.forEach((b) => console.error('  ✗ ' + b + '  ← 固定底栏缺 background,下方内容会透出来'));
  process.exit(1);
}
console.log(`底栏不透明门禁通过:${files.length} 个 wxss,无缺背景的固定底栏(豁免 ${ALLOW.size} 条)`);
