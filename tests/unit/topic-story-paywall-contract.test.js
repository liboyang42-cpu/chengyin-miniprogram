const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('剧情付费墙跟在完整章节列表后，且不渲染后端未下发的章节', () => {
  const wxml = read('pages/topic/index/index.wxml')

  assert.match(wxml, /wx:if="\{\{info\.storyLocked && info\.lockedChapterCount > 0\}\}"/)
  assert.match(wxml, /topic-story-paywall__title">解锁完整体验/)
  assert.doesNotMatch(wxml, /后面还有 \{\{info\.lockedChapterCount/)
  assert.match(wxml, /topic-story-paywall__sub">解锁后可看全部故事线、答题揭秘与到店权益/)
  assert.match(wxml, /topic-story-paywall__price">\{\{money\.amount\(info\.selfPlayPrice\)\}\}/)
  assert.doesNotMatch(wxml, /selfPlayBenefitCount/)
  assert.doesNotMatch(wxml, /项到店体验/)
  assert.doesNotMatch(wxml, /含 4 项到店体验/)
  assert.doesNotMatch(wxml, /购票解锁 ·/)
  assert.match(wxml, /aria-label="立即解锁"[\s\S]*>立即解锁<\/view>/)
  assert.ok(wxml.indexOf('info.chaptersList') < wxml.indexOf('topic-story-paywall'))
  assert.match(wxml, /bindtap="selfPlayBuy"/)
  assert.match(wxml, /bindtap="goMyOrders"/)
})

test('主题响应只计算锁定数量，不伪造隐藏章节', () => {
  const js = read('pages/topic/index/index.js')

  assert.match(js, /totalChapterCount[\s\S]*unlockedChapterCount[\s\S]*lockedChapterCount/)
  assert.match(js, /Math\.max\(0, totalChapterCount - unlockedChapterCount\)/)
  assert.match(js, /goMyOrders[\s\S]*\/subpackageMember\/order\/order/)
})
