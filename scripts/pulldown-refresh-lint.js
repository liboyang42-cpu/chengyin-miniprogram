#!/usr/bin/env node
/* pulldown-refresh-lint.js —— 下拉刷新必须真的能触发(2026-08-22)
 *
 * 抓的是**声称有、实际死**的下拉刷新。三类:
 *
 *   A. 死的 enablePullDownRefresh —— json 开了页面级下拉刷新,但页面主体是整屏
 *      <scroll-view style="height:100vh"> ⇒ 页面自身永不滚动 ⇒ 下拉刷新**从来不会触发**。
 *      实证:pages/merchant/index/index 就是这样,声明了但从来没生效过。
 *      正解:改用 scroll-view 自带的 refresher-enabled + bindrefresherrefresh。
 *
 *   B. 开了却没 handler —— json 开了但 js 里没有 onPullDownRefresh ⇒ 转圈不停。
 *
 *   C. handler 不收圈 —— 有 onPullDownRefresh 但从不调 wx.stopPullDownRefresh ⇒ 转圈不停。
 *      (scroll-view 的 refresher 对应的是 refresher-triggered 必须能被置回 false。)
 *
 * ⚠️ 判 A 的关键不是「有没有 scroll-view」,而是「页面主体是不是被整屏 scroll-view 接管」——
 * 页内局部的横滑 scroll-view 不影响页面级滚动,不该误报。
 *
 * 用法:--selftest(自证) / --list(列明细) / 无参(扫描,超基线判红) / --update-baseline
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, 'tests/lint/pulldown-refresh-baseline.json');
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'dist']);

function walkJson(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJson(full, acc);
    else if (e.name.endsWith('.json')) acc.push(full);
  }
  return acc;
}

/** 页面主体是否被整屏 scroll-view 接管(⇒ 页面级下拉刷新永不触发) */
function ownedByFullScreenScrollView(wxml) {
  // 只认「纵向滚动 + 撑满视口高度」的 scroll-view;横滑/局部的不算
  const re = /<scroll-view\b([^>]*)>/g;
  let m;
  while ((m = re.exec(wxml))) {
    const attrs = m[1];
    const vertical = /\bscroll-y\b/.test(attrs);
    const fullHeight = /height:\s*100vh|height:\s*100%/.test(attrs);
    if (vertical && fullHeight) return true;
  }
  return false;
}

function scanPage(jsonPath) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { return null; }
  if (cfg.enablePullDownRefresh !== true) return null;
  const base = jsonPath.slice(0, -5);
  const rel = path.relative(ROOT, base);
  const wxml = fs.existsSync(base + '.wxml') ? fs.readFileSync(base + '.wxml', 'utf8') : '';
  const js = fs.existsSync(base + '.js') ? fs.readFileSync(base + '.js', 'utf8') : '';

  if (ownedByFullScreenScrollView(wxml) && !/refresher-enabled/.test(wxml)) {
    return { key: rel, kind: 'A', why: '页面主体是整屏 scroll-view,页面级下拉刷新永不触发;应改用 refresher-enabled' };
  }
  if (!/onPullDownRefresh/.test(js)) {
    return { key: rel, kind: 'B', why: '开了 enablePullDownRefresh 却没有 onPullDownRefresh,会一直转圈' };
  }
  if (!/stopPullDownRefresh/.test(js)) {
    return { key: rel, kind: 'C', why: 'onPullDownRefresh 从不调 wx.stopPullDownRefresh,圈收不回来' };
  }
  return null;
}

function scanRepo() {
  const out = [];
  for (const j of walkJson(ROOT)) {
    const v = scanPage(j);
    if (v) out.push(v);
  }
  return out;
}

/* ---------------- 自证 ---------------- */
function selftest() {
  const cases = [
    ['整屏 scroll-view 且未接 refresher ⇒ 判 A(死的下拉刷新)',
      { wxml: '<scroll-view scroll-y style="height: 100vh"></scroll-view>', js: 'Page({onPullDownRefresh(){wx.stopPullDownRefresh()}})' }, 'A'],
    ['整屏 scroll-view 但已接 refresher ⇒ 放行',
      { wxml: '<scroll-view scroll-y refresher-enabled style="height: 100vh"></scroll-view>', js: 'Page({onPullDownRefresh(){wx.stopPullDownRefresh()}})' }, null],
    ['★局部横滑 scroll-view 不该误报',
      { wxml: '<scroll-view scroll-x class="row"></scroll-view><view>正文</view>', js: 'Page({onPullDownRefresh(){wx.stopPullDownRefresh()}})' }, null],
    ['★纵向但不满屏的 scroll-view 不该误报',
      { wxml: '<scroll-view scroll-y style="height: 400rpx"></scroll-view>', js: 'Page({onPullDownRefresh(){wx.stopPullDownRefresh()}})' }, null],
    ['开了却没 handler ⇒ 判 B',
      { wxml: '<view>正文</view>', js: 'Page({})' }, 'B'],
    ['有 handler 但不收圈 ⇒ 判 C',
      { wxml: '<view>正文</view>', js: 'Page({onPullDownRefresh(){this.load()}})' }, 'C'],
    ['完整正确 ⇒ 放行',
      { wxml: '<view>正文</view>', js: 'Page({onPullDownRefresh(){this.load();wx.stopPullDownRefresh()}})' }, null],
  ];
  let ok = true;
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pdr-'));
  for (const [name, files, expect] of cases) {
    const b = path.join(tmp, 'p' + Math.abs(name.length) + files.js.length);
    fs.writeFileSync(b + '.json', JSON.stringify({ enablePullDownRefresh: true }));
    fs.writeFileSync(b + '.wxml', files.wxml);
    fs.writeFileSync(b + '.js', files.js);
    const got = scanPage(b + '.json');
    const kind = got ? got.kind : null;
    const pass = kind === expect;
    if (!pass) ok = false;
    console.log(`  ${pass ? '✓' : '✗'} ${name}(期望 ${expect || '放行'} 实得 ${kind || '放行'})`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? '[pulldown] 自证通过(7 项,含横滑/非满屏两条误报陷阱)' : '[pulldown] 自证失败');
  return ok;
}

/* ---------------- main ---------------- */
const argv = process.argv.slice(2);
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

const found = scanRepo();
const keys = found.map((f) => `${f.key}#${f.kind}`).sort();

if (argv.includes('--update-baseline')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({ entries: keys }, null, 2) + '\n');
  console.log(`[pulldown] 基线已写入 ${keys.length} 条`);
  process.exit(0);
}
if (argv.includes('--list')) {
  for (const f of found) console.log(`${f.key} [${f.kind}] ${f.why}`);
  console.log(`共 ${found.length} 处失效的下拉刷新`);
  process.exit(0);
}
if (!selftest()) { console.error('[pulldown] 检查器自证未过,拒绝给出扫描结论'); process.exit(1); }

const baseline = fs.existsSync(BASELINE)
  ? new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).entries || [])
  : new Set();
const added = keys.filter((k) => !baseline.has(k));
console.log(`[pulldown] 失效的下拉刷新 ${keys.length} 处(基线 ${baseline.size})`);
if (added.length) {
  console.error(`[pulldown] ✗ 新增 ${added.length} 处:`);
  for (const k of added) console.error('   ' + k);
  process.exit(1);
}
console.log('[pulldown] ✓ 无新增');
