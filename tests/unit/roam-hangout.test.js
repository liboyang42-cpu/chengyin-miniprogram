'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../utils/roam-hangout.js');

const hang = (o) => Object.assign({ kind: 'hangout', id: 5, title: '打 UNO', latitude: 31.23, longitude: 121.47 }, o);
const act = (o) => Object.assign({ kind: 'activity', id: 9, name: '周末飞盘', latitude: 31.24, longitude: 121.48 }, o);

test('buildHangoutMarkers:无坐标不画点(铁律)', () => {
  const mk = H.buildHangoutMarkers([hang(), hang({ id: 6, latitude: null }), act({ longitude: '' })]);
  assert.equal(mk.length, 1);
  assert.equal(mk[0].id, 51);
});

test('buildHangoutMarkers:局与活动 id 编码不撞且全是数字(微信 map 契约)', () => {
  const mk = H.buildHangoutMarkers([hang({ id: 1 }), act({ id: 1 })]);
  assert.deepEqual(mk.map((m) => m.id), [11, 12]);
  mk.forEach((m) => assert.equal(typeof m.id, 'number'));
});

test('buildHangoutMarkers:LOD —— ≤300m 且有头像图才长成 54px 头像 + 名牌,否则 14px 远距点;远距点按角色色取图,没有就兜底', () => {
  const C = require('../../utils/play-visual-tokens.js').MAP_AVATAR_COLORS;
  const icons = { 'hg-player-open-%E5%B0%8F-': '/tmp/near.png' };
  const far = { [C.cream]: '/tmp/far-cream.png' };
  const mk = H.buildHangoutMarkers([
    hang({ id: 1, distance: 120, ownerNickname: '小明' }),      // 近 + 有图 → 头像
    hang({ id: 2, distance: 900, ownerNickname: '小明' }),      // 远 → 远距点(奶油)
    hang({ id: 3, distance: 50, ownerNickname: '老王' }),       // 近但图没生成 → 远距点
    hang({ id: 4, distance: 50, ownerRole: 'merchant' }),       // 商家色远距点没生成 → 兜底图
  ], icons, far);
  assert.equal(mk[0].iconPath, '/tmp/near.png');
  assert.equal(mk[0].width, 54);
  assert.equal(mk[0].callout.content, '打 UNO');
  assert.equal(mk[1].iconPath, '/tmp/far-cream.png');
  assert.equal(mk[1].width, 14);
  assert.equal(mk[1].callout, undefined);
  assert.equal(mk[2].iconPath, '/tmp/far-cream.png');
  assert.equal(mk[3].iconPath, H.HANGOUT_FALLBACK_ICON);
});

test('buildHangoutMarkers:名牌按身份换色 —— 个人局深底写标题、商家局金底写「商家局 · N 人」、限时活动粉底写倒计时', () => {
  const C = require('../../utils/play-visual-tokens.js').MAP_AVATAR_COLORS;
  const icons = { 'hg-player-open-%E5%B0%8F-': '/a.png', 'hg-merchant-open-%E7%8C%AB-6': '/b.png', 'hg-event-open-%E9%A3%9E-9%2F8': '/c.png' };
  const mk = H.buildHangoutMarkers([
    hang({ id: 1, distance: 100, ownerNickname: '小明' }),
    hang({ id: 2, distance: 100, ownerNickname: '猫', ownerRole: 'merchant', memberCount: 6 }),
    act({ id: 3, distance: 100, name: '飞盘', startDate: '2999-09-08' }),
  ], icons, {});
  assert.deepEqual([mk[0].callout.content, mk[0].callout.bgColor], ['打 UNO', C.panel + 'E6']);
  assert.deepEqual([mk[1].callout.content, mk[1].callout.bgColor], ['商家局 · 6 人', C.merchant]);
  assert.deepEqual([mk[2].callout.content, mk[2].callout.bgColor], ['9/8', C.event]);
});

// 2026-09-09 图标 key 尾段是 badge:主题照原型不再带角标(玩法只靠描边分),
// 所以 key 从 …-定向 变成 …-(空)。名牌内容不受影响,它取的是主题名。
test('buildHangoutMarkers:已发布主题(kind=topic)也上图,id 末位 3,名牌写主题名', () => {
  const mk = H.buildHangoutMarkers([{ kind: 'topic', id: 7, name: '外滩定向', productType: 1, ownerRole: 'merchant', latitude: 31.24, longitude: 121.49, distance: 80 }], { 'hg-topic-open-%E5%A4%96-': '/t.png' }, {});
  assert.equal(mk.length, 1); assert.equal(mk[0].id, 73); assert.equal(mk[0].iconPath, '/t.png'); assert.equal(mk[0].callout.content, '外滩定向');
});

test('buildSelfMarker / buildRangeCircle:有定位 + 有图才画「我」,id 末位 9 不会被 parseMarkerId 当成局;300 m 圈锚在定位点', () => {
  assert.deepEqual(H.buildSelfMarker(null, '/me.png'), []);
  assert.deepEqual(H.buildSelfMarker({ lat: 31.2, lng: 121.4 }, ''), []);
  const me = H.buildSelfMarker({ lat: 31.2, lng: 121.4 }, '/me.png');
  assert.equal(me.length, 1); assert.equal(me[0].id, H.SELF_MARKER_ID); assert.equal(H.parseMarkerId(me[0].id), null);
  const c = H.buildRangeCircle({ lat: 31.2, lng: 121.4 });
  assert.equal(c[0].radius, 300); assert.equal(c[0].latitude, 31.2);
  assert.deepEqual(H.buildRangeCircle({ lat: null }), []);
});

test('buildHangoutMarkers:已加入的局压在最上层(zIndex),活动在局之下', () => {
  const mk = H.buildHangoutMarkers([hang({ id: 1, isMember: true }), hang({ id: 2 }), act({ id: 3 })]);
  assert.ok(mk[0].zIndex > mk[1].zIndex && mk[1].zIndex > mk[2].zIndex);
});

test('parseMarkerId:数字编码往返,别的 marker 不认', () => {
  assert.deepEqual(H.parseMarkerId(121), { kind: 'hangout', id: 12 });
  assert.deepEqual(H.parseMarkerId('32'), { kind: 'activity', id: 3 });
  assert.deepEqual(H.parseMarkerId(73), { kind: 'topic', id: 7 });
  assert.equal(H.parseMarkerId(7), null);
  assert.equal(H.parseMarkerId('x'), null);
});

test('emptyStateCopy:有探半径建议 → 引导拉远且带数字;没有 → 引导开局', () => {
  const a = H.emptyStateCopy(3000, { radius: 20000, count: 7 });
  assert.equal(a.action, 'expand');
  assert.match(a.sub, /20km/);
  assert.match(a.sub, /7/);
  const b = H.emptyStateCopy(3000, null);
  assert.equal(b.action, 'create');
  assert.equal(b.primary, '在这里开一局');
  assert.equal(a.primary, '看远一点');
});

test('validateHangoutForm:每道闸的文案各自可辨', () => {
  assert.equal(H.validateHangoutForm({ title: '打', lat: 1, lng: 1 }), '标题 2–30 字');
  assert.equal(H.validateHangoutForm({ title: '打 UNO', description: 'x'.repeat(121), lat: 1, lng: 1 }), '说明最多 120 字');
  assert.equal(H.validateHangoutForm({ title: '打 UNO' }), '请选择地点');
  assert.equal(H.validateHangoutForm({ title: '打 UNO', lat: 31.2, lng: 121.4 }), null);
});

test('fmtKm', () => {
  assert.equal(H.fmtKm(350), '350m');
  assert.equal(H.fmtKm(3000), '3.0km');
  assert.equal(H.fmtKm(20000), '20km');
});

test('附近的队伍加载失败必须可重试,不能伪装成空列表', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '../..');
  const js = fs.readFileSync(path.join(root, 'subpackageRoam/nearby/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'subpackageRoam/nearby/index.wxml'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(root, 'subpackageRoam/nearby/index.json'), 'utf8'));
  const fetch = js.slice(js.indexOf('fetchTeams(center, radius) {'), js.indexOf('fetchTopics(center, radius) {'));
  assert.match(fetch, /loadError/);
  assert.doesNotMatch(fetch, /setData\(\{\s*loaded:\s*true\s*\}\)/);
  assert.ok(json.usingComponents['cy-error'], 'nearby 必须注册 cy-error');
  assert.match(wxml, /<cy-error\b/);
  assert.match(wxml, /loadError/);
});
