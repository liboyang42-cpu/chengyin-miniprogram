/**
 * 契约:承接页两个骨干组件(project-host / project-join)在自己 wxml 里读的每个 prop,
 * 宿主 merchantinfo.wxml 的对应标签上必须真的传。
 *
 * 背景(2026-09-05 截图走查抓到的):「编辑」改「更多」那一版给 project-join 的 wxml 加了
 * <project-drawer show="{{ moreSheet.show }}">,组件 properties 也声明了 moreSheet,
 * 但宿主只把 moreSheet 传给了 project-host —— **承接方(商家)点「更多」,抽屉永远不会打开**。
 *
 * ⚠️ 这个洞当时全仓门禁一条都没红:
 *   · 5072 条单测测的是 page.buildMoreGroups() / page.onMorePick() 的逻辑,那些都对;
 *   · U4「死数据字段」管的是**反方向** —— setData 了但 wxml 没消费;
 *     这里是 wxml 消费了但没人传,U4 反而因为「传给了 project-host」判定它被消费了。
 * 只有把页面拍出来才看得见。所以判据补在这里。
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const HOST_WXML = path.join(ROOT, 'pages/topic/merchantinfo/merchantinfo.wxml');

/** 组件 js 的 properties 里声明的 prop 名 */
function declaredProps(componentDir) {
  const js = fs.readFileSync(path.join(ROOT, componentDir, 'index.js'), 'utf8');
  const block = js.slice(js.indexOf('properties:'), js.indexOf('methods:'));
  return new Set([...block.matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*)\s*:\s*\{/gm)].map((m) => m[1]));
}

/** 组件自己 wxml 里真正读过的 prop(出现为 `名字.` 或 `{{ 名字 }}` 或 `名字.length`) */
function consumedProps(componentDir, declared) {
  const wxml = fs.readFileSync(path.join(ROOT, componentDir, 'index.wxml'), 'utf8');
  const used = new Set();
  for (const name of declared) {
    const re = new RegExp(`\\{\\{[^}]*\\b${name}\\b`, '');
    if (re.test(wxml)) used.add(name);
  }
  return used;
}

/** 宿主标签上传了哪些 prop。tag 形如 'project-join' */
function passedProps(tag) {
  const host = fs.readFileSync(HOST_WXML, 'utf8');
  const start = host.indexOf(`<${tag}`);
  assert.ok(start >= 0, `${HOST_WXML} 里没有 <${tag}>`);
  const end = host.indexOf('/>', start);
  const block = host.slice(start, end);
  // kebab-case 传参在小程序里映射到 camelCase 的 prop
  return new Set([...block.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)="/g)]
    .map((m) => m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())));
}

for (const [tag, dir] of [
  ['project-join', 'pages/topic/components/project-join'],
  ['project-host', 'pages/topic/components/project-host'],
]) {
  test(`${tag} 在 wxml 里读的 prop，宿主必须真的传`, () => {
    const declared = declaredProps(dir);
    assert.ok(declared.size > 10, `${tag} 的 properties 只解析到 ${declared.size} 个，正则大概率失配`);
    const consumed = consumedProps(dir, declared);
    const passed = passedProps(tag);
    const missing = [...consumed].filter((name) => !passed.has(name)).sort();
    assert.deepEqual(missing, [],
      `${tag} 的 wxml 用到了这些 prop，但 merchantinfo.wxml 的 <${tag}> 一个都没传 —— `
      + `界面上表现为「点了没反应」，且全仓其它门禁都不会红:\n  ` + missing.join('\n  '));
  });
}

test('★负控:把 moreSheet 从宿主标签上摘掉必须判红', () => {
  const host = fs.readFileSync(HOST_WXML, 'utf8');
  const start = host.indexOf('<project-join');
  const block = host.slice(start, host.indexOf('/>', start));
  assert.match(block, /moreSheet="\{\{ moreSheet \}\}"/,
    'project-join 没收到 moreSheet —— 承接方的「更多」抽屉打不开');

  // 判据本身要能红:摘掉之后 passedProps 就不含它
  const stripped = block.replace(/\s*moreSheet="\{\{ moreSheet \}\}"/, '');
  const names = new Set([...stripped.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)="/g)].map((m) => m[1]));
  assert.ok(!names.has('moreSheet'));
});
