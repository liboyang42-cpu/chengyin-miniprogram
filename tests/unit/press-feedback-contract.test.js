// 按压反馈契约(2026-08-25)
//
// 小程序里 view 没有 :active,按压反馈只能靠 hover-class 逐个元素声明 —— 也就必然会漏。
// 全量审查时实测:1341 个可点元素里只有 106 个有按压反馈(8%)。
//
// 这条契约不追全量(给上千个元素喷 hover-class 是个无法目视验证的巨大 diff,
// 而且地图、整卡带图的容器套 opacity 会很难看),只锁**共享交互组件**:
// 它们一处生效就覆盖大量实例,是投入产出比最高的一档。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 用户直接点、且点了会发生事情的共享组件。结构性点击(遮罩关闭、noop 吃冒泡、
// 关闭 ✕)不在此列 —— 那些不是「内容」,给按压反馈反而是噪音。
const INTERACTIVE = [
  'components/cy/btn',
  'components/cy/cell',
  'components/cy/tabs',
  'components/cy/field',
  'components/cy/dropdown',
  'components/cy/date-field',
  'components/cy/consent-check',
  'components/cy/scene-member-order-history',
  'components/cy/scene-play-activity-detail',
  'components/cy/scene-roam-task-list',
  'components/cy/scene-roam-stamp-album',
  'components/cy/scene-game-coupon-wallet',
]

function pressAbility(base, wxmlSrc) {
  const wxml = wxmlSrc === undefined ? read(base + '/index.wxml') : wxmlSrc
  const wxss = read(base + '/index.wxss')
  const classes = [...wxml.matchAll(/hover-class="([^"{}]+)"/g)].map((m) => m[1].trim())
  const dynamic = /hover-class="\{\{/.test(wxml)          // btn/cell 走 disabled 三元
  const dynamicClasses = [...wxml.matchAll(/hover-class="\{\{[^}]*'([\w-]+)'/g)].map((m) => m[1])
  const all = classes.concat(dynamicClasses)
  // 组件是 styleIsolation:isolated,全局 .cy-pressed 进不来,类必须在本组件 wxss 里定义
  const defined = all.filter((c) => new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '\\s*[,{]').test(wxss))
  return { declared: all.length > 0 || dynamic, defined: defined.length > 0, classes: all };
}

test('共享交互组件必须有按压反馈,且样式类在本组件 wxss 里真定义', () => {
  const missing = []
  INTERACTIVE.forEach((base) => {
    const r = pressAbility(base)
    if (!r.declared) missing.push(base + '(没有 hover-class)')
    else if (!r.defined) missing.push(base + '(hover-class=' + r.classes.join('/') + ' 但 wxss 里没这条规则 —— isolated 隔离下全局类进不来,等于没反馈)')
  })
  assert.deepEqual(missing, [], '这些共享组件点下去没有任何即时反馈:\n  ' + missing.join('\n  '))
})

test('negative control:任一组件摘掉 hover-class 必须判红', () => {
  const wxml = read('components/cy/tabs/index.wxml').replace(/hover-class="cy-tabs__item--press"/g, '')
  const r = pressAbility('components/cy/tabs', wxml)
  assert.equal(r.declared, false, '负控锚点失效:cy-tabs 本来就没有 hover-class')
})

test('negative control:hover-class 写了但 wxss 里没定义(isolated 下等于没反馈)必须判红', () => {
  const wxml = read('components/cy/tabs/index.wxml').replace(/cy-tabs__item--press/g, 'cy-pressed')
  const r = pressAbility('components/cy/tabs', wxml)
  assert.equal(r.declared, true)
  assert.equal(r.defined, false, '引用全局 .cy-pressed 必须被判成「没定义」—— 组件是 isolated,那个类进不来')
})
