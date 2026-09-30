'use strict';

/* 漫游页「在雾里发现一个局」(原型 f-hangout)整卡退场契约(2026-09-15 合拢收尾)。
 *
 * 背景:搭子局(A)已下架,后端 /api/roam/hangout/nearby 不再返回 kind=hangout 图层,
 * 这张卡永远推不出数据;而它的点击原先跳 /subpackageRoam/nearby/index?hangoutId=,
 * 新页既不读该参数也不画局 = 一张点进去落空的死入口。
 * 裁决:整卡删除(不发明新卡面),附近的队伍走 HANGOUT_INTRO_CARD / subpackageRoam/nearby。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (source) => source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

const JS = stripComments(read('pages/roam/index.js'));
const WXML = stripComments(read('pages/roam/index.wxml'));
const WXSS = stripComments(read('pages/roam/index.wxss'));

/** 死卡特征:在真源码上必须为零,喂旧卡片段必须命中(负控用) */
function deadCardHits(source) {
  return [
    /\/api\/roam\/hangout\/nearby/.test(source),
    /hangoutNear/.test(source),
    /加入这个局/.test(source),
    /hangoutId/.test(source),
    /\bhn-act\b/.test(source),
  ].filter(Boolean).length;
}

test('漫游页不再挂 f-hangout 死卡:接口 / 字段 / 文案 / 跳转参数 / 样式全部清零', () => {
  assert.equal(deadCardHits(JS), 0, 'pages/roam/index.js 仍有 f-hangout 残留');
  assert.equal(deadCardHits(WXML), 0, 'pages/roam/index.wxml 仍有 f-hangout 残留');
  assert.equal(deadCardHits(WXSS), 0, 'pages/roam/index.wxss 仍有 f-hangout 残留');
});

test('负控:把旧卡片段喂进检查器必须逐项判红', () => {
  const oldJs = "url: '/api/roam/hangout/nearby', silentError: true,";
  const oldWxml = '<view class="hn-act" bindtap="openHangoutNear">加入这个局</view>';
  const oldNav = "wx.navigateTo({ url: '/subpackageRoam/nearby/index?hangoutId=' + id });";
  assert.ok(deadCardHits(oldJs) > 0, '接口残留检测失效');
  assert.ok(deadCardHits(oldWxml) > 0, '文案/样式残留检测失效');
  assert.ok(deadCardHits(oldNav) > 0, '跳转参数残留检测失效');
  assert.equal(deadCardHits('<view class="finish-btn">完成</view>'), 0, '检测器误报普通元素');
});

test('hud 槽位表里也不再有 hangoutNear(槽名残留 = 永远不出的幽灵档)', () => {
  const mod = { exports: {} };
  new Function('module', 'exports', read('utils/wxs/hud-slots.wxs'))(mod, mod.exports);
  const hud = mod.exports;
  assert.ok(!hud.orders.promptSlot.includes('hangoutNear'), 'promptSlot 优先级表仍有 hangoutNear');
  // 传满旧 10 个参数时,第 10 个也只当多传,不得选出一个表外档
  const off = { show: false };
  const picked = hud.promptSlot(null, null, off, off, off, off, off, off, null, { id: '1' });
  assert.equal(picked, '', '全关时不该选出任何档');
});

test('删卡不删入口:漫游首屏「附近的队伍」入口仍在(附近的队伍走它,不靠死卡兜)', () => {
  assert.match(JS, /nav: '\/subpackageRoam\/nearby\/index'/, '附近的队伍入口卡不见了');
  assert.match(JS, /title: '附近的队伍'/, '入口卡文案不是附近的队伍');
});
