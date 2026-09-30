const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE = path.resolve(__dirname, '../../pages/activity/baoming/baoming')
const read = extension => fs.readFileSync(PAGE + extension, 'utf8')

function assertRealPosterContract(wxml) {
  assert.match(wxml, /module="img"/)
  assert.match(
    wxml,
    /src="\{\{img\.first\(activityInfo\.imgUrl\) \|\| img\.first\(activityInfo\.imgArr\)\}\}"/,
    '结算页必须使用活动详情返回的真实主图或图集首图',
  )
  assert.doesNotMatch(
    wxml,
    /activityInfo\.imgUrl \|\| '\/images\/route_city_cover\.png'/,
    '活动海报缺失时不得用路线票券占位图冒充真实海报',
  )
}

function assertNativeCheckedContract(wxml, wxss) {
  assert.match(
    wxml,
    /<icon[^>]*wx:if="\{\{hostShareChecked\}\}"[^>]*class="bmbottom_box_gx"[^>]*type="success"[^>]*size="20"[^>]*\/>/,
    '选中态必须由微信原生 icon 组件的默认 success 状态呈现',
  )
  assert.match(wxml, /<icon[^>]*wx:else[^>]*type="circle"[^>]*color="var\(--cy-color-text-tertiary\)"/)
  const successIcon = /<icon[^>]*wx:if="\{\{hostShareChecked\}\}"[^>]*type="success"[^>]*\/>/.exec(wxml)
  assert.ok(successIcon)
  assert.doesNotMatch(successIcon[0], /color=/, '选中态不得覆盖微信 success 图标的原生配色')
  assert.doesNotMatch(wxml, /<cy-icon[^>]*wx:if="\{\{hostShareChecked\}\}"[^>]*name="check"/)
  assert.doesNotMatch(wxml, /<checkbox/)
  assert.doesNotMatch(wxml, /bmbottom_box_gx \{\{hostShareChecked/)
  assert.doesNotMatch(wxss, /\.bmbottom_box_gx\.is-on/)
  assert.doesNotMatch(wxss, /@keyframes consent-check-pop/)
  assert.doesNotMatch(wxss, /\.bmbottom_box_gx::(before|after)/)
  const nativeIconBacking = /\.bmbottom_box_gx\s*\{([\s\S]*?)\}/.exec(wxss)
  assert.ok(nativeIconBacking)
  assert.match(nativeIconBacking[1], /background:\s*var\(--cy-comp-success-mark-fg\)/)
  assert.match(nativeIconBacking[1], /border-radius:\s*50%/)
}

test('报名结算页使用真实活动海报，不再展示路线票券占位图', () => {
  assertRealPosterContract(read('.wxml'))
})

test('negative control: 路线票券占位图回潮时海报契约必须判红', () => {
  const broken = read('.wxml').replace(
    /img\.first\(activityInfo\.imgUrl\) \|\| img\.first\(activityInfo\.imgArr\)/g,
    "activityInfo.imgUrl || '/images/route_city_cover.png'",
  )
  assert.throws(() => assertRealPosterContract(broken), assert.AssertionError)
})

test('报名结算页使用微信原生 icon 的 success 状态，不自行绘制对勾', () => {
  assertNativeCheckedContract(read('.wxml'), read('.wxss'))
})

test('negative control: 把原生 icon 改回 view 时视觉契约必须判红', () => {
  const broken = read('.wxml').replace('<icon ', '<view ')
  assert.throws(
    () => assertNativeCheckedContract(broken, read('.wxss')),
    assert.AssertionError,
  )
})
