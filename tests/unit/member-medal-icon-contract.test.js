// 勋章列表正式图标契约：有 medalImg 时优先展示图片，缺图时只允许通用 cy-icon。
// JS 仍可保留历史 emoji 字段供其它数据链路使用；页面不能把它当作正式 UI 图标渲染。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 2026-08-06：主页统一到 cy-profile 共用组件后，member/index 与 userinfo 的 wxml
// 只剩一行 <cy-profile />，本文件的断言原本钉在旧结构的节点上。约束没失效、只是搬进了
// 组件 —— 用 helper 在读文件这一层展开，断言原样保留。

// 2026-08-06 主页统一到 cy-profile 共用组件：member/index 与 userinfo 的 wxml/wxss
// 只剩壳，本文件的断言原本钉在旧结构上。约束没失效、只是搬进了组件 ——
// 在读文件这一层展开，断言原样保留。
const { readResolved } = require('../helpers/resolve-profile');

const XCX = process.env.MEMBER_MEDAL_CONTRACT_ROOT || path.resolve(__dirname, '../..');
const read = (file) => readResolved(file);

test('勋章图片优先，缺失图片使用通用 star 图标而不渲染 emoji', () => {
  const wxml = read('pages/member/index/index.wxml');

  assert.match(
    wxml,
    /<image class="pc-achv-ico" wx:if="\{\{item\.medalImg\}\}" src="\{\{item\.medalImg\}\}"/,
    'medalImg 存在时必须优先走图片'
  );
  assert.match(
    wxml,
    /<view class="pc-achv-ico pc-achv-ico--fallback" wx:else[\s\S]*?<cy-icon\b[^>]*name="star"[^>]*\/>[\s\S]*?<\/view>/,
    'medalImg 缺失时必须渲染 star cy-icon 兜底'
  );
  assert.doesNotMatch(wxml, /item\.emoji/, '正式勋章图标不得消费 emoji 字段');
  assert.doesNotMatch(wxml, /pc-achv-ico--emoji/, '正式勋章图标不得保留 emoji fallback class');
});
