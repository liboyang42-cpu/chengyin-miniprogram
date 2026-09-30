'use strict';

// HUD 槽位契约自检:同槽只出一个 + 优先级顺序 + wxml 里的槽位名没写错。
// 第三条是重点 —— wx:if 里把 'leadRetry' 拼成 'leadretry' 不会报错,只会让那个浮层永远不出现。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const WXS_PATH = path.join(__dirname, '../../utils/wxs/hud-slots.wxs');

function loadWxs() {
  const src = fs.readFileSync(WXS_PATH, 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
}

const hud = loadWxs();
const on = { show: true };

test('topBanner:三者齐开只出最高优先级 couponToast', () => {
  assert.strictEqual(hud.topBanner('券', '', true, { exists: true, status: 2 }), 'couponToast');
  assert.strictEqual(hud.topBanner('', '', true, { exists: true, status: 2 }), 'leadRetry');
  assert.strictEqual(hud.topBanner('', '', false, { exists: true, status: 2 }), 'leadbar');
  assert.strictEqual(hud.topBanner('', '', false, { exists: false }), '');
});

test('topBanner:进了全屏子屏(screen 非空)只剩不受 screen 约束的券 toast', () => {
  assert.strictEqual(hud.topBanner('', 'gamePlay', true, { exists: true, status: 2 }), '');
});

test('bottomCard:通关 banner > 陪伴条 > 下一站卡', () => {
  const nav = { active: true };
  const node = { id: 1 };
  assert.strictEqual(hud.bottomCard('', true, nav, node, null), 'banner');
  assert.strictEqual(hud.bottomCard('', false, nav, node, null), 'navbar');
  assert.strictEqual(hud.bottomCard('', false, { active: false }, node, null), 'nextcard');
  // 起飞过场进行中,底部卡不能抢镜
  assert.strictEqual(hud.bottomCard('', false, { active: false }, node, on), '');
});

// 2026-09-07 途中彩蛋整条下线后,这个互斥栈只剩 navBubble 一档。
// 断言留着不是走形式:它锁住「全屏态(screen 非空)时气泡一律不出」这条,
// 那一条和彩蛋没关系,是浮层不许压全屏的通则。
test('floatBubble:只剩 NPC 台词泡,且全屏态下不出', () => {
  assert.strictEqual(hud.floatBubble('', on), 'navBubble');
  assert.strictEqual(hud.floatBubble('', { show: false }), '');
});

test('promptSlot:新补的一档(multiView)按优先级插在正确位置', () => {
  // 2026-09-11 原型 f-multi 进槽。参数加在签名末尾:
  // play 页仍按 8 个参数调,少传的读到 undefined = 这一档不在 —— 这一条也一并钉住。
  // (同日补的 hangoutNear 一档随搭子局下架整卡退场,2026-09-15 已从签名与优先级表删除。)
  const off = { show: false }
  const on2 = { show: true }
  assert.strictEqual(hud.promptSlot(null, null, off, off, off, off, off, off, { count: 3 }), 'multiView')
  // multiView 压过附近商家(它是用户主动点开的)
  assert.strictEqual(hud.promptSlot(null, null, on2, off, off, off, off, off, { count: 3 }), 'multiView')
  // 全屏遮罩在场时最低两档静默(同一条规矩),multiView 是主动打开的不让
  assert.strictEqual(hud.promptSlot(null, null, off, off, off, off, on2, off, { count: 3 }), 'multiView')
  // 少传参数 = 这一档不在,老调用点行为不变
  assert.strictEqual(hud.promptSlot(null, null, on2, off, off, off, off, off), 'nearbyBanner')
})

test('promptSlot:六张卡全开只出 visit,顺序逐级降级', () => {
  const visit = { active: true, poi: { name: '某店' } };
  const ev = { show: true, id: 7 };
  const off = { show: false };
  assert.strictEqual(hud.promptSlot(visit, ev, on, on, on, on, off, off), 'visit');
  assert.strictEqual(hud.promptSlot(null, ev, on, on, on, on, off, off), 'eventOverlay');
  assert.strictEqual(hud.promptSlot(null, null, on, on, on, on, off, off), 'nearbyBanner');
  assert.strictEqual(hud.promptSlot(null, null, off, on, on, on, off, off), 'paceCard');
  assert.strictEqual(hud.promptSlot(null, null, off, off, on, on, off, off), 'footprintHint');
  assert.strictEqual(hud.promptSlot(null, null, off, off, off, on, off, off), 'roamPrompt');
  assert.strictEqual(hud.promptSlot(null, null, off, off, off, off, off, off), '');
});

test('promptSlot:全屏遮罩(勋章/发现奖励)在场时,最低两档让位(沿用改造前行为)', () => {
  const off = { show: false };
  assert.strictEqual(hud.promptSlot(null, null, off, off, on, on, on, off), '');
  assert.strictEqual(hud.promptSlot(null, null, off, off, on, on, off, on), '');
  // 但高优先级的商家卡不受影响
  assert.strictEqual(hud.promptSlot(null, null, on, off, on, on, on, off), 'nearbyBanner');
});

test('wxml 里写死的槽位名都存在于契约里(拼错 = 该浮层永远不出且零报错)', () => {
  const pages = ['../../pages/play/index.wxml', '../../pages/roam/index.wxml'];
  const re = /hud\.(topBanner|bottomCard|floatBubble|promptSlot)\([^)]*\)\s*(?:===|!==)\s*'([^']+)'/g;
  let checked = 0;
  pages.forEach((rel) => {
    const wxml = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    let m;
    while ((m = re.exec(wxml))) {
      checked++;
      assert.ok(
        hud.orders[m[1]].indexOf(m[2]) >= 0,
        rel + ' 用了槽位名 ' + m[2] + ',但 ' + m[1] + ' 的优先级表里没有它'
      );
    }
  });
  assert.ok(checked >= 10, '应扫到两页共 10+ 处槽位判断,实际 ' + checked + ' —— 太少说明正则没匹配上');
});

test('每个槽的优先级表内没有重名(重名会让后一个永远拿不到位置)', () => {
  Object.keys(hud.orders).forEach((slot) => {
    const arr = hud.orders[slot];
    assert.strictEqual(new Set(arr).size, arr.length, slot + ' 优先级表里有重复项');
  });
});
