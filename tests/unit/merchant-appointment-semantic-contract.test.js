const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('商家更多菜单不再用预约文案跳转核销台账', () => {
  const wxml = read('pages/merchant/index/index.wxml');
  const js = read('pages/merchant/index/index.js');

  const menuStart = wxml.indexOf('<view class="rv-more-list">');
  const menuEnd = wxml.indexOf('</cy-scene-sheet>', menuStart);
  assert.notEqual(menuStart, -1, '必须能定位到商家更多菜单');
  assert.notEqual(menuEnd, -1, '商家更多菜单必须有完整场景容器');
  const menu = wxml.slice(menuStart, menuEnd);
  const menuActions = Array.from(menu.matchAll(/data-action=["']([^"']+)["']/g), (match) => match[1]);

  const onMoreMatch = js.match(/onMoreItem\(e\)\s*\{[\s\S]*?\n\s*\},/);
  assert.ok(onMoreMatch, '必须能定位到更多菜单分发逻辑');
  const onMore = onMoreMatch[0];

  assert.deepEqual(menuActions, ['messages', 'aftercare', 'coupon', 'brand']);
  assert.doesNotMatch(menu, /预约|预订|booking|appointment/i);
  assert.doesNotMatch(onMore, /预约|预订|booking|appointment/i);
  // 2026-09-22 M-07:「我的消息」核销流水点开去核销记录是正当入口,但只许挂在 goEvent 上、不许带预约口吻。
  const eventMatch = js.match(/goEvent\(e\)\s*\{[\s\S]*?\n\s*\},/);
  assert.ok(eventMatch, '必须能定位到经营动态跳转');
  assert.doesNotMatch(eventMatch[0], /预约|预订|booking|appointment/i);
  assert.doesNotMatch(js.replace(eventMatch[0], ''), /pages\/merchant\/ledger\/index\?view=redemptions/,
    '除经营动态外,商家首页不得另挂核销台账入口(防伪装成预约入口)');
});

test('核销记录仍由真实财务入口承载', () => {
  const js = read('pages/merchant/index/index.js');

  assert.match(js, /goFinance\s*\(\)[\s\S]*pages\/merchant\/ledger\/index/);
});

test('M-07:更多里的协作邀请 = 合作中心铃铛页;「我的消息」按类型去结算/核销记录,不再落空兼容页', () => {
  const wxml = read('pages/merchant/index/index.wxml');
  const js = read('pages/merchant/index/index.js');
  const coopCenter = read('pages/merchant/coop-center/index.js');

  assert.match(coopCenter, /goInbox\(\)\s*\{\s*wx\.navigateTo\(\{ url: '\/pages\/coop\/list\/index' \}\)/, '铃铛页是协作邀请真源');
  assert.match(js, /goMessages\(\)\s*\{\s*wx\.navigateTo\(\{ url: '\/pages\/coop\/list\/index' \}\)/, '更多→协作邀请必须与铃铛同页');
  assert.match(wxml, /<view class="rv-more-item" wx:if="\{\{merchantAccess\.canManageCoop\}\}" bindtap="onMoreItem" data-action="messages" aria-role="button" aria-label="打开协作邀请"[\s\S]*?<text class="rv-more-label">协作邀请<\/text>/);
  // CU-M-150:这一页只有「收到的 / 我发出的」协作记录,入口不得再自称覆盖全部消息。
  assert.doesNotMatch(wxml, /<text class="rv-more-label">消息中心<\/text>/, '「消息中心」留给真正的消息聚合,否则商家找一般消息会走错');
  assert.doesNotMatch(js, /ledger\/index\?tab=1/, '不得再跳到空的「消息与动态」兼容页');
  assert.match(wxml, /bindtap="goEvent" data-type="\{\{item\.type\}\}"/);
  assert.match(js, /type === 'income' \? 'settlement' : 'redemptions'/);
});
