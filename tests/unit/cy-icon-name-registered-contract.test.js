/**
 * 契约:wxml 里写给 <cy-icon> 的每个图标名都必须在 icons.wxss 的注册清单里。
 *
 * 背景(2026-09-05 截图走查抓到的):章节抽屉的「展开全文」用了
 * name="{{ storyOpen ? 'arrow-up' : 'arrow-down' }}" —— 62 枚 coolicons 里根本没有这两个名字。
 * cy-icon 靠 `.cyi--{name}` 提供 mask,类名不存在时 --cyi-m 为空,整块退化成一个**纯黑方块**。
 *
 * ⚠️ 这个错误当时全仓门禁一条都没红:ds-hardcode / UI-GATE-0 / silentError / 5072 条单测全绿,
 *    只有把页面拍出来才看得见。所以判据补在这里 —— 图标名写错是纯静态可判的事,
 *    不该靠人眼在截图里发现。
 *
 * 覆盖两种写法:
 *   ① 字面量  name="arrow-right"
 *   ② 三元的两个分支 name="{{ cond ? 'check' : 'lock' }}"(含嵌套三元)
 * 不覆盖 name="{{item.icon}}" 这种数据驱动的 —— 名字在 js 里,得由那边自己保证;
 * 这条契约只管「wxml 里写死的名字」,那正是最容易手滑写错的一类。
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const ICONS_WXSS = path.join(ROOT, 'components/cy/icon/icons.wxss');

function registeredNames() {
  const css = fs.readFileSync(ICONS_WXSS, 'utf8');
  const names = new Set();
  const re = /^\.cyi--([a-z0-9-]+)/gm;
  let m;
  while ((m = re.exec(css))) names.add(m[1]);
  return names;
}

function wxmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (/^(node_modules|miniprogram_npm|\.git)$/.test(entry.name)) continue;
      wxmlFiles(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith('.wxml')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** 一个 wxml 里所有写死的 cy-icon 名字:[{name, line}] */
function hardcodedIconNames(source) {
  const found = [];
  const lineOf = (index) => source.slice(0, index).split('\n').length;
  const tagRe = /<cy-icon\b[^>]*>/g;
  let tag;
  while ((tag = tagRe.exec(source))) {
    const attr = /name="([^"]*)"/.exec(tag[0]);
    if (!attr) continue;
    const value = attr[1];
    const line = lineOf(tag.index);
    if (!value.includes('{{')) {
      if (/^[a-z0-9-]+$/.test(value)) found.push({ name: value, line });
      continue;
    }
    // 三元的分支值:? 'x' 与 : 'y'。用 ?/: 而不是所有引号 ——
    // 否则 `item.type === 'income' ? 'finance' : 'bell'` 里的比较值 'income' 会被误当图标名。
    const branchRe = /[?:]\s*'([a-z0-9-]+)'/g;
    let b;
    while ((b = branchRe.exec(value))) found.push({ name: b[1], line });
  }
  return found;
}

test('wxml 里写死的 cy-icon 名字必须都在 icons.wxss 注册过', () => {
  const registered = registeredNames();
  assert.ok(registered.size >= 60, `注册清单只解析到 ${registered.size} 个，正则大概率失配`);

  const offenders = [];
  for (const file of wxmlFiles(path.join(ROOT, 'pages'))
    .concat(wxmlFiles(path.join(ROOT, 'components')))
    .concat(fs.readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^subpackage/.test(e.name))
      .flatMap((e) => wxmlFiles(path.join(ROOT, e.name))))) {
    for (const hit of hardcodedIconNames(fs.readFileSync(file, 'utf8'))) {
      if (!registered.has(hit.name)) {
        offenders.push(`${path.relative(ROOT, file)}:${hit.line} name="${hit.name}"`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    '这些图标名没注册，cy-icon 会渲染成纯黑方块(全仓其它门禁都不会红):\n' + offenders.join('\n'));
});

test('★负控:注册清单外的名字必须判红，三元的比较值不得误报', () => {
  const registered = new Set(['check', 'lock', 'arrow-right', 'bell', 'finance']);
  const probe = (src) => hardcodedIconNames(src)
    .filter((h) => !registered.has(h.name)).map((h) => h.name);

  // 字面量写错 → 抓到
  assert.deepEqual(probe('<cy-icon name="arrow-down" size="24" />'), ['arrow-down']);
  // 三元分支写错 → 抓到
  assert.deepEqual(probe("<cy-icon name=\"{{ open ? 'arrow-up' : 'arrow-down' }}\" />"),
    ['arrow-up', 'arrow-down']);
  // 三元的**比较值**不是图标名 → 不许误报(item.type === 'income' 里的 income)
  assert.deepEqual(
    probe("<cy-icon name=\"{{ item.type === 'income' ? 'finance' : (item.type === 'verify' ? 'check' : 'bell') }}\" />"),
    []);
  // 数据驱动的名字不在本契约管辖内 → 不报
  assert.deepEqual(probe('<cy-icon name="{{item.icon}}" />'), []);
  // 合法的字面量 → 不报
  assert.deepEqual(probe('<cy-icon name="arrow-right" size="28" />'), []);
});
