const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const js = fs.readFileSync(path.join(__dirname, '../../pages/index/index.js'), 'utf8')
const wxml = fs.readFileSync(path.join(__dirname, '../../pages/index/index.wxml'), 'utf8')

test('首页品牌 hero 不得吞掉首屏，推荐主题紧跟 Banner 且附近活动保持后继可达', () => {
  assert.match(js, /heroBannerH\s*=\s*Math\.round\(winH \* 3 \/ 5\)/,
    'hero 最大只占视口 60%，给首个内容区块留下首屏空间')
  assert.ok(wxml.indexOf('id="sec-reco"') > wxml.indexOf('id="sec-hero"'))
  assert.ok(wxml.indexOf('id="sec-reco"') < wxml.indexOf('id="sec-nearby"'))
})

// 2026-09-02:首图换成纯展示的品牌封面后，role 与 label 都按 item.route 分叉——
// 可点的仍念「打开 X」，不可点的念 X 本身而不是冒充按钮。两支都必须有名字。
test('首页 hero 可点击项有可读名称，不能只靠图片暗示', () => {
  assert.match(wxml, /<swiper-item[^>]*bindtap="onHeroBannerTap"[\s\S]*?aria-role="\{\{item\.route \? 'button' : 'img'\}\}"/)
  assert.match(wxml, /aria-label="\{\{item\.route \? '打开' : ''\}\}\{\{item\.name \|\| '城瘾精选'\}\}"/)
})
