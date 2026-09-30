const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WXML = fs.readFileSync(
  path.join(__dirname, '../../pages/play/index.wxml'), 'utf8');

const LEAD_ROWS = [
  ['leadBroadcastFromTools', '队伍位置'],
  ['leadVerifyMemberTicketFromTools', '扫成员票核销'],
  ['leadShowGroupCodeFromTools', '展示整团码'],
  ['leadUnlockFromTools', '解锁下一章节'],
  ['leadSettleFromTools', '整团结算'],
];

/** 抽出上滑工具抽屉(scroll-view.tools)的整段内容。 */
function toolsDrawer() {
  const start = WXML.indexOf('<scroll-view class="tools"');
  assert.notEqual(start, -1, '找不到上滑工具抽屉');
  const end = WXML.indexOf('</scroll-view>', start);
  assert.notEqual(end, -1, '工具抽屉没有闭合');
  return WXML.slice(start, end);
}

/** 抽出 mode==2(自由探索)那个分支,用来证明领队行不在它里面。 */
function freeExploreBranch(drawer) {
  const start = drawer.indexOf('<block wx:if="{{mode==2}}">');
  assert.notEqual(start, -1, '找不到自由探索分支');
  const end = drawer.indexOf('</block>', start);
  return drawer.slice(start, end);
}

test('FREE_EXPLORE 有 lead 时底栏必须出来,否则领队够不着任何工具', () => {
  const bar = WXML.match(/<view class="pbar [^>]*wx:if="\{\{([^"]+)\}\}"/);
  assert.ok(bar, '找不到 .pbar 的显示条件');
  assert.match(bar[1], /lead\.exists/,
    '.pbar 只按 mode/freeMap 判 ⇒ FREE_EXPLORE 领队发车后没有任何入口(F-57)');
});

test('三键仍只属于城市定向与地图态,无 lead 的自由探索底栏不变', () => {
  const trio = WXML.match(/<view class="pbar__trio" wx:if="\{\{([^"]+)\}\}"/);
  assert.ok(trio, '找不到三键的显示条件');
  assert.match(trio[1], /mode!=2 \|\| freeMap/,
    '三键不能跟着 lead 一起冒出来,自由探索的核销/扫码仍收在节点半屏');
});

test('五行领队工具挂在模式分支之外,只由 lead 判', () => {
  const drawer = toolsDrawer();
  const free = freeExploreBranch(drawer);
  for (const [handler, label] of LEAD_ROWS) {
    const row = drawer.match(
      new RegExp(`<view class="drow"[^>]*wx:if="\\{\\{([^"]+)\\}\\}"[^>]*bindtap="${handler}"`));
    assert.ok(row, `领队行 ${label} 不见了`);
    assert.match(row[1], /lead\.exists/, `${label} 必须自己守 lead.exists`);
    assert.ok(!free.includes(handler),
      `${label} 还关在 mode==2 分支里 ⇒ 另一模式够不着(F-57)`);
  }
});
