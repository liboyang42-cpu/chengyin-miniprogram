// CU-C-162：标题与滚动区必须分开布局，不能靠滚动内容的 padding 给固定标题让位。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxss = fs.readFileSync(path.resolve(__dirname, '../../pages/publish/temp/index.wxss'), 'utf8');
const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/publish/temp/index.wxml'), 'utf8');

function ruleBody(selector) {
  const start = wxss.indexOf(selector);
  if (start < 0) return null;
  const open = wxss.indexOf('{', start);
  const close = wxss.indexOf('}', open);
  return open < 0 || close < 0 ? null : wxss.slice(open + 1, close);
}

test('标题与滚动视口在 flex 列中分配各自的高度', () => {
  const page = ruleBody('.cg {');
  assert.match(page, /height:\s*100vh/);
  assert.match(page, /display:\s*flex/);
  assert.match(page, /flex-direction:\s*column/);
  const title = ruleBody('.cg > cy-page-title {');
  assert.match(title, /flex:\s*none/);
  const scroll = ruleBody('.cg-scroll {');
  assert.match(scroll, /flex:\s*1/);
  assert.match(scroll, /min-height:\s*0/);
  assert.doesNotMatch(scroll, /position:\s*absolute|padding:\s*calc/);
});

test('标题仍然是这个页唯一的那一个', () => {
  const titles = wxml.match(/<cy-page-title/g) || [];
  assert.equal(titles.length, 1, 'L1 标题只出现一次(chrome-spec)');
  assert.match(wxml, /<cy-nav-bar[^>]*custom-back/);
});
