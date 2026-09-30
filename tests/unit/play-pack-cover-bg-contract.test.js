/* 2026-09-24 用户:「打开那个卡包的时候(镭射塑料袋)上面不能有搜索框,卡包背景应该是主题的封面图的虚化」。
 *
 * ① 顶部「输入地址」是给地图用的(见 wxml 注释「铺在每一张地图上」),自由探索首屏(卡包 → 六宫格)
 *    是一张整屏 scroll-view,不是地图 —— 它原先只在 screen / 手记 / 完成页 / 章节全屏时让位,
 *    卡包那一屏漏了,白框就压在卡包上面。
 * ② 首屏底图原先只取「第一章封面 → 第一家商户图」,主题自己的封面从没下发过。
 *    现在后端带 topicCover(主题长图),前端先用它,没有才退回原来那条链。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')
const wxml = read('pages/play/index.wxml')
const js = read('pages/play/index.js')

test('★自由探索首屏(卡包/六宫格)不挂「输入地址」:它不是地图', () => {
  const tag = (wxml.match(/<cy-map-address-search[^>]*>/) || [''])[0]
  assert.ok(tag, '没找到输入地址')
  const cond = (tag.match(/wx:if="\{\{([^}]*)\}\}"/) || [])[1] || ''
  assert.match(cond, /!\(mode==2 && !freeMap\)/, '自由探索首屏还会露出输入地址白框')
  // 首屏与输入地址的判据必须是同一句,否则一边改了另一边就又叠在一起
  assert.match(wxml, /<scroll-view class="fx" wx:if="\{\{mode==2 && !freeMap\}\}"/)
})

test('★卡包底图先用主题封面(虚化),没有才退回章节封面链', () => {
  const bg = (wxml.match(/<view class="fx-bg[ "][\s\S]*?<\/view>\s*<\/view>/) || [''])[0]
  assert.match(bg, /wx:if="\{\{topicCover \|\| chapter\.cover\}\}"/, '没有主题封面时整层不渲染的判据要带上主题封面')
  assert.match(bg, /class="fx-bg__im" src="\{\{topicCover \|\| chapter\.cover\}\}"/, '底图没先用主题封面')
  assert.match(js, /topicCover: ''/, 'data 里要有 topicCover 初值')
  assert.equal((js.match(/topicCover: d\.topicCover \|\| ''/g) || []).length, 2, '两条载入路径都要写 topicCover,漏一条就是那条路径上背景不对')
  assert.match(read('pages/play/index.wxss'), /\.fx-bg__im\{[^}]*\n?\s*filter:blur\(/, '底图要虚化')
})

test('★卡包还没撕开时蒙版减淡,白字一露头就回到原来的深度(减淡档必须与白字同判据)', () => {
  const css = read('pages/play/index.wxss')
  const m = css.match(/\.fx-bg--pack \.fx-bg__veil\{[^}]*opacity:\s*([0-9.]+)/)
  assert.ok(m, '卡包阶段没减淡蒙版')
  assert.ok(Number(m[1]) > 0 && Number(m[1]) < 1, '蒙版透明度要在 0 和 1 之间')
  assert.match(css, /\.fx-bg__veil\{[^}]*transition:\s*opacity/, '摘档时蒙版要渐变回去,不能一下跳黑')

  // 减淡档的判据要与「通行证头 / 小标题」白字自己的露脸判据逐字相同。
  // packOpen 是发牌全部落地才置的(约 2.4s 后),headIn 才是白字露脸那一拍:
  // 只判 packOpen,这段窗口的白字就压在浅蒙版上 —— 改回去这条必红(负控)。
  const cond = (s) => (s.split('?')[0] || '').trim()
  const bg = (wxml.match(/class="fx-bg \{\{([^}]*)\}\}/) || [])[1]
  assert.ok(bg, '底图没有单独的减淡档')
  const textIn = [...wxml.matchAll(/class="fx-(?:pass|lhd) fx-veil \{\{([^}]*)\}\}/g)].map((x) => cond(x[1]))
  assert.equal(textIn.length, 2, '通行证头和小标题的露脸判据各一条')
  assert.notEqual(cond(bg), 'packOpen', '只判 packOpen:发牌那 ~2.4s 白字已露脸、蒙版还浅,亮封面上会糊')
  for (const t of textIn) {
    assert.equal(cond(bg), t, '底图减淡档和白字露脸不是同一判据 —— 一边改了另一边就又错开')
  }
})
