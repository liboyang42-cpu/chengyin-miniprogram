'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxss = fs.readFileSync(path.resolve(__dirname, '../../pages/template/index.wxss'), 'utf8');

test('模板首页搜索入口保留至少 88rpx 的整行触控高度', () => {
  const rule = /\.tpl-search\s*\{([\s\S]*?)\}/.exec(wxss);
  assert.ok(rule, '缺少 .tpl-search 规则');
  assert.match(rule[1], /min-height:\s*var\(--cy-btn-h\)/);
  assert.match(rule[1], /box-sizing:\s*border-box/);
});
