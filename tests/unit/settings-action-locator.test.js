'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/shezhi/shezhi.wxml'), 'utf8');

test('设置页每个 cy-cell 动作都有稳定且唯一的 id 定位器', () => {
  const cells = wxml.match(/<cy-cell\b[^>]*\bbind:tap="[^"]+"[^>]*\/>/g) || [];
  assert.equal(cells.length, 10, '设置菜单动作数量变化时必须同步定位器合同');
  const ids = cells.map((tag) => {
    const match = /\bid="([^"]+)"/.exec(tag);
    assert.ok(match, `缺少 id: ${tag}`);
    return match[1];
  });
  assert.equal(new Set(ids).size, ids.length, '设置菜单 id 必须逐动作唯一');
  assert.ok(ids.includes('settings-marketing-consent'), '营销同意入口必须有稳定定位器');
});
