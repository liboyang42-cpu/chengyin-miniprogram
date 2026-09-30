// P1-UI4 正式界面图标结构契约。
// 这里只约束三张页面的 UI 装饰：叙事/业务文案里的 emoji 不在本契约范围内。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const XCX = process.env.FORMAL_ICON_ROOT || path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(XCX, file), 'utf8');
const renderable = (wxml) => wxml.replace(/<!--[\s\S]*?-->/g, '');
const UI_EMOJI = /[\u{1F300}-\u{1FAFF}]/u;

const TARGETS = [
  'subpackageRoam/history/index.wxml',
  'pages/publish/temp/index.wxml',
  'pages/square/list/index.wxml',
];

function assertCyIconRegistration(jsonFile) {
  const config = JSON.parse(read(jsonFile));
  assert.equal(
    config.usingComponents && config.usingComponents['cy-icon'],
    '/components/cy/icon/index',
    `${jsonFile} 必须注册 cy-icon`
  );
}

test('三张正式页面不再把 emoji 当作 UI 图标', () => {
  for (const file of TARGETS) {
    assert.doesNotMatch(renderable(read(file)), UI_EMOJI, `${file} 仍含正式 UI emoji`);
  }
});
test('漫游历史路线使用 walk 语义图标并保留时长', () => {
  const wxml = renderable(read('components/cy/scene-roam-history/index.wxml'));
  assertCyIconRegistration('components/cy/scene-roam-history/index.json');
  // 2026-08-06 历史卡改 RunCard 版式:walk 图标在封面空位,时长在「用时」读数格
  assert.match(wxml, /<cy-icon wx:else name="walk" size="61" \/>/);
  assert.match(wxml, /<text class="rc__v">\{\{item\.time\}\}<\/text><text class="rc__l">用时<\/text>/);
});

test('语音上传入口保留可点击的纯文本标签', () => {
  const wxml = renderable(read('pages/publish/temp/index.wxml'));
  // 不锁 bindtap 紧跟 >:按压态等属性会插在它之后,这里只验「入口在 + 绑对方法 + 纯文本标签」
  assert.match(wxml, /<view class="cg-audio-empty"[^>]*bindtap="uploadAudio"[^>]*>上传音频文件<\/view>/);
});

test('广场完成状态使用 star 语义图标并保留完成数量', () => {
  const listWxml = renderable(read('pages/square/list/index.wxml'));
  const cardWxml = renderable(read('components/cy/feed-play-card/index.wxml'));
  assertCyIconRegistration('pages/square/list/index.json');
  assertCyIconRegistration('components/cy/feed-play-card/index.json');
  const stars = [...(listWxml + cardWxml).matchAll(/<cy-icon\b[^>]*name="star"/g)];
  assert.equal(stars.length, 2, '活动选择摘要与帖子通关徽章各应有一个 star 图标');
  assert.match(listWxml, /selectedActivity\.name\}\} · 完成 \{\{selectedActivity\.doneCount\}\}/);
  assert.match(cardWxml, /class="feed-play-card__trophy"[\s\S]*class="feed-play-card__trophy-icon"/);
});
