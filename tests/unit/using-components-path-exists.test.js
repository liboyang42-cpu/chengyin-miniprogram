/*
 * 门禁：usingComponents 里的每个绝对路径都必须真的存在。
 *
 *   node tests/unit/using-components-path-exists.test.js
 *
 * 2026-08-05：master 上 pages/merchant/official/index.json 把 cy-btn 写成
 * "/components/cy/button/index"（真实目录是 cy/btn），**整页编译不过**，
 * 报错只在开发者工具里弹一次，CI 完全看不到 —— PR #551 就这么合进去了。
 *
 * 已有的 using-components-registration 门禁管的是「wxml 用了但没注册」，
 * 管不到「注册了但路径不存在」。两个方向都要守。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../..');
const bad = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'miniprogram_npm') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.json')) continue;
    let json;
    try { json = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { continue; }
    const uc = json.usingComponents;
    if (!uc || typeof uc !== 'object') continue;
    for (const [name, ref] of Object.entries(uc)) {
      if (typeof ref !== 'string') continue;
      // 只查绝对路径；相对路径与 npm 包（plugin:// 等）跳过
      if (!ref.startsWith('/')) continue;
      const target = path.join(ROOT, `${ref.slice(1)}.json`);
      if (!fs.existsSync(target)) {
        bad.push(`${path.relative(ROOT, p)}  "${name}": "${ref}"`);
      }
    }
  }
}
walk(ROOT);

if (bad.length) {
  console.error('\n以下 usingComponents 指向的组件不存在，页面会整页编译失败：');
  for (const b of bad) console.error(`  ${b}`);
  console.error('');
}
assert.deepStrictEqual(bad, [], `${bad.length} 处 usingComponents 路径失效`);
console.log('✔ 所有 usingComponents 的绝对路径都指向真实存在的组件');
