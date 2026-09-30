/**
 * CU-M-43(2026-09-23 用户裁决 B)· 「屏蔽」暂不开放。
 *
 * 修复前:公开视角的「···」菜单里挂着一条「屏蔽」,点下去只弹一句「已屏蔽」——
 * 没有 wx.request、没有 setStorage、没有任何 setData,重进页面一切照旧。是句假成功,
 * 而「屏蔽」的语义是用户间拉黑关系(已有 /api/im/block),假成功比不提供更坏。
 *
 * 裁决:摘掉该入口(不许假成功),商家看自己主页也不显示。
 * 负控在测试内联:把入口塞回去,同一条断言必须真红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const WXML_PATH = 'components/cy/profile/index.wxml';
const JS_PATH = 'components/cy/profile/index.js';

// 注释里必须能写清「曾经错在哪」,所以断言只看代码:模板注释与 JS 注释先抹掉。
const codeOnlyWxml = (src) => src.replace(/<!--[\s\S]*?-->/g, '');
const codeOnlyJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const wxml = read(WXML_PATH);
const js = read(JS_PATH);

/** 更多菜单里不许有「屏蔽」入口,也不许留下假成功的处理器。 */
function checkNoBlockEntry(source, script) {
  const template = codeOnlyWxml(source);
  const code = codeOnlyJs(script);
  assert.doesNotMatch(template, /bind:tap="onBlock"/, '「屏蔽」入口必须摘掉(裁决 B:不许假成功)');
  assert.doesNotMatch(template, /title="屏蔽"/, '菜单里不得残留「屏蔽」这一行');
  assert.doesNotMatch(code, /onBlock/, 'onBlock 处理器随入口一起摘,不许留死代码');
  assert.doesNotMatch(code, /已屏蔽/, '不许留只弹 toast 的假成功');
}

test('公开视角更多菜单不再提供「屏蔽」,也不留假成功处理器', () => {
  checkNoBlockEntry(wxml, js);
});

test('负控:把「屏蔽」入口塞回去时必须判红', () => {
  const regressed = wxml.replace(
    '<cy-cell wx:if="{{isSelf}}" title="设置"',
    '<cy-cell title="屏蔽" danger arrow="{{false}}" bind:tap="onBlock" />\n  <cy-cell wx:if="{{isSelf}}" title="设置"'
  );
  assert.notEqual(regressed, wxml, '负控锚点失效:注释头已改名,扫描口径需同步');
  assert.throws(() => checkNoBlockEntry(regressed, js), assert.AssertionError);
});

test('更多菜单本身仍在:分享主页是公开视角的合法操作', () => {
  assert.match(wxml, /<cy-cell title="分享主页" arrow="\{\{false\}\}" bind:tap="onShareProfile" \/>/);
  const menu = wxml.slice(wxml.indexOf('member-more-menu'));
  assert.match(menu, /onShareProfile/);
});
