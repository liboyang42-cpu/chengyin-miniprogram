const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const { decorateFeedCards } = require('../../utils/index/feed-card.js');

test('feed 图片只按真实数量渲染：单图铺满，四张及以上取四张', () => {
  const [single, gallery] = decorateFeedCards([
    { imgArr: 'one.jpg' },
    { imgArr: '1.jpg,2.jpg;3.jpg,4.jpg,5.jpg' },
  ], (src) => `cdn/${src}`);

  assert.deepEqual(single.feedImages, ['cdn/one.jpg']);
  assert.equal(single.feedGridMode, '1');
  assert.deepEqual(gallery.feedImages, ['cdn/1.jpg', 'cdn/2.jpg', 'cdn/3.jpg', 'cdn/4.jpg']);
  assert.equal(gallery.feedGridMode, '4');
  assert.equal(gallery.moreCount, 1);
});

test('feed 左上显示真实主题类型，左下显示最多两个真实标签，二者不串位', () => {
  const [city, explore, unknown] = decorateFeedCards([
    {
      productType: 1,
      sysCategoryList: [
        { categoryName: '亲子' },
        { categoryName: '解谜' },
        { categoryName: '不应展示' },
      ],
    },
    { productType: '2', sysCategoryList: [{ categoryName: '探店' }] },
    { productType: 99, sysCategoryList: [{ categoryName: '夜游' }] },
  ], (src) => src);

  assert.equal(city.feedTypeLabel, '城市定向');
  assert.deepEqual(city.feedTags, ['亲子', '解谜']);
  assert.equal(explore.feedTypeLabel, '自由探索');
  assert.deepEqual(explore.feedTags, ['探店']);
  assert.equal(unknown.feedTypeLabel, '', '未知类型不得拿第一个标签冒充');
  assert.deepEqual(unknown.feedTags, ['夜游']);
});

test('附近活动与 feed 共用封面归一化，imgUrl 也会成为可展示 cover', () => {
  const [item] = decorateFeedCards([{ imgUrl: 'activity.jpg' }], (src) => `cdn/${src}`);
  assert.equal(item.cover, 'cdn/activity.jpg');
  assert.deepEqual(item.feedImages, ['cdn/activity.jpg']);
});

test('推荐主题紧跟 banner，标题精确为“推荐主题”', () => {
  const wxml = read('pages/index/index.wxml');
  const hero = wxml.indexOf('id="sec-hero"');
  const reco = wxml.indexOf('id="sec-reco"');
  const nearby = wxml.indexOf('id="sec-nearby"');

  assert.ok(hero >= 0 && reco > hero && nearby > reco, '区块顺序必须是 banner → 推荐主题 → 附近活动');
  assert.match(wxml, /id="sec-reco"[\s\S]*?<text class="v3-sec-title">推荐主题<\/text>/);
  assert.doesNotMatch(wxml, />为你专属推荐主题<\/text>/);
});

test('feed 卡使用全局白色设计 token，单图与四图尺寸对应 Figma 两个节点', () => {
  const tokens = read('style/tokens.wxss');
  const wxss = read('pages/index/index.wxss');
  assert.match(tokens, /--cy-color-home-feed-surface:\s*#F0F0EE/);
  assert.doesNotMatch(wxss, /--cy-home-/);
  assert.match(wxss, /\.v2-fcard\s*\{[^}]*background:\s*var\(--cy-color-home-feed-surface\)/s);
  assert.match(wxss, /\.v2-fgrid\s*\{[^}]*width:\s*316rpx;[^}]*height:\s*300rpx/s);
  assert.match(wxss, /\.v2-fgrid--1\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*grid-template-rows:\s*1fr/s);
  assert.match(wxss, /\.v2-fgrid--4\s*\{[^}]*grid-template-columns:\s*1fr 1fr;[^}]*grid-template-rows:\s*1fr 1fr/s);
});

test('四图卡的更多蒙层位于第 2 张，左上类型与左下标签消费独立字段', () => {
  const wxml = read('pages/index/index.wxml');
  const moreOverlays = wxml.match(/gi === 1 && item\.moreCount/g) || [];
  const countBadges = wxml.match(/gi === 3 && item\.feedBadgeCount/g) || [];
  assert.equal(moreOverlays.length, 2, '主题和活动分支都应在第 2 张显示 +N');
  assert.equal(countBadges.length, 2, '主题和活动分支都应在第 4 张显示橙色徽标');
  assert.equal((wxml.match(/class="v2-feyebrow ep1"[^>]*>\{\{item\.feedTypeLabel\}\}/g) || []).length, 2);
  assert.equal((wxml.match(/wx:for="\{\{item\.feedTags\}\}"/g) || []).length, 2);
  assert.doesNotMatch(wxml, /v2-feyebrow[^>]*>\{\{item\.sysCategoryList\[0\]/);
});

test('附近活动和即将上线都以真实图片作为卡片主视觉', () => {
  const wxml = read('pages/index/index.wxml');
  assert.match(wxml, /class="v3-nearby-bg"[^>]*src="\{\{item\.cover/);
  assert.match(wxml, /class="v3-upreview-bg"[^>]*src="\{\{item\.cover/);
  assert.match(wxml, /class="v3-upreview-mask"/);
});

test('开发预览的 feed 与即将上线只使用微信能渲染的位图资产', () => {
  const source = read('pages/index/index.js');
  const mock = source.match(/function buildIndexUiMock\(\) \{([\s\S]*?)\n\}\n\nPage\(/);
  assert.ok(mock, '首页开发预览数据入口必须存在');
  assert.doesNotMatch(mock[1], /figma_cat\d+\.png/, '这些 .png 实际是 SVG，微信 image 会渲染失败');
  assert.match(mock[1], /index-figma\/nearby-card\.jpg/);
  assert.match(mock[1], /index-figma\/reco-hero\.jpg/);
});

test('负控：把单图模式误改回四宫格时契约必须判红', () => {
  const wxss = read('pages/index/index.wxss');
  const mutated = wxss.replace(
    /(\.v2-fgrid--1\s*\{[^}]*grid-template-columns:)\s*1fr;/,
    '$1 1fr 1fr;',
  );
  assert.notEqual(mutated, wxss, '负控锚点失效');
  assert.throws(
    () => assert.match(mutated, /\.v2-fgrid--1\s*\{[^}]*grid-template-columns:\s*1fr;/s),
    assert.AssertionError,
  );
});
