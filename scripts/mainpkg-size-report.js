#!/usr/bin/env node
/* mainpkg-size-report.js —— 主包体积构成与可下沉项(只报告,不判红) (2026-08-27, X04)
 *
 * 为什么是报告不是门禁:真实的判据是微信编译器压缩后的字节数,本脚本量的是源码字节。
 * 判红需要 scripts/wechat-release-contract.js 拿 DevTools 的 --info-output 回读
 * (发版 checklist B 段已经写死了这一步)。本脚本回答的是另一个问题:
 * **余量薄的时候,先动哪儿。**
 *
 * 三张表:
 *   ① 主包源码字节构成(已排除 project.config.json 里 packOptions.ignore 的目录)
 *   ② 主包里零引用的组件 —— 没有任何 usingComponents 指向它
 *   ③ 主包里只被单个分包用到的组件 —— 下沉到该分包即从主包移出
 *
 * ⚠️ ② 的「零引用」不等于「可以删」:那可能是设计系统里备着的组件。
 *    ignoreUploadUnusedFiles 开着时它们本来就不会被打进包,删不删是产品决定,不是体积决定。
 *
 * 用法: node scripts/mainpkg-size-report.js [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const projectCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));

const ignoredDirs = new Set(
  ((projectCfg.packOptions || {}).ignore || [])
    .filter((e) => e.type === 'folder')
    .map((e) => e.value.replace(/^\.\//, ''))
);
ignoredDirs.add('node_modules');
ignoredDirs.add('miniprogram_npm');

const subRoots = (app.subPackages || app.subpackages || []).map((sp) => sp.root.replace(/\/$/, ''));
const inSubPackage = (rel) => subRoots.some((r) => rel === r || rel.startsWith(r + '/'));

function dirBytes(abs, relBase) {
  let total = 0;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(relBase, e.name);
    if (e.name.startsWith('.') || ignoredDirs.has(rel) || ignoredDirs.has(e.name)) continue;
    if (inSubPackage(rel)) continue;
    const full = path.join(abs, e.name);
    total += e.isDirectory() ? dirBytes(full, rel) : fs.statSync(full).size;
  }
  return total;
}

/** 谁在 usingComponents 里指向 components/cy/<name> */
function componentUsers() {
  const users = new Map();      // comp -> Set<owner>   owner = 'MAIN' | 分包 root
  const jsons = [];
  (function walk(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.') || ignoredDirs.has(e.name)) continue;
      const r = path.posix.join(rel, e.name);
      const full = path.join(abs, e.name);
      if (e.isDirectory()) walk(full, r);
      else if (e.name.endsWith('.json')) jsons.push([full, r]);
    }
  })(ROOT, '');
  for (const [full, rel] of jsons) {
    let d;
    try { d = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { continue; }
    const uc = d.usingComponents || {};
    const owner = subRoots.find((r) => rel.startsWith(r + '/')) || 'MAIN';
    for (const target of Object.values(uc)) {
      const m = /components\/cy\/([A-Za-z0-9_-]+)/.exec(String(target).replace(/\\/g, '/'));
      if (!m) continue;
      if (!users.has(m[1])) users.set(m[1], new Set());
      users.get(m[1]).add(owner);
    }
  }
  return users;
}

const kb = (n) => (n / 1024).toFixed(0) + 'KB';

const composition = [];
for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('.') || ignoredDirs.has(e.name)) continue;
  if (inSubPackage(e.name)) continue;
  const b = dirBytes(path.join(ROOT, e.name), e.name);
  if (b > 0) composition.push({ dir: e.name, bytes: b });
}
composition.sort((a, b) => b.bytes - a.bytes);
const mainTotal = composition.reduce((s, x) => s + x.bytes, 0);

const users = componentUsers();
const compDir = path.join(ROOT, 'components/cy');
const unused = [];
const sinkable = [];
for (const name of fs.readdirSync(compDir)) {
  const full = path.join(compDir, name);
  if (!fs.statSync(full).isDirectory()) continue;
  const bytes = dirBytes(full, 'components/cy/' + name);
  const owners = users.get(name);
  if (!owners || owners.size === 0) { unused.push({ name, bytes }); continue; }
  if (owners.size === 1 && !owners.has('MAIN')) sinkable.push({ name, owner: [...owners][0], bytes });
}
unused.sort((a, b) => b.bytes - a.bytes);
sinkable.sort((a, b) => b.bytes - a.bytes);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ mainTotal, composition, unused, sinkable }, null, 2));
  process.exit(0);
}

console.log('主包源码字节构成(已排除 packOptions.ignore;真实判据见 wechat-release-contract.js)');
for (const c of composition) console.log(`  ${c.dir.padEnd(14)} ${kb(c.bytes).padStart(8)}`);
console.log(`  ${'合计'.padEnd(13)} ${kb(mainTotal).padStart(8)}   (微信主包上限 2MB,压缩前)`);

console.log(`\n主包里零引用的组件 ${unused.length} 个,合计 ${kb(unused.reduce((s, x) => s + x.bytes, 0))}`);
console.log('  ⚠️ 零引用 ≠ 可以删:可能是设计系统里备着的。删不删是产品决定。');
for (const u of unused) console.log(`  ${u.name.padEnd(24)} ${kb(u.bytes).padStart(8)}`);

console.log(`\n只被单个分包用到、可下沉的组件 ${sinkable.length} 个,合计 ${kb(sinkable.reduce((s, x) => s + x.bytes, 0))}`);
for (const s of sinkable) console.log(`  ${s.name.padEnd(24)} → ${s.owner.padEnd(22)} ${kb(s.bytes).padStart(8)}`);
