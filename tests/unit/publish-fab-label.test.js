const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_DIR = path.join(__dirname, '../../pages/template');
const wxml = fs.readFileSync(path.join(PAGE_DIR, 'index.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(PAGE_DIR, 'index.wxss'), 'utf8');

test('商家发布按钮复用圆形加号，保留无障碍标签', () => {
  assert.match(wxml, /class="fab[^"]*"[^>]*aria-label="发布"/);
  assert.match(wxml, /<cy-icon name="plus" size="48"/);
  assert.match(wxss, /width: var\(--cy-comp-publish-trigger\)/);
  assert.match(wxss, /height: var\(--cy-comp-publish-trigger\)/);
});

test('悬浮按钮仍保留唯一发布触发方法', () => {
  assert.equal((wxml.match(/bindtap="openPublishSheet"/g) || []).length, 1);
});
