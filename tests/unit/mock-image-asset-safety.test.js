/**
 * 开发 mock 图片资产安全契约。
 *
 * 被清退的第三方海报既不能重新被 mock 引用，也不能再保留在小程序包内。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const REMOVED_ASSET = path.join(ROOT, 'images/d_cy.jpg');
const mockData = require('../../utils/mockData');

function runtimeSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['tests', 'node_modules', 'images'].includes(entry.name) ? [] : runtimeSources(entryPath);
    }
    return /\.(js|wxml|wxss|wxs|sjs|json)$/.test(entry.name) ? [entryPath] : [];
  });
}

function assertRetiredAssetAbsent(sources, assetExists) {
  sources.forEach(({ name, text }) => {
    assert.doesNotMatch(text, /\bd_cy\.jpg\b/i, `运行时源码不得重新引用已清退海报:${name}`);
  });
  assert.equal(assetExists, false, '已清退海报不得继续留在小程序包内');
}

function currentRuntimeSources() {
  return runtimeSources(ROOT).map((file) => ({
    name: path.relative(ROOT, file),
    text: fs.readFileSync(file, 'utf8'),
  }));
}

test('运行时源码与小程序包内均不存在已清退海报', () => {
  assertRetiredAssetAbsent(currentRuntimeSources(), fs.existsSync(REMOVED_ASSET));
});

test('清退断言具备红控:任意路径形态恢复引用或文件都会失败', () => {
  const current = currentRuntimeSources();
  assert.throws(() => assertRetiredAssetAbsent([...current, { name: 'utils/wxs/devMock.wxs', text: "'images/d_cy.jpg'" }], false));
  assert.throws(() => assertRetiredAssetAbsent(current, true));
});

// 封面已搬出小程序包(主包 2MB 硬限):预览也直接读线上静态目录,
// 母版留在仓库供追溯 —— 校验对着母版做,URL 形态单独钉。
// 2026-08-25:玩法封面换轨为自绘场景 key art(ci/render_template_covers.py),
// 母版从实拍 jpg 变成产出的 webp;topic-covers 老目录运行时已无消费方,
// 这一档只是给存量实拍图留一条同样要求母版的合法通道。
// 2026-08-25 二次换轨后,开发预览的封面只剩自绘/CC0 素材那一个目录。
// 这里刻意只留一档:老的 topic-covers 实拍目录运行时已无消费方,给它留位置等于
// 为不存在的需求开口子 —— 真有人写回去,下面这条会直接判红,比默默放行清楚。
const COVER_PREFIX = 'https://api.example.invalid/prod-api/profile/template-covers/';
const COVER_MASTER_DIR = '../docs/assets/template-covers/final';

function assertPublishCoverPolicy(home) {
  ['bannerList', 'latestList'].forEach((list) => {
    home[list].forEach((item) => {
      assert.ok(item.imgUrl.startsWith(COVER_PREFIX),
        `${list} 的开发预览必须走已登记的线上封面目录,不得写回包内路径:${item.imgUrl}`);
      const file = item.imgUrl.split('/').pop();
      assert.equal(fs.existsSync(path.join(ROOT, COVER_MASTER_DIR, file)), true,
        `线上封面必须在仓库留有母版:${item.imgUrl}`);
    });
  });
}

test('发布广场开发预览只用仓库留有母版的已登记线上封面', () => {
  assertPublishCoverPolicy(mockData.getHomeData());
  const page = fs.readFileSync(path.join(ROOT, 'pages/template/index.js'), 'utf8');
  assert.match(page, /coverErrorSrc:\s*'\/images\/no_data\.svg'/);
  assert.doesNotMatch(page, /home-route-city-placeholder\.jpg/, '路线图不能被当成主题封面兜底');
});

test('发布广场封面契约具备红控:空图或未登记目录的图片都会失败', () => {
  const home = mockData.getHomeData();
  const emptyCover = JSON.parse(JSON.stringify(home));
  emptyCover.latestList[0].imgUrl = '';
  assert.throws(() => assertPublishCoverPolicy(emptyCover));

  const unregisteredCover = JSON.parse(JSON.stringify(home));
  unregisteredCover.bannerList[0].imgUrl = '/images/cy_logo_mark.png';
  assert.throws(() => assertPublishCoverPolicy(unregisteredCover));
});
