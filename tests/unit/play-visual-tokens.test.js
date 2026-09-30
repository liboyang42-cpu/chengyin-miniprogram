const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROUTE_COLORS, routeColorForKey } = require('../../utils/play-visual-tokens.js')

test('路线色阶只使用中性灰且按 key 稳定取色', () => {
  assert.deepEqual(ROUTE_COLORS, ['#FFFFFF', '#D9D9D9', '#A6A6A6', '#737373', '#404040'])
  ROUTE_COLORS.forEach((color) => {
    const [, red, green, blue] = color.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/)
    assert.equal(red, green)
    assert.equal(green, blue)
  })
  assert.equal(routeColorForKey('chapter-1'), routeColorForKey('chapter-1'))
  assert.ok(ROUTE_COLORS.includes(routeColorForKey('chapter-2')))
})

// 这条原本写死四个 hex(--cy-route: #7A5CFF 等)。它真正要守的是「play 域的灰阶
// 路线色和全局路线色是**两套**、互不污染」，不是「必须等于某个具体值」——
// 2026-08-05 按用户裁决给全局路线色去紫时，就是这条字面量挡在前面。
// 改成判语义：play 那套必须是中性灰阶，全局那套必须有彩色，两套不能同值。
test('游玩路线灰阶不污染创作与活动页面的全局路线色', () => {
  const tokens = fs.readFileSync(path.resolve(__dirname, '../../style/tokens.wxss'), 'utf8')
  const val = (name) => {
    const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`).exec(tokens)
    assert.ok(m, `${name} 应有定义`)
    return m[1].toUpperCase()
  }
  const sat = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b)
    if (mx === mn) return 0
    const l = (mx + mn) / 2
    return (l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn)) * 100
  }
  // play 域:灰阶 = 饱和度为 0
  for (const n of ['--cy-play-route', '--cy-play-route-5']) {
    assert.equal(sat(val(n)), 0, `${n} 必须是中性灰阶(play 域的路线是黑白语言)`)
  }
  // 全局域:仍要能区分章节，所以至少有一档是彩色
  const globals = ['--cy-route', '--cy-route-2', '--cy-route-3', '--cy-route-4', '--cy-route-5'].map(val)
  assert.ok(globals.some((c) => sat(c) > 30), '全局路线色应保留彩色档以区分章节')
  // 两套不能同值 —— 那就是「污染」本身
  const playSet = new Set(['--cy-play-route', '--cy-play-route-5'].map(val))
  assert.ok(!globals.some((c) => playSet.has(c)), 'play 灰阶与全局路线色出现同值,两套已污染')
})
