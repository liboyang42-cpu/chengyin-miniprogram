const test = require('node:test');
const assert = require('node:assert/strict');

const circle = require('../../pages/play/utils/circle-theme.js');

const EXPECTED = ['FITNESS', 'MIDLIFE', 'DATE', 'FRIENDS', 'SHANGHAI'];

test('文档五个圈层及40个角色全部进入小程序配置', () => {
  assert.deepEqual(circle.PRIMARY_THEME_CODES, EXPECTED);
  const codes = [];
  EXPECTED.forEach((themeCode) => {
    const theme = circle.themeOf(themeCode);
    assert.ok(theme, themeCode + ' 缺少前端配置');
    assert.equal(theme.candidates.length, 8, themeCode + ' 必须有8个商家角色');
    assert.ok(theme.interactions.length >= 1, themeCode + ' 缺少轻互动');
    codes.push(...theme.candidates.map((item) => item.code));
  });
  assert.equal(new Set(codes).size, 40);
});

test('每个主题推荐组合均为3—4家并覆盖主体验、补给、表达', () => {
  EXPECTED.forEach((themeCode) => {
    const theme = circle.themeOf(themeCode);
    const result = circle.validateSelection(themeCode, theme.recommended);
    assert.deepEqual(result, { ok: true, message: '' }, themeCode);
  });
});

test('8选3—4在小程序侧先给即时反馈，服务端仍是最终门禁', () => {
  assert.equal(circle.validateSelection('FRIENDS', ['P1', 'P2']).ok, false);
  assert.equal(circle.validateSelection('FRIENDS', ['P1', 'P2', 'P3', 'P4', 'P5']).ok, false);
  assert.equal(circle.validateSelection('FRIENDS', ['P1', 'P2', 'P8']).ok, false,
    '缺主体验时不能仅凭数量通过');
  assert.equal(circle.validateSelection('UNKNOWN', ['X1', 'X2', 'X3']).ok, false);
});

test('轻互动逐字遵守文档，不要求店员出题或认证', () => {
  assert.deepEqual(circle.themeOf('FITNESS').interactions.map((item) => item.stage),
    ['PRE_CHOICE', 'POST_CHOICE']);
  assert.equal(circle.themeOf('MIDLIFE').interactions[0].prompt, '今天哪一刻最像我自己？');
  assert.equal(circle.themeOf('DATE').interactions[0].choices.length, 3);
  assert.deepEqual(circle.themeOf('FRIENDS').interactions.map((item) => item.stage),
    ['PRE_WISH', 'NEXT_PICK']);
  assert.deepEqual(circle.themeOf('SHANGHAI').interactions[0].choices,
    ['味道', '穿搭', '声音', '夜色', '人情']);
  assert.equal(circle.themeOf('SHANGHAI').interactions[0].perRecordedOffer, true);
});
