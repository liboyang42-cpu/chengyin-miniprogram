const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_JS = path.join(__dirname, '../../pages/index/index.js');
const ACTION_BANNER_JS = path.join(__dirname, '../../utils/index/home-action-banner.js');
const IMAGE_DIR = path.join(__dirname, '../../images');
const source = fs.readFileSync(INDEX_JS, 'utf8');
const actionBannerSource = fs.readFileSync(ACTION_BANNER_JS, 'utf8');

test('首页行动 Banner 使用真实本地位图海报，不回退到旧随机占位图', () => {
  const filenames = [
    'home-banner-club.jpg',
    'home-banner-merchant.jpg',
    'home-banner-friends.jpg',
  ];

  assert.doesNotMatch(actionBannerSource, /home-banner-[123]\.jpg|route_(?:city|free)_cover\.png/);
  filenames.forEach((filename) => {
    const assetPath = path.join(IMAGE_DIR, filename);
    assert.match(actionBannerSource, new RegExp(`/images/${filename}`));
    assert.ok(fs.existsSync(assetPath), `${filename} must be checked into the mini-program assets`);

    const asset = fs.readFileSync(assetPath);
    const magic = asset.subarray(0, 8).toString('hex');
    assert.ok(magic === '89504e470d0a1a0a' || magic.startsWith('ffd8ff'),
      `${filename} must be a local PNG/JPEG bitmap asset (got ${magic})`);
    assert.ok(asset.length > 10000, `${filename} must contain the banner artwork, not an empty fallback`);
  });
});

test('首页开发预览 mock 列表不再把旧路线封面喂给下方卡片', () => {
  const mockBlock = source.match(/function buildIndexUiMock\(\) \{([\s\S]*?)\n\}\n\nPage\(/);
  assert.ok(mockBlock, 'buildIndexUiMock must remain the preview data source');
  assert.doesNotMatch(mockBlock[1], /route_city_cover\.png|route_free_cover\.png/);
  assert.match(mockBlock[1], /home-route-city-placeholder\.jpg/);
  assert.match(mockBlock[1], /home-route-free-placeholder\.jpg/);

  for (const declaration of [
    'const nearby =',
    'const recommendedTopicList =',
    'const upcomingRaw =',
    'const bottomTopicList =',
    'const bottomActivityList =',
  ]) {
    assert.ok(mockBlock[1].includes(declaration), `${declaration} must remain in the preview mock chain`);
  }
});

test('首页推荐主题必须请求已筛选的推荐位，不得与全量主题重复', () => {
  assert.match(source,
    /getListData\('recommendedTopicList',\s*'\/api\/topic\/list',\s*\{[\s\S]{0,160}?is_recommend:\s*1/);
});
