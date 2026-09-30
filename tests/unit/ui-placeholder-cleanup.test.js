const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('模板编辑主链存在，旧列表占位 handler 不再残留', () => {
  const listJs = read('subpackageMember/mytemplate/mytemplate.js');
  const listWxml = read('subpackageMember/mytemplate/mytemplate.wxml');
  const detailJs = read('pages/templatedetail/templatedetail.js');
  const editorJs = read('pages/publish/temp/index.js');

  assert.doesNotMatch(listJs, /模板编辑功能暂未开放|onEditTemplate/);
  assert.doesNotMatch(listWxml, /onEditTemplate/);
  assert.match(detailJs, /pages\/publish\/temp\/index\?id=/,
    '模板详情页必须保留进入现有编辑器的入口');
  assert.match(editorJs, /options\.id[\s\S]*getData\(\)/,
    '编辑器必须按模板 id 回填已有模板');
});

test('商家营销工具入口与唯一合作中心入口都有明确路由', () => {
  const js = read('pages/merchant/marketing/index.js');
  const wxml = read('pages/merchant/marketing/index.wxml');
  const relationJs = read('pages/merchant/relation/index.js');
  const relationWxml = read('pages/merchant/relation/index.wxml');

  assert.match(wxml, /data-action="\{\{item\.action\}\}"/);
  for (const action of ['coupon', 'decor']) {
    assert.match(js, new RegExp(`action === ['"]${action}['"]`), `${action} 入口必须有处理分支`);
  }
  assert.match(js, /subpackageMember\/coupon\/coupon/);
  assert.match(wxml, /bindtap="goCoopCenter"/);
  assert.match(js, /pages\/merchant\/coop-center\/index/);
  assert.doesNotMatch(js, /pages\/merchant\/official\/index/);
  assert.doesNotMatch(relationJs, /pages\/coop\/list\/index|goInvites/);
  assert.doesNotMatch(relationWxml, /bindtap="goInvites"/);
  assert.match(js, /pages\/merchant\/decor\/index/);
  assert.doesNotMatch(js, /title:\s*['"](?:即将开放|功能建设中|暂未开放)/);

  // 旧 `review` 假入口仍不得复活。2026-09-18 UI-09 按用户稿 p07zJMtMOc1yT1AuLTKtSs 37:2 营销页只留 4 格,「口碑管理」入口删除(用户确认评价管理页暂无入口)。
  assert.doesNotMatch(js, /action === ['"]review['"]/, '评价死入口不得复活');
  assert.doesNotMatch(js, /pages\/merchant\/profile\/index/, '营销页不得跳商家公开名片页');

  // 优惠券只留带领取/核销数的那张汇总卡,图标格里不再放第二份同路由入口
  assert.equal((wxml.match(/data-action="coupon"/g) || []).length, 1, '优惠券入口只能有一处');

  // AI 任务建议已按用户要求整块删除
  assert.doesNotMatch(js, /task-suggest|aiSuggestions/, 'AI 任务建议不得复活');
  assert.doesNotMatch(wxml, /ai-entry|ai-sheet/, 'AI 任务建议不得复活');
});

test('商家工作台「更多」不留评价死入口', () => {
  const js = read('pages/merchant/index/index.js');
  const wxml = read('pages/merchant/index/index.wxml');

  assert.doesNotMatch(wxml, /data-action="review"/, '「更多」里的评价入口已删');
  assert.doesNotMatch(js, /goReviews/, 'goReviews handler 一并删掉,不留孤儿');
  // 负控:同组其它入口仍在,证明上面两条不是因为文件读空而恒真
  assert.match(wxml, /data-action="messages"/);
  assert.match(js, /goMessages\(\)/);
});

test('A14：俱乐部目录按用户备注删除顶部搜索，旧占位 handler 也不残留', () => {
  const js = read('pages/talent/list/index.js');
  const wxml = read('pages/talent/list/index.wxml');

  assert.doesNotMatch(wxml, /bindtap="onSearchTap"|nav-search/);
  assert.doesNotMatch(js, /onSearchTap|onClubTodo|功能建设中/);
});

test('商家台账使用 view 条件链，已撤销合作分润 tab 不会产生孤立 wx:elif', () => {
  const source = read('pages/merchant/ledger/index.wxml');
  assert.match(source,
    /<cy-state-shell[^>]*wx:if="\{\{routeError\}\}"[\s\S]*?<block wx:elif="\{\{view === 'redemptions'\}\}">[\s\S]*?<cy-skeleton wx:elif="\{\{loading && !hasLoaded\}\}"[\s\S]*?<cy-error wx:elif="\{\{error && !hasLoaded\}\}"[\s\S]*?<block wx:else>[\s\S]*?<block wx:if="\{\{view === 'settlement'\}\}">/,
    '路由、核销、结算首载和正文必须组成合法条件链，正文内从 settlement 的 wx:if 开始');
  assert.match(source, /<block wx:else>/);
  assert.doesNotMatch(source, /tab===3|wx:elif="\{\{tab/);
});
