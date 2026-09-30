'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function assertSharedPostCard(overrides = {}) {
  const componentWxml = overrides.componentWxml || read('components/cy/post-card/index.wxml')
  const componentWxss = overrides.componentWxss || read('components/cy/post-card/index.wxss')
  const pages = ['pages/square/list', 'pages/club/detail', 'pages/talent/list']

  pages.forEach((page) => {
    const json = JSON.parse(read(page + '/index.json'))
    const wxml = overrides[page] || read(page + '/index.wxml')
    assert.equal(json.usingComponents['cy-post-card'], '/components/cy/post-card/index')
    assert.match(wxml, /<cy-post-card\b[^>]*post="\{\{item\}\}"/)
    assert.doesNotMatch(wxml, /class="feed-post(?:\s|"|-)/)
  })

  // 2026-09-02 Figma 297:1827:首列宽改由 --pc-avatar 出(Image / Text 44pt=88rpx,
  // Roam / Template 挂 .post-card--compact 降到 40pt),不再是写死的 --cy-space-8。
  // 真正的不变式是「首列宽 == 头像宽」,所以两处必须读同一个变量,不许各写一份字面值。
  assert.match(componentWxss, /\.post-card\s*\{[^}]*grid-template-columns:\s*var\(--pc-avatar\)\s+minmax\(0,\s*1fr\)/s)
  assert.match(componentWxss, /\.post-card__avatar\s*\{[^}]*width:\s*var\(--pc-avatar\)[^}]*height:\s*var\(--pc-avatar\)/s)
  assert.match(componentWxss, /\.post-card--compact\s*\{\s*--pc-avatar:\s*var\(--cy-space-7\)/)
  // 骨架跟真卡片走(用户拍板):头像与首列间距差一格,加载完成时整栏会横向弹一下。
  const skeletonWxss = overrides.skeletonWxss || read('components/cy/skeleton/index.wxss')
  assert.match(skeletonWxss, /\.sk-post\s*\{[^}]*gap:\s*var\(--cy-space-2-5\)[^}]*padding:\s*36rpx/s)
  assert.match(skeletonWxss, /\.sk-post-avatar\s*\{[^}]*width:\s*88rpx[^}]*height:\s*88rpx/s)
  assert.match(componentWxss, /\.post-card__text\s*\{[^}]*-webkit-line-clamp:\s*2/s)
  // 点赞态由「描边 heart = 未赞 / 实心 heart-filled = 已赞」表达,不再是一张自带红的位图 SVG。
  assert.match(componentWxml, /post-card__action--like[\s\S]*post-card__heart[^>]*name="heart-filled"[\s\S]*post-card__heart[^>]*name="heart"[\s\S]*emitComment[\s\S]*post-card__share/)
  // 负控:旧做法是去色滤镜把红实心心压成灰实心心,用户读作「已赞」——不许回潮。
  assert.doesNotMatch(componentWxss, /grayscale|post-card__heart--muted/)
  assert.match(componentWxml, /<cy-icon[^>]*name="comment"/)
  assert.match(componentWxml, /aria-label="转发帖文"[\s\S]*src="\/images\/icon_share\.png"/)
  assert.doesNotMatch(componentWxml, /repostCount|name="share"/)
  assert.match(read('pages/talent/list/index.wxml'), /interactive-club/)
  // 俱乐部详情固定暗色，不传 light；达人页会随商家视角切浅色，转发位图需要据此翻色。
  assert.doesNotMatch(read('pages/club/detail/index.wxml'), /light="/, '俱乐部详情固定暗色，不应误开浅色卡片')
  assert.match(read('pages/talent/list/index.wxml'), /light="\{\{isMerchantViewer\}\}"/)
  assert.match(read('pages/talent/list/index.js'), /club\/detail\/index\?id=' \+ clubId \+ '&postId=' \+ postId/)
}

test('广场、俱乐部、达人帖文收敛为参考图口径的同一组件', () => {
  assertSharedPostCard()
})

test('负控：俱乐部退回私有帖文根节点时共享契约会判红', () => {
  const club = read('pages/club/detail/index.wxml').replace('<cy-post-card', '<view class="feed-post"')
  assert.throws(() => assertSharedPostCard({ 'pages/club/detail': club }), /cy-post-card|feed-post/)
})
