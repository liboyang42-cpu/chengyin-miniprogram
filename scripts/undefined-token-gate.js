#!/usr/bin/env node
/*
 * 未定义 DS token 门禁:var(--cy-xxx) 引用的名字必须在全仓某处定义过。
 *
 *   node scripts/undefined-token-gate.js [--root <dir>]
 *   node scripts/undefined-token-gate.js --selftest
 *
 * 病(2026-08-19 实证,不是假想):
 *   pages/searchmap/index.wxss 有 3 处引用 --cy-space-12 —— **这一档从来没定义过**
 *   (量表只到 --cy-space-8=96rpx)。CSS 规范里 var() 取不到值时,**整条声明在计算值阶段作废**,
 *   属性回落到初始值/继承值。于是:
 *     · .smap-location-error 的 top 作废 ⇒「需要定位权限」条落回顶部,压在搜索条上
 *     · .smap-legend 的 margin-left 作废 ⇒ 图例贴左,被浮动返回钮压住
 *   两个都在 A30/A31 截图里坐实。全仓一共 8 种这样的名字、17 处引用,全是静默失效 ——
 *   页面不报错、门禁不报红、只是"长得不对"。
 *
 * 判据:只算**无兜底**的 var(--cy-x)。var(--cy-x, 兜底) 是合法写法(tabs 的 accent 就靠它),不判。
 * 定义来源:全仓任意 wxss 里的 `--cy-x:`(组件可以在自己 :host 里定义私有 token)。
 * ⚠️ 注释里的 var() 不算 —— 文档行写 var(--cy-tabs-accent) 只是在讲用法(实测会误报)。
 */
const fs = require('fs');
const path = require('path');

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ' '); }

function scan(root) {
  const files = [];
  (function walk(d) {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.wxss')) files.push(p);
    }
  })(root);
  const defined = new Set();
  const texts = new Map();
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8');
    const css = stripComments(raw);
    texts.set(f, css);
    for (const m of css.matchAll(/(--cy-[\w-]+)\s*:/g)) defined.add(m[1]);
  }
  const bad = [];
  for (const [f, css] of texts) {
    for (const m of css.matchAll(/var\(\s*(--cy-[\w-]+)\s*\)/g)) {
      if (!defined.has(m[1])) bad.push({ file: path.relative(root, f), token: m[1] });
    }
  }
  return { files, bad };
}

function selftest() {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tokgate-'));
  const w = (n, c) => fs.writeFileSync(path.join(tmp, n), c);
  const cases = [
    ['全绿:引用的都定义过', { 'a.wxss': ':root{--cy-x:1rpx;}', 'b.wxss': '.k{margin:var(--cy-x);}' }, 0],
    ['负控:引用未定义 token 必须红', { 'a.wxss': '.k{margin:var(--cy-nope);}' }, 1],
    ['负控:calc 里的未定义 token 也要红', { 'a.wxss': '.k{top:calc(var(--cy-nope) + 8rpx);}' }, 1],
    ['不误报:带兜底的 var 是合法写法', { 'a.wxss': '.k{color:var(--cy-maybe, #000);}' }, 0],
    ['不误报:注释里的 var 只是文档', { 'a.wxss': '/* 用法:var(--cy-doc-only) */\n.k{color:red;}' }, 0],
    ['不误报:定义在别的文件里也算', { 'a.wxss': '.h{--cy-priv:2rpx;}', 'b.wxss': '.k{margin:var(--cy-priv);}' }, 0],
  ];
  let bad = 0;
  for (const [name, files, want] of cases) {
    for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
    for (const [n, c] of Object.entries(files)) w(n, c);
    const got = scan(tmp).bad.length;
    const ok = want === 0 ? got === 0 : got >= 1;
    console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` → 实得 ${got}`}`);
    if (!ok) bad += 1;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad) { console.error(`selftest 失败 ${bad} 例`); process.exit(1); }
  console.log('selftest 通过:2 个负控真判红,4 个「不该红」的场景没被误报');
}

if (process.argv.includes('--selftest')) { selftest(); process.exit(0); }
const ri = process.argv.indexOf('--root');
const ROOT = ri >= 0 ? path.resolve(process.argv[ri + 1]) : path.resolve(__dirname, '..');
const { files, bad } = scan(ROOT);
if (!files.length) { console.error('没扫到任何 wxss —— 判红,不当作通过'); process.exit(1); }
if (bad.length) {
  console.error(`未定义 token 门禁不通过(扫了 ${files.length} 个 wxss):`);
  for (const b of bad) console.error(`  ✗ ${b.file}  var(${b.token})  ← 该 token 全仓没有定义,整条声明会静默作废`);
  process.exit(1);
}
console.log(`未定义 token 门禁通过:${files.length} 个 wxss,var(--cy-*) 全部有定义`);
