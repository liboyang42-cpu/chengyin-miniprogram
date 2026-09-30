'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('帖文收藏在列表、详情、个人主页和我的收藏中共用同一接口', () => {
  const componentJs = read('components/cy/post-card/index.js')
  const componentWxml = read('components/cy/post-card/index.wxml')
  const list = read('pages/square/list/index.wxml')
  const detailJs = read('pages/square/detail/index.js')
  const profileJs = read('components/cy/profile/index.js')
  const mylikeJs = read('pages/mylike/mylike.js')

  assert.match(componentJs, /showFavorite[\s\S]*emitFavorite/)
  assert.match(componentWxml, /isBookmarked[\s\S]*emitFavorite[\s\S]*star-filled/)
  assert.match(list, /show-favorite[\s\S]*bind:favorite="favoriteClick"/)
  assert.match(detailJs, /favoriteClick\(\)[\s\S]*\/api\/creativesquare\/bookmark/)
  assert.match(profileJs, /favoriteClick[\s\S]*\/api\/creativesquare\/bookmark/)
  assert.match(mylikeJs, /favorite_only:\s*1[\s\S]*\/api\/creativesquare\/bookmark/)
})

test('转发使用产品箭头且点赞不再播放扩散圆环', () => {
  const componentWxml = read('components/cy/post-card/index.wxml')
  const detailWxml = read('pages/square/detail/index.wxml')
  const detailWxss = read('pages/square/detail/index.wxss')

  assert.match(componentWxml, /aria-label="转发帖文"[\s\S]*icon_share\.png/)
  assert.match(detailWxml, /aria-label="转发帖文"[\s\S]*icon_share\.png/)
  assert.doesNotMatch(detailWxss, /cy-like-ring|is-bursting::after/)
})
