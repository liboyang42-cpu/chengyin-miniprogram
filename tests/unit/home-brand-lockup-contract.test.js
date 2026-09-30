const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// 2026-08-26 品牌 lockup 退役:两端首页第一行都交给内容(玩家「Hi, xxx」/ 商家工作台),
// 不再挂 logo + CHEIN。这里锁的是「不许回来」,任何一端加回都必须变红。
function assertNoBrandLockups(source) {
  assert.doesNotMatch(source.playerWxml, /v3-hero-brand|CHEIN/,
    '玩家首页不挂品牌 lockup')
  assert.doesNotMatch(source.playerWxss, /\.v3-hero-brand/,
    '玩家端品牌样式随节点一起退役,不留死样式')
  assert.doesNotMatch(source.merchantWxml, /rv-home-brand|CHEIN/,
    '商家首页不挂品牌 lockup')
  assert.doesNotMatch(source.merchantWxss, /\.rv-home-brand/,
    '商家端品牌样式随节点一起退役,不留死样式')
}

test('玩家与商家首页都不再挂 CHEIN 品牌 lockup', () => {
  assertNoBrandLockups({
    playerWxml: read('pages/index/index.wxml'),
    playerWxss: read('pages/index/index.wxss'),
    merchantWxml: read('pages/merchant/index/index.wxml'),
    merchantWxss: read('pages/merchant/index/index.wxss'),
  })
})

test('负控:任一端把品牌加回来必须变红', () => {
  const clean = {
    playerWxml: '<view class="v3-hero-head"><text class="v3-hero-hi">Hi</text></view>',
    playerWxss: '.v3-hero-head { position:absolute; }',
    merchantWxml: '<view class="rv-merchant"></view>',
    merchantWxss: '.rv-merchant { display:block; }',
  }
  assert.doesNotThrow(() => assertNoBrandLockups(clean))
  assert.throws(() => assertNoBrandLockups({
    ...clean, playerWxml: clean.playerWxml + '<text class="v3-hero-brand-tx">CHEIN</text>' }))
  assert.throws(() => assertNoBrandLockups({
    ...clean, playerWxss: clean.playerWxss + '.v3-hero-brand { gap:8rpx; }' }))
  assert.throws(() => assertNoBrandLockups({
    ...clean, merchantWxml: clean.merchantWxml + '<text class="rv-home-brand-tx">CHEIN</text>' }))
  assert.throws(() => assertNoBrandLockups({
    ...clean, merchantWxss: clean.merchantWxss + '.rv-home-brand { gap:8rpx; }' }))
})
