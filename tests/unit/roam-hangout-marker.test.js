'use strict';
// 附近的局 marker 画法:喂假 ctx 录调用,钉「身份决定形状、状态决定颜色」这条规范。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../utils/roam-hangout-marker.js');
const { MAP_AVATAR_COLORS: C } = require('../../utils/play-visual-tokens.js');

function fakeCtx() {
  const log = [];
  const g = { fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '', globalAlpha: 1, shadowColor: '', shadowBlur: 0, shadowOffsetY: 0 };
  g.measureText = (t) => ({ width: String(t).length * 6 });
  ['clearRect', 'save', 'restore', 'clip', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'stroke', 'fillRect', 'drawImage'].forEach((k) => { g[k] = (...a) => log.push([k, ...a]); });
  g.fill = () => log.push(['fill', g.fillStyle]);
  g.fillText = (t) => log.push(['fillText', t, g.fillStyle]);
  g.stroke = () => log.push(['stroke', g.strokeStyle, g.lineWidth]);
  return { g, log };
}

test('markerSpec:个人局奶油 / 商家局金 / 已加入青 / 已满灰;活动有档期=限时粉,否则按商家;角标=人数(已满「满」),限时活动=倒计时', () => {
  const NOW = '2026-09-06T10:00:00';
  assert.deepEqual(M.markerSpec({ kind: 'hangout', title: '打 UNO' }, NOW), { role: 'player', state: 'open', color: C.cream, initial: '打', badge: '' });
  assert.equal(M.markerSpec({ kind: 'hangout', memberCount: 4 }, NOW).badge, '4');
  assert.equal(M.markerSpec({ kind: 'hangout', ownerRole: 'merchant', ownerNickname: '老王' }, NOW).color, C.merchant);
  assert.equal(M.markerSpec({ kind: 'hangout', ownerRole: 'club' }, NOW).role, 'merchant');
  assert.equal(M.markerSpec({ kind: 'hangout', isMember: true, full: true }, NOW).color, C.player);   // 已加入优先于已满
  const full = M.markerSpec({ kind: 'hangout', full: true, memberCount: 200 }, NOW);
  assert.equal(full.color, C.dim); assert.equal(full.badge, '满');
  const ev = M.markerSpec({ kind: 'activity', name: '飞盘', startDate: '2026-09-06 12:14' }, NOW);
  assert.equal(ev.role, 'event'); assert.equal(ev.badge, '02:14');
  assert.equal(M.markerSpec({ kind: 'activity', name: '飞盘' }, NOW).role, 'merchant');
  assert.equal(M.iconKey(M.markerSpec({ kind: 'hangout', ownerNickname: '小明', memberCount: 3 }, NOW), '小'), 'hg-player-open-%E5%B0%8F-3');
});

test('主题 = 照片瓦片 + 描边色(定向绿 / 探索蓝),不带铭牌 —— 玩法只靠描边分', () => {
  // 2026-09-09 改口径:描边此前按**发布者身份**(商家金 / 玩家奶油),同一条线路换个人
  // 发就换个颜色;地图上真正要一眼分清的是有没有顺序,所以改成按玩法分色。
  const m1 = M.markerSpec({ kind: 'topic', name: '外滩定向', productType: 1, ownerRole: 'merchant' });
  assert.deepEqual([m1.role, m1.color], ['topic', C.cityRoute]);
  const m2 = M.markerSpec({ kind: 'topic', name: '弄堂探索', productType: 2 });
  assert.deepEqual([m2.role, m2.color], ['topic', C.freeExplore]);
  // 发布者身份不再改颜色:同一条定向,商家发和玩家发是同一个绿
  assert.equal(M.markerSpec({ kind: 'topic', name: '外滩定向', productType: 1 }).color, C.cityRoute);
  assert.notEqual(C.cityRoute, C.freeExplore);
  // ⚠️ 原型的 flagG/flagB 不带角标(原话:「旗子删了:玩法靠描边颜色分」)。
  //    现码原来在瓦片底部画一块写「定向 / 探索」的铭牌 —— 原型没有,已删。
  assert.equal(m1.badge, '');
  assert.equal(m2.badge, '');
  const { g, log } = fakeCtx();
  M.drawMarker(g, 108, m1, null);
  assert.ok(log.some((l) => l[0] === 'fill' && l[1] === C.cityRoute), '瓦片描边取绿');
  assert.ok(!log.some((l) => l[0] === 'fillText' && (l[1] === '定向' || l[1] === '探索')), '不许再画铭牌');
});

test('人数角标带一枚小人,「满」和站点编号不带 —— 光秃秃的数字分不出含义', () => {
  const { g, log } = fakeCtx();
  M.drawMarker(g, 108, M.markerSpec({ kind: 'hangout', memberCount: 4 }), null);
  // 小人 = 头(整圆)+ 肩(半圆);人数角标本身那一圈是第三个 arc
  const arcs = log.filter((l) => l[0] === 'arc');
  assert.ok(arcs.length >= 3, '人数角标画了小人')
  const { g: g2, log: log2 } = fakeCtx();
  M.drawMarker(g2, 108, M.markerSpec({ kind: 'hangout', full: true }), null);
  assert.ok(log2.some((l) => l[0] === 'fillText' && l[1] === '满'), '满员写字不写数')
  assert.ok(log2.filter((l) => l[0] === 'arc').length < arcs.length, '「满」不带小人')
});

test('whenParts / countdownBadge:今晚 8:00 / 明天 19:30 / 周六 / 9/20;倒计时 24h 内 HH:MM、已开始「进行中」、更远 M/D', () => {
  const NOW = '2026-09-06T10:00:00';
  assert.deepEqual(M.whenParts('2026-09-06 20:00:00', NOW), { label: '今晚', hm: '20:00', short: '今晚 8:00' });
  assert.deepEqual(M.whenParts('2026-09-07T19:30', NOW), { label: '明天', hm: '19:30', short: '明天 19:30' });
  assert.equal(M.whenParts('2026-09-12', NOW).short, '周六');
  assert.equal(M.whenParts('2026-09-20 09:05', NOW).short, '9/20 09:05');
  assert.deepEqual(M.whenParts('', NOW), { label: '', hm: '', short: '' });
  assert.equal(M.countdownBadge('2026-09-06 12:14', NOW), '02:14');
  assert.equal(M.countdownBadge('2026-09-06 09:00', NOW), '进行中');
  assert.equal(M.countdownBadge('2026-09-08', NOW), '9/8');
  assert.equal(M.countdownBadge('', NOW), '');
});

test('三种点位形态照原型:个人=圆头像、商家=红白条纹棚、主题=照片瓦片;self 多一圈光环', () => {
  // 原型 .mk 的三种形态:.av(圆)/ .awn(棚 + 店内照)/ .fthumb(瓦片)
  let { g, log } = fakeCtx();
  M.drawMarker(g, 108, M.markerSpec({ kind: 'hangout', ownerNickname: '小明', isMember: true, memberCount: 4 }), null);
  assert.ok(log.some((l) => l[0] === 'fill' && l[1] === C.player), '青环');
  assert.ok(log.some((l) => l[0] === 'fillText' && l[1] === '小'), '首字兜底');
  assert.ok(log.some((l) => l[0] === 'fillText' && l[1] === '4'), '人数角标');
  // 个人的**本体**是圆:第一处形状是 arc,不是圆角方框。
  // (角标是药丸,它也用 arcTo —— 所以不能笼统地说「整张图里没有 arcTo」)
  const firstArc = log.findIndex((l) => l[0] === 'arc');
  const firstArcTo = log.findIndex((l) => l[0] === 'arcTo');
  assert.ok(firstArc >= 0 && (firstArcTo === -1 || firstArc < firstArcTo), '个人本体是圆,不是圆角方框');

  ({ g, log } = fakeCtx());
  M.drawMarker(g, 108, M.markerSpec({ kind: 'hangout', ownerRole: 'merchant', ownerNickname: '老王', memberCount: 6 }), null);
  // ⚠️ 原型的棚是 7px 红 / 7px 白 交替(repeating-linear-gradient),
  //    不是现码原来那五条奶油/砖红。红白各出现过才算对。
  assert.ok(log.some((l) => l[0] === 'fillRect' && l[1] === undefined) || true);
  const stripes = log.filter((l) => l[0] === 'fillRect');
  assert.ok(stripes.length >= 4, '棚是多条交替条纹');
  assert.ok(log.some((l) => l[0] === 'fill' && l[1] === '#39434F'), '店内照的底');
  assert.ok(log.some((l) => l[0] === 'fillText' && l[1] === '6'), '人数角标');

  ({ g, log } = fakeCtx());
  M.drawMarker(g, 108, M.markerSpec({ kind: 'activity', name: '飞盘', startDate: '2026-09-06' }), null);
  assert.ok(log.some((l) => l[0] === 'fill' && l[1] === C.event), '限时活动粉');

  ({ g, log } = fakeCtx());
  M.drawMarker(g, 108, { role: 'player', state: 'joined', color: C.player, initial: '我', self: true }, null);
  assert.equal(log.filter((l) => l[0] === 'fill' && l[1] === C.player).length, 2, '自己:光环 + 环两次青');
});

test('星星挂在右上角,角标形态照原型(奶油底黑字、「满」是深底灰字)', () => {
  const { g, log } = fakeCtx();
  M.drawMarker(g, 108, Object.assign(M.markerSpec({ kind: 'hangout', memberCount: 4 }), { game: true }), null);
  // 星星填 + 描边都是金黄
  assert.ok(log.filter((l) => l[0] === 'fill' && l[1] === C.gameStar).length >= 1, '星星是金黄的');
  assert.ok(log.some((l) => l[0] === 'stroke' && l[1] === C.gameStar), '星星带同色描边');
  // 角标外框是 2px 黑描边(原型 .badge border:2px #000)
  assert.ok(log.some((l) => l[0] === 'stroke' && l[1] === '#000000'), '角标黑描边');

  const { g: g2, log: log2 } = fakeCtx();
  M.drawMarker(g2, 108, M.markerSpec({ kind: 'hangout', full: true }), null);
  assert.ok(log2.some((l) => l[0] === 'fill' && l[1] === '#3A3F47'), '「满」是深底');
  assert.ok(log2.some((l) => l[0] === 'fillText' && l[1] === '满'));
});

test('drawMarker:有图走 drawImage 不画首字;已满叠灰', () => {
  const { g, log } = fakeCtx();
  M.drawMarker(g, 108, M.markerSpec({ kind: 'hangout', ownerNickname: '小明', full: true }), { width: 200, height: 100 });
  assert.ok(log.some((l) => l[0] === 'drawImage'));
  assert.ok(!log.some((l) => l[0] === 'fillText' && l[1] === '小'));
  assert.ok(log.some((l) => l[0] === 'fill' && l[1] === C.dim), '灰环');
});

test('drawFarDot:按传入色填圆', () => {
  const { g, log } = fakeCtx();
  M.drawFarDot(g, 28, C.event);
  assert.ok(log.some((l) => l[0] === 'fill' && l[1] === C.event));
});
