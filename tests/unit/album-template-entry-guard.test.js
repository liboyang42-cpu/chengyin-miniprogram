'use strict';

/* 相册模板只能进故事流。服务端不把 album 算作高级玩法,绑成普通节点 = 玩家到点直接打卡、
 * 一张照片都看不到。故事以外选模板的入口必须拦下。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { isAlbumTemplate } = require('../../utils/album-template.js');

test('isAlbumTemplate:只认启用了的 album 段,坏 JSON 不炸', () => {
  assert.equal(isAlbumTemplate({ advancedConfigJson: '{"schemaVersion":1,"album":{"enabled":true,"images":[]}}' }), true);
  assert.equal(isAlbumTemplate({ advancedConfigJson: { album: { enabled: true } } }), true);
  assert.equal(isAlbumTemplate({ advancedConfigJson: '{"album":{"enabled":false}}' }), false);
  assert.equal(isAlbumTemplate({ advancedConfigJson: '{"qa":{"enabled":true}}' }), false);
  assert.equal(isAlbumTemplate({ advancedConfigJson: '{bad' }), false);
  assert.equal(isAlbumTemplate({}), false);
  assert.equal(isAlbumTemplate(null), false);
});

const ENTRIES = [
  ['活动选模板', 'pages/publish/activity/index.js'],
  ['主题章节节点表单', 'pages/topic/components/cy/chapter-node-form/index.js'],
  ['据点配玩法', 'pages/merchant/citynode/create/index.js'],
];

for (const [name, file] of ENTRIES) {
  test('故事以外的入口拦相册模板:' + name, () => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(src, /require\('[./]+utils\/album-template\.js'\)/, name + ' 没接相册判断');
    assert.match(src, /if \(isAlbumTemplate\([^)]+\)\) \{?\s*(cyToast|toast)\(ALBUM_ONLY_IN_STORY\);\s*return;/, name + ' 判到相册要提示并 return,不许继续绑定');
  });
}
