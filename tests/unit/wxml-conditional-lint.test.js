'use strict';

const assert = require('assert');
const path = require('path');
const test = require('node:test');
const {
  findConditionalChainErrors,
  lintWxmlDirectory
} = require('../../scripts/wxml-conditional-lint');

test('WXML 条件链门禁拒绝孤立 wx:elif / wx:else', () => {
  const errors = findConditionalChainErrors([
    '<view wx:elif="{{ready}}"></view>',
    '<view></view>',
    '<view wx:else></view>'
  ].join('\n'));

  assert.deepStrictEqual(errors.map((error) => error.directive), ['wx:elif', 'wx:else']);
});

test('WXML 条件链允许同层 wx:if / wx:elif / wx:else，允许嵌套分支', () => {
  const errors = findConditionalChainErrors([
    '<block wx:if="{{outer}}">',
    '  <view wx:if="{{inner}}"></view>',
    '  <view wx:else></view>',
    '</block>',
    '<block wx:elif="{{fallback}}"></block>',
    '<block wx:else></block>'
  ].join('\n'));

  assert.deepStrictEqual(errors, []);
});

test('所有小程序 WXML 当前均没有孤立条件分支', () => {
  const root = path.resolve(__dirname, '../..');
  assert.deepStrictEqual(lintWxmlDirectory(root), []);
});
