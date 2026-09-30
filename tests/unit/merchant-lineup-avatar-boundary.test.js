const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WXML_PATH = path.resolve(__dirname, '../../pages/topic/merchantinfo/merchantinfo.wxml');
const WXML = fs.readFileSync(WXML_PATH, 'utf8');

function hasNullableAvatarFallback(source) {
  return /<cy-avatar\b[^>]*\bsrc="\{\{item\.avatar \|\| ''\}\}"/.test(source);
}

test('商家主题阵容的可空头像在传入 cy-avatar 前归一为空串', () => {
  assert.equal(hasNullableAvatarFallback(WXML), true);
});

test('负控：直接透传 item.avatar 会被契约拒绝', () => {
  const unsafe = WXML.replace("src=\"{{item.avatar || ''}}\"", 'src="{{item.avatar}}"');
  assert.equal(hasNullableAvatarFallback(unsafe), false);
});
