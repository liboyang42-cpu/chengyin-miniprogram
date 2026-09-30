'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/marketing/index.wxml'), 'utf8');

// 2026-08-26 营销页重做后收窄:
// 原来这里还钉着「点击入口正好 5 个」和 .entry-row / .coop-entry 两个类名,
// 以及重试卡必须是 <cy-card interactive>。那三条钉的是 markup 长相 ——
// 每次重设计都得重写一遍,却拦不住任何真缺陷(这次改版它们全红,但页面无障碍是好的)。
// cy-card 的 interactive / accessibilityLabel 语义另有 merchant-apply-state-contract、
// merchant-coop-center-load-state-contract、play-visual-consolidation 三处覆盖,
// 且仍有 5 个页面在用,从这里删掉不丢覆盖。
//
// 留下的是真规则:自定义可点元素在小程序里没有原生按钮语义,读屏器只能靠
// aria-role + aria-label,漏一个就等于这个入口对读屏器不存在。这条与入口数量无关。
test('商家营销页每个自定义点击入口都有 button 角色和可读名称', () => {
  const tags = wxml.match(/<(?:view|cy-card)\b[^>]*\bbindtap="[^"]+"[^>]*>/g) || [];
  assert.ok(tags.length > 0, '没扫到任何自定义点击入口,选择器多半失效了 —— 恒绿比红更危险');
  tags.forEach((tag) => {
    assert.match(tag, /\baria-role="button"/, tag);
    assert.match(tag, /\baria-label="[^"]+"/, tag);
  });
});

test('负控:任一自定义点击入口漏掉 aria-role / aria-label 时契约必须转红', () => {
  const stripped = wxml.replace(/(\<view\b[^>]*\bbindtap="[^"]+"[^>]*?)\saria-role="button"/, '$1');
  assert.notEqual(stripped, wxml, '负控没改到东西,说明上面的选择器已经失效');
  const tags = stripped.match(/<(?:view|cy-card)\b[^>]*\bbindtap="[^"]+"[^>]*>/g) || [];
  assert.throws(() => {
    tags.forEach((tag) => { assert.match(tag, /\baria-role="button"/, tag); });
  }, '摘掉一个 aria-role 之后契约仍然绿 = 这条断言是摆设');
});
