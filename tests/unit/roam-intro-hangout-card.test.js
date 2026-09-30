'use strict';
// 漫游首屏「附近的局」入口卡契约:默认两张卡与已报名卡两条分支都必须带上它,且落点页真实存在于 app.json。
// 负控:删掉 _loadIntroTopics 里的 concat → 第二条红;从 app.json 去掉 nearby/index → 第三条红。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(ROOT, 'pages/roam/index.js'), 'utf8');

test('默认入口卡列表含附近的局', () => {
  const dataBlock = src.slice(src.indexOf('introCards: ['), src.indexOf('boundEvent:'));
  assert.match(dataBlock, /HANGOUT_INTRO_CARD/);
});

test('已报名章节卡分支也追加附近的局(不能只在空态出现)', () => {
  const fn = src.slice(src.indexOf('_loadIntroTopics()'), src.indexOf('openRoamLocationSetting()'));
  assert.match(fn, /cards\.concat\(\[HANGOUT_INTRO_CARD\]\)/);
});

test('入口卡落点页在 app.json 子包里', () => {
  const m = src.match(/nav:\s*'(\/subpackageRoam\/nearby\/index)'/);
  assert.ok(m, '入口卡必须有 nav');
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const roam = (app.subPackages || app.subpackages).find((s) => s.root === 'subpackageRoam');
  assert.ok(roam.pages.includes('nearby/index'));
});

test('入口卡不编数字(sub 里没有阿拉伯数字)', () => {
  const card = src.slice(src.indexOf('const HANGOUT_INTRO_CARD'), src.indexOf('});', src.indexOf('const HANGOUT_INTRO_CARD')));
  assert.doesNotMatch(card, /sub: '[^']*\d/);
});

test('GO 必须认当前入口卡:hangout 去附近的局,有 nav 跟卡走,否则才开漫游地图', () => {
  const goStart = src.slice(src.indexOf('  goStart() {'), src.indexOf('  _openRoamMap('));
  assert.match(goStart, /introCards\[introCardIdx\]/);
  assert.match(goStart, /\/subpackageRoam\/nearby\/index/);
  assert.match(goStart, /card\.nav/);
  assert.match(goStart, /wx\.getLocation/);
  assert.match(goStart, /_openRoamMap\(/);
});
