const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WXML = fs.readFileSync(
  path.join(__dirname, '../../pages/template/index.wxml'),
  'utf8'
);

const WXSS = fs.readFileSync(
  path.join(__dirname, '../../pages/template/index.wxss'),
  'utf8'
);
const TOKENS = fs.readFileSync(
  path.join(__dirname, '../../style/tokens.wxss'),
  'utf8'
);

test('本页样式不得引用未定义的 token（如 --cy-legacy-2）', () => {
  const localDefs = new Set(
    [...WXSS.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
  );
  const tokenDefs = new Set(
    [...TOKENS.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
  );
  // 只查没有兜底值的引用：var(--x, 0px) 这类由调用方注入的不算
  const used = [...WXSS.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter(
    (name) => !tokenDefs.has(name) && !localDefs.has(name)
  );
  assert.deepEqual(missing, [], '引用了未定义的 token: ' + missing.join(', '));
});

test('封面失败态不保留首字/CSS 占位', () => {
  assert.doesNotMatch(WXML, /cover-fb(?:-letter)?/);
  assert.doesNotMatch(WXSS, /\.cover-fb(?:-letter)?\s*\{/);
});
