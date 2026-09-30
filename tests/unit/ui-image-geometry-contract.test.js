const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('评分星标使用 aspectFit，不能由默认 scaleToFill 拉伸', () => {
  const source = read('pages/topic/index/index.wxml');
  assert.match(source, /class="image-item"[\s\S]*?src="\{\{index<=answer\?[^\n]+\}\}"\s+mode="aspectFit"/);
});

test('集合屏头像使用 aspectFill，圆形头像不能被默认模式压扁', () => {
  const source = read('pages/play/index.wxml');
  assert.match(source, /class="lg-ava[^\n]*"[\s\S]*?src="\{\{item\.avatar\}\}"\s+mode="aspectFill"/);
});

test('关键图标/头像不允许出现没有 mode 的 image 标签', () => {
  const targets = [
    ['pages/topic/index/index.wxml', /class="image-item"/],
    ['pages/play/index.wxml', /class="lg-ava/]
  ];
  for (const [relativePath, marker] of targets) {
    const source = read(relativePath);
    const match = source.match(new RegExp(`<image\\b(?=[^>]*${marker.source.slice(1, -1)})[^>]*>`));
    assert.ok(match && /\bmode=/.test(match[0]), `${relativePath} 的关键 image 必须显式声明 mode`);
  }
});
