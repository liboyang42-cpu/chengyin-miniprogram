#!/usr/bin/env node
/* a11y-tappable-name-lint.js —— 可点击元素必须有「可读名称」(2026-08-22)
 *
 * 判据不是「有没有 aria-label」,而是**读屏器能不能说出这个东西是什么**:
 *   ① 元素自带 aria-label(非空,且不是纯 {{}} 插值兜不住的空串)—— 有名;
 *   ② 子树里有可读文本(字面文字 / <text> 节点 / {{}} 插值)—— 有名;
 *   ③ 两者都没有(纯图标按钮、纯图片点击区)—— **无名**,读屏器只会念「按钮」。
 *
 * ⚠️ 为什么不能只 grep aria-label:全站 255 个 aria-role="button" 里大部分旁边本来就有文字,
 * 盯 aria-label 会把它们全报成缺陷(实测过报 53 → 真缺口远少于此)。
 *
 * 用法:
 *   node scripts/a11y-tappable-name-lint.js            # 扫描,超基线判红
 *   node scripts/a11y-tappable-name-lint.js --list     # 列出全部无名点击区
 *   node scripts/a11y-tappable-name-lint.js --selftest # 自证(含负控)
 *   node scripts/a11y-tappable-name-lint.js --update-baseline
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, 'tests/lint/a11y-tappable-baseline.json');
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', 'dist']);

/** 自闭合 / 无子树的标签 */
const VOID_TAGS = new Set(['image', 'input', 'icon', 'progress', 'canvas', 'camera', 'live-player', 'live-pusher']);

function walkWxml(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkWxml(full, acc);
    else if (e.name.endsWith('.wxml')) acc.push(full);
  }
  return acc;
}

// ⚠️ 用等量换行替换注释,不能整块删 —— 否则跨行注释会让后面所有元素的行号偏移,
// 报出来的 file:line 指不到真实位置(2026-08-22 实测:批量补 aria 时按行号定位全部落空)。
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g,
  (m) => m.replace(/[^\n]/g, ' '));

/** 找到 openTagStart 处标签的结束下标(引号内的 > 不算) */
function tagEnd(s, from) {
  let q = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** 从 <tag ...> 起,返回其子树文本(自闭合返回空串) */
function subtree(src, openStart, openEnd, tag) {
  if (src[openEnd - 1] === '/' || VOID_TAGS.has(tag)) return '';
  let depth = 1, i = openEnd + 1;
  const openRe = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'g');
  while (i < src.length && depth > 0) {
    openRe.lastIndex = i; closeRe.lastIndex = i;
    const o = openRe.exec(src), c = closeRe.exec(src);
    if (!c) return src.slice(openEnd + 1);
    if (o && o.index < c.index) { depth++; i = o.index + 1; }
    else { depth--; if (depth === 0) return src.slice(openEnd + 1, c.index); i = c.index + 1; }
  }
  return '';
}

/** 子树里有没有读屏器能念出来的东西 */
function hasReadableContent(inner) {
  if (!inner) return false;
  // 去掉所有标签,剩下的就是裸文本节点(含 {{}} 插值)
  const text = inner.replace(/<[^>]*>/g, '').trim();
  if (text.length > 0) return true;
  // <text> 节点即便当前为空,也是承载文案的位置;但真正空的 <text></text> 不算
  return false;
}

/* 自定义组件把这些 prop 直接渲染成可见文字 ⇒ 它就是可读名称。
 * 实证:cy-cell 的 <view class="cell__title">{{title}}</view>,它内部甚至已经
 * 用 aria-label="{{title}}" 给 open-type button 打了标签。
 * ⚠️ 不收 name —— cy-icon 的 name 是图标 id 不是文案,收了会放过真缺陷。 */
const TEXT_PROPS = ['title', 'label', 'cta', 'text'];

function nameOf(attrs, inner, tag) {
  const m = /\saria-label\s*=\s*"([^"]*)"/.exec(attrs);
  if (m && m[1].trim().length > 0) return 'aria-label';
  if (hasReadableContent(inner)) return 'text';
  if (tag && tag.includes('-')) {
    for (const prop of TEXT_PROPS) {
      const pm = new RegExp('\\s' + prop + '\\s*=\\s*"([^"]*)"').exec(attrs);
      if (pm && pm[1].trim().length > 0) return 'prop:' + prop;
    }
  }
  return null;
}

/** 扫一个 wxml,返回无名点击区列表 */
function scanFile(src, rel) {
  const s = stripComments(src);
  const out = [];
  const re = /<([a-z][a-z0-9-]*)(\s[^>]*)?>/gi;
  let m;
  while ((m = re.exec(s))) {
    const tag = m[1];
    const openStart = m.index;
    const openEnd = tagEnd(s, openStart);
    if (openEnd < 0) continue;
    const attrs = s.slice(openStart + tag.length + 1, openEnd);
    const hasTapHandler = /\s(bind|catch)(:)?tap\s*=/.test(attrs);
    // button/open-type 与 navigator 是原生交互控件，不需要 bindtap 也会被用户激活。
    // 只扫 bindtap 会让纯图标分享按钮在门禁中假绿。
    const isNativeInteractive = tag === 'button' || tag === 'navigator';
    if (!hasTapHandler && !isNativeInteractive) continue;
    // noop / 纯阻止冒泡的不算交互
    if (/=\s*"noop"/.test(attrs)) continue;
    const inner = subtree(s, openStart, openEnd, tag);
    if (nameOf(attrs, inner, tag)) continue;
    const line = s.slice(0, openStart).split('\n').length;
    out.push({ file: rel, line, tag, snippet: s.slice(openStart, Math.min(openEnd + 1, openStart + 120)) });
  }
  return out;
}

function scanRepo() {
  const found = [];
  for (const abs of walkWxml(ROOT)) {
    const rel = path.relative(ROOT, abs);
    found.push(...scanFile(fs.readFileSync(abs, 'utf8'), rel));
  }
  return found;
}

const keyOf = (v) => `${v.file}:${v.line}`;

/* ---------------- 自证:检查器必须能判红 ---------------- */
function selftest() {
  const cases = [
    ['无名图标按钮必须被抓到',
      '<view class="x" bindtap="close"><cy-icon name="close" /></view>', 1],
    ['带 aria-label 的图标按钮放行',
      '<view class="x" bindtap="close" aria-label="关闭"><cy-icon name="close" /></view>', 0],
    ['子树有文字的放行(读屏器念得出来)',
      '<view class="x" bindtap="go"><cy-icon name="a" /><text>发布主题</text></view>', 0],
    ['子树只有插值也算有名',
      '<view class="x" bindtap="go">{{title}}</view>', 0],
    ['自闭合 image 点击区无名必须抓到',
      '<image src="/a.png" catchtap="del" />', 1],
    ['aria-label 是空串不算有名(★假保证)',
      '<view class="x" bindtap="close" aria-label=""><cy-icon name="close" /></view>', 1],
    ['嵌套同名标签不能提前闭合导致漏判',
      '<view bindtap="a"><view class="inner"></view></view>', 1],
    ['嵌套同名标签:内层有文字则外层有名',
      '<view bindtap="a"><view class="inner">文字</view></view>', 0],
    ['noop 不算交互',
      '<view class="x" catchtap="noop"><cy-icon name="a" /></view>', 0],
    ['注释里的点击区不算',
      '<!-- <view bindtap="a"><cy-icon name="x" /></view> -->', 0],
    ['自定义组件的 title 属性算可读名(cy-cell 会把它渲染成文字)',
      '<cy-cell title="店铺资料" bind:tap="go" />', 0],
    ['★负控:title 是空串仍算无名',
      '<cy-cell title="" bind:tap="go" />', 1],
    ['★负控:cy-icon 的 name 不算文案(收了会放过真缺陷)',
      '<view bindtap="a"><cy-icon name="close-sm" /></view>', 1],
    ['★负控:open-type 原生按钮没有 bindtap 也必须被抓到',
      '<button open-type="share"><image src="/share.png" /></button>', 1],
    ['带 aria-label 的 open-type 原生按钮放行',
      '<button open-type="share" aria-label="分享"><image src="/share.png" /></button>', 0],
    ['★负控:navigator 原生跳转没有 bindtap 也必须被抓到',
      '<navigator url="/pages/a/index"><image src="/a.png" /></navigator>', 1],
  ];
  let ok = true;
  for (const [name, src, expect] of cases) {
    const got = scanFile(src, 't.wxml').length;
    const pass = got === expect;
    if (!pass) ok = false;
    console.log(`  ${pass ? '✓' : '✗'} ${name}(期望 ${expect} 实得 ${got})`);
  }
  console.log(ok ? `[a11y-name] 自证通过(${cases.length} 项,含空 aria-label / 空 title / icon-name / 原生控件假保证陷阱)`
                 : '[a11y-name] 自证失败');
  return ok;
}

/* ---------------- main ---------------- */
const argv = process.argv.slice(2);
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

const found = scanRepo();
const keys = found.map(keyOf).sort();

if (argv.includes('--update-baseline')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({ entries: keys }, null, 2) + '\n');
  console.log(`[a11y-name] 基线已写入 ${keys.length} 条`);
  process.exit(0);
}

if (argv.includes('--list')) {
  for (const v of found) console.log(`${v.file}:${v.line} <${v.tag}> ${v.snippet.replace(/\s+/g, ' ').slice(0, 110)}`);
  console.log(`共 ${found.length} 处无名点击区`);
  process.exit(0);
}

if (!selftest()) { console.error('[a11y-name] 检查器自证未过,拒绝给出扫描结论'); process.exit(1); }

const baseline = fs.existsSync(BASELINE)
  ? new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).entries || [])
  : new Set();
const added = keys.filter((k) => !baseline.has(k));
const fixed = [...baseline].filter((k) => !keys.includes(k));

console.log(`[a11y-name] 无名点击区 ${keys.length} 处(基线 ${baseline.size})`);
if (fixed.length) console.log(`[a11y-name] 提示:基线里 ${fixed.length} 条已修好,跑 --update-baseline 收窄棘轮`);
if (added.length) {
  console.error(`[a11y-name] ✗ 新增 ${added.length} 处无名点击区:`);
  for (const k of added) console.error('   ' + k);
  process.exit(1);
}
console.log('[a11y-name] ✓ 无新增(棘轮只许变小)');
