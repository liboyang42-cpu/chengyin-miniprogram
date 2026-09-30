const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const FILES = [
  'pages/publish/fabu/index.js',
  'pages/merchant/coop-center/index.js',
  'pages/topic/index/index.js',
  'pages/publish/temp/index.js',
];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function assertSanitized(sources) {
  for (const [file, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /title:\s*error\.message\b/, `${file} 直接展示 Error.message`);
    assert.doesNotMatch(source, /title:\s*\(err\s*&&\s*err\.errMsg\)/, `${file} 直接展示微信 errMsg`);
  }
}

test('发布编辑、邀约与音频失败信息统一经过用户消息净化', () => {
  assertSanitized(Object.fromEntries(FILES.map((file) => [file, read(file)])));
});

test('负控：重新把 Error.message 直塞 toast 必须判红', () => {
  const sources = Object.fromEntries(FILES.map((file) => [file, read(file)]));
  sources['pages/merchant/coop-center/index.js'] += "\nwx.showToast({ title: error.message, icon: 'none' });\n";
  assert.throws(() => assertSanitized(sources), /直接展示 Error\.message/);
});
