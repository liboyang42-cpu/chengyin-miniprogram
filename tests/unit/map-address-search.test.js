'use strict';
// 顶部输入地址(2026-09-09 裁决 §6.1):四类结果共用一张列表,靠针的颜色分;
// 打字可以打中文,也可以打全拼 / 首字母(前提是这条地址自带 pinyin / initials)。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../utils/map-address-search.js');
const { MAP_AVATAR_COLORS: C } = require('../../utils/play-visual-tokens.js');

const PLACES = [
  { id: 'a', name: '徐汇滨江 · 云锦路', address: '徐汇区云锦路', kind: 'hangout', pinyin: 'xuhuibinjiang', initials: 'xhbj' },
  { id: 'b', name: '外滩定向', address: '黄浦区中山东一路', kind: 'city' },
  { id: 'c', name: '弄堂探索', address: '静安区愚园路', kind: 'free' },
  { id: 'd', name: '静安寺', address: '静安区南京西路', kind: 'none' },
];

test('针的颜色:城市定向绿 / 自由探索蓝 / 有局与没有局都是中性灰', () => {
  assert.equal(S.pinColorForKind('city'), C.cityRoute);
  assert.equal(S.pinColorForKind('free'), C.freeExplore);
  assert.equal(S.pinColorForKind('hangout'), S.NEUTRAL_PIN);
  // 原型 ADDR 里无玩法结果的针色
  assert.equal(S.NEUTRAL_PIN, '#8A8A8E');
  assert.equal(S.pinColorForKind('none'), S.NEUTRAL_PIN);
  // 认不出的类型退回中性,不抛也不返回 undefined —— 少一枚针整行会看起来是没加载完
  assert.equal(S.pinColorForKind('what'), S.NEUTRAL_PIN);
  // 绿蓝必须真的不一样,否则这条规范等于没写
  assert.notEqual(C.cityRoute, C.freeExplore);
});

test('没有局的地方副标题直接写「没有局」,不留空行', () => {
  assert.equal(S.subtitleFor({ kind: 'none', address: '静安区南京西路' }), '没有局');
  assert.equal(S.subtitleFor({ kind: 'city', address: '黄浦区中山东一路' }), '黄浦区中山东一路');
});

test('空输入给全量;中文打字按名称/地址包含匹配', () => {
  assert.equal(S.matchPlaces(PLACES, '').length, 4);
  assert.equal(S.matchPlaces(PLACES, '   ').length, 4);
  assert.deepEqual(S.matchPlaces(PLACES, '探索').map((p) => p.id), ['c']);
  // 地址也参与匹配:只记得「愚园路」也搜得到
  assert.deepEqual(S.matchPlaces(PLACES, '愚园路').map((p) => p.id), ['c']);
  assert.deepEqual(S.matchPlaces(PLACES, '不存在的地方'), []);
});

test('首字母前缀:敲 xhbj 就只剩徐汇滨江', () => {
  assert.deepEqual(S.matchPlaces(PLACES, 'xhbj').map((p) => p.id), ['a']);
  assert.deepEqual(S.matchPlaces(PLACES, 'XHBJ').map((p) => p.id), ['a']);
  assert.deepEqual(S.matchPlaces(PLACES, 'xuhui').map((p) => p.id), ['a']);
  // 是前缀不是包含:字母匹配要能真的收窄,'hbj' 不该命中
  assert.deepEqual(S.matchPlaces(PLACES, 'hbj'), []);
  // 没带拼音字段的条目不会被字母误伤
  assert.deepEqual(S.matchPlaces(PLACES, 'w'), []);
});

test('decoratePlaces 把针色和副标题一次给全,不改原对象', () => {
  const rows = S.decoratePlaces(PLACES);
  assert.deepEqual(rows.map((r) => r.pinColor), [S.NEUTRAL_PIN, C.cityRoute, C.freeExplore, S.NEUTRAL_PIN]);
  assert.equal(rows[3].sub, '没有局');
  assert.equal(PLACES[3].pinColor, undefined, '原数组不许被就地改');
  // 非数组进来给空数组,不抛 —— 接口没回来时页面照样能渲染
  assert.deepEqual(S.decoratePlaces(null), []);
  assert.deepEqual(S.matchPlaces(null, 'x'), []);
});

// ── 组件形态:逐条照原型 .searchbar / .addrbar / .addrlist 抄 ──────────────
const fs = require('node:fs');
const path = require('node:path');
const readC = (f) => fs.readFileSync(path.resolve(__dirname, '../../components/cy/map-address-search/' + f), 'utf8');

test('两个状态:白条点开进搜索态,压暗层与「取消」都退得回去', () => {
  const wxml = readC('index.wxml');
  const js = readC('index.js');
  // 收起态是一条白条(左搜索、中文字、右筛选),不是行内输入框
  assert.match(wxml, /wx:if="\{\{!open\}\}" class="searchbar[^\"]*" bindtap="onOpen"/);
  assert.match(wxml, /class="searchbar__f" name="filter-lines"/);
  // 展开态:压暗层 + 可编辑 addrbar + 结果列表
  assert.match(wxml, /class="dim" bindtap="onCancel"/);
  assert.match(wxml, /class="searchbar addrbar"/);
  assert.match(wxml, /class="addrbar__c" catchtap="onCancel"/);
  assert.match(js, /onOpen\(\) \{[\s\S]{0,120}?open: true/);
  assert.match(js, /onCancel\(\) \{[\s\S]{0,120}?open: false/);
});

test('结果行照原型:针 + 标题 + 副标题,空态写「这附近没有搜到」', () => {
  const wxml = readC('index.wxml');
  const wxss = readC('index.wxss');
  assert.match(wxml, /class="addrrow__pin" style="color:\{\{item\.pinColor\}\}"/);
  assert.match(wxml, /class="addrrow__t">\{\{item\.name\}\}/);
  assert.match(wxml, /class="addrrow__s">\{\{item\.sub\}\}/);
  assert.match(wxml, /class="addrlist__none">这附近没有搜到/);
  // 几何照原型换算:白条 44px=85rpx / 圆角 12px=23rpx;列表圆角 14px=27rpx / 最高 420px=808rpx
  assert.match(wxss, /\.searchbar\{[\s\S]{0,400}?height:85rpx/);
  assert.match(wxss, /\.searchbar\{[\s\S]{0,400}?border-radius:23rpx/);
  assert.match(wxss, /\.addrlist\{[\s\S]{0,300}?max-height:808rpx/);
  assert.match(wxss, /\.addrlist\{[\s\S]{0,300}?border-radius:27rpx/);
  // 「取消」是绿的,光标也是 —— 原型 .addrbar__c / caret-color
  assert.match(wxss, /\.addrbar__c\{[^}]*color:#22C55E/);
  assert.match(wxss, /caret-color:#22C55E/);
});

test('不自绘键盘 —— 那是网页 mock 的道具,小程序有真的系统键盘', () => {
  const wxml = readC('index.wxml');
  const wxss = readC('index.wxss');
  assert.doesNotMatch(wxml, /class="kbd|key--|kbd__/);
  assert.doesNotMatch(wxss, /\.kbd\{|\.key\{/);
  // 用真 <input> 并在展开时聚焦,系统键盘自己会弹
  assert.match(wxml, /<input class="addrbar__in"[^>]*focus="\{\{open\}\}"/);
});
