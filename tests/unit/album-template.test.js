const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../pages/publish/utils/publish/advanced-game-config');
const catalog = require('../../pages/publish/utils/publish/node-game-catalog');
const preview = require('../../pages/publish/utils/publish/advanced-game-preview');

test('相册模板保存、重开与预览保留照片和配文', () => {
  const m = config.defaultConfig();
  assert.ok(m.album, '相册必须注册在配置中');
  m.album.enabled = true;
  m.album.images = [{url: 'https://example.com/a.jpg', line: '童年'}, {url: '/profile/b.jpg', line: '现在'}];
  assert.equal(config.validate(m), '');
  const back = config.parse(config.serialize(m));
  assert.equal(back.error, '');
  assert.deepEqual(back.value.album.images, m.album.images);
  assert.equal(catalog.detectGame(back.value), 'album');
  const kit = preview.buildPreviewKit(back.value, {title: '我的回忆'});
  assert.equal(kit.type, 'album');
  assert.equal(kit.title, '我的回忆');
  assert.deepEqual(kit.images, m.album.images);
  back.value.album.images[0].line = '修改';
  assert.equal(m.album.images[0].line, '童年');
});

const story = require('../../pages/publish/utils/publish/pro-editor-story');
test('相册插入故事并保存后保留名称，且不创建通关节点', () => {
  const chapter = { nodes: [], blocks: [{key:'text', type:'text', content:'后续正文'}] };
  const result = story.applyStoryCommand({chapter, pendingMaterials:[]}, {
    type:'insertMediaAt', mediaType:'dream', index:0, blockKey:'album', title:'梦',
    images:[{url:'https://example.com/a.jpg',line:'记忆'}],
  });
  assert.equal(result.draft.chapter.nodes.length, 0);
  assert.equal(result.draft.chapter.blocks[0].title, '梦');
  assert.equal(result.draft.chapter.blocks[1].content, '后续正文');
});

test('空相册、过多照片、长配文和本地临时路径不能保存', () => {
  for (const images of [[], Array(7).fill({url:'https://example.com/a.jpg'}),
    [{url:'https://example.com/a.jpg',line:'字'.repeat(41)}], [{url:'wxfile://tmp/a.jpg'}]]) {
    const m = config.defaultConfig(); m.album = {enabled:true,images};
    assert.ok(config.validate(m));
  }
});

test('新建空相册不能打开 1/0 的空白预览', () => {
  const m = catalog.applyToConfig(config.defaultConfig(), 'album', {demo: true});
  assert.equal(preview.buildPreviewKit(m), null);
  assert.equal(preview.buildSampleKit('album'), null);
});
