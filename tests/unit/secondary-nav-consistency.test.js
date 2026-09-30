// H10:订单详情正文与逻辑已搬到 components/cy/scene-member-order-detail(页面退化成深链薄壳),
// 断言随之指向组件文件;判据本身一条没放宽。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function assertPlainNav(source, label) {
  assert.match(source, /<cy-nav-bar[^>]*\/>|<cy-nav-bar[^>]*>/, `${label} must render cy-nav`)
  assert.doesNotMatch(source, /<cy-nav-bar[^>]*\bpill(?:\s|=|\/)/, `${label} must not use a pill on a non-hero state`)
}

test('non-hero secondary pages use one shared plain-arrow navigation shape', () => {
  const templateDetail = read('pages/templatedetail/templatedetail.wxml')
  assert.match(templateDetail, /<cy-nav-bar[^>]*pill="\{\{!!coverUrl\}\}"[^>]*custom-back[^>]*bind:back="goBack"/)
  assertPlainNav(read('subpackageA/pages/assetcenter/income-detail/income-detail.wxml'), 'income detail')

  // 2026-09-11 用户裁决「不是 canon 了 用原型的」:集邮相机整屏换成原型 camPanel 那张取景卡,
  // 原型这一屏没有导航条,退出就是卡左上角那枚 ✕(坐标与卡同一组变量,不是另画一枚胶囊)。
  const camera = read('subpackageP3/pages/stamp-camera/index/index.wxml')
  assert.doesNotMatch(camera, /<cy-nav-bar/, '取景卡这一屏不挂导航条')
  assert.doesNotMatch(camera, /class="sc-back"/, 'camera must not draw a separate return pill')
  assert.match(camera, /class="sc-x"[\s\S]{0,200}?bindtap="onBack"/, '退出走卡左上那枚 ✕')
  assert.match(camera, /class="sc-x"[\s\S]*?style="left:\{\{backL\}\}px;top:\{\{backT\}\}px;"/,
    '✕ 的坐标必须来自 layout.js,跟着卡走')

  // 2026-09-01 用户拍板:订单返回不要圆钮。hero 仍 overlay 透出封面,返回只留素箭头。
  assert.match(
    read('subpackageMember/orderinfo/orderinfo.wxml'),
    /<cy-nav-bar[^>]*\boverlay\b/,
    'orderinfo 沉浸 hero 必须保留 overlay 导航',
  )
  assert.doesNotMatch(
    read('subpackageMember/orderinfo/orderinfo.wxml'),
    /<cy-nav-bar[^>]*\bpill(?:\s|=|\/)/,
    'orderinfo 返回不得再用圆形 pill',
  )
  assertPlainNav(read('subpackageMember/order/order.wxml'), 'order list')
  assertPlainNav(read('pages/merchant/decor/index.wxml'), 'merchant decor')

  assertTitleBelowBack(read('subpackageMember/mycanyu/mycanyu.wxml'), '我的参与', 'canyu-nav-spacer', 'my join')
  assert.match(read('subpackageMember/mycanyu/mycanyu.wxml'), /<cy-nav-bar[^>]*custom-back[^>]*bind:back="onBack"/)
  assert.match(read('subpackageMember/mycanyu/mycanyu.json'), /"navigationStyle"\s*:\s*"custom"/)
  assert.match(read('subpackageMember/mycanyu/mycanyu.js'), /switchTab\(\{ url: '\/pages\/member\/index\/index' \}\)/)

  const groupCode = read('pages/club/group-code/index.wxml')
  assertBackOutsideCondition(groupCode, "wx:if=\"{{state === 'selecting' || state === 'empty'}}\"", 'group code')
  assertTitleBelowBack(groupCode, '选择场次', 'session-picker__nav-spacer', 'group code')
})

// 2026-07-29 规整:返回钮不能锁在某个状态的 wx:if 容器里 —— group-code 的出码态
// (cy-qr-voucher)以前整页没有退出口。判据是「nav 出现在该条件容器之前」,
// 不是「页面里存在一个 nav」(后者在返回钮被塞进条件容器时同样为真,是恒真断言)。
function assertBackOutsideCondition(source, conditionSnippet, label) {
  assert.match(source, /<cy-nav-bar[^>]*custom-back[^>]*bind:back="onClose"/, `${label} 必须有返回钮`)
  const cond = source.indexOf(conditionSnippet)
  assert.notEqual(cond, -1, `${label} 的条件容器锚点失效(源码已改动?)`)
  assert.ok(
    source.indexOf('<cy-nav-bar') < cond,
    `${label} 的返回钮必须排在条件容器之前,否则该条件不成立时整页退不出去`,
  )
}

// Revolut 式:导航条只放返回钮,标题落在返回钮**下方**的大标题里。
// 判据不是「有个标题」,而是「标题不在导航条上 + 让位块把它压到导航之下」。
function assertTitleBelowBack(source, title, spacerClass, label) {
  const navTag = source.match(/<cy-nav-bar[\s\S]*?(?:\/>|>)/)
  assert.ok(navTag, `${label} must render cy-nav`)
  assert.doesNotMatch(navTag[0], /\stitle="[^"]+"/, `${label} 的标题必须下沉为大标题,不能还挂在导航条上(否则双标题)`)
  const spacer = new RegExp(`class="${spacerClass}" style="height: \\{\\{statusBarHeight \\+ navBarHeight\\}\\}px;"`)
  assert.match(source, spacer, `${label} 缺少导航让位块,大标题会压在固定导航下`)
  const titleTag = source.match(/<cy-page-title[^>]*>/)
  assert.ok(titleTag, `${label} must render cy-page-title`)
  assert.match(titleTag[0], new RegExp(`title="${title}"`), `${label} 大标题文案必须稳定`)
  assert.ok(
    source.indexOf(spacerClass) < source.indexOf('<cy-page-title'),
    `${label} 的大标题必须排在让位块之后`,
  )
}

// 2026-07-29 规整:publish/simple 自带头的圆形 ‹ 与 cy-nav-bar 的返回钮完全等价(都是
// navigateBack(1)),导航统一后是冗余的第二个返回口。锁「整页只有一个可点的返回入口」。
function assertSingleBackAffordance(wxml, label) {
  assert.match(wxml, /<cy-nav-bar[\s\S]*?(?:\/>|>)/, `${label} 必须有 cy-nav-bar`)
  const extraBacks = wxml.match(/aria-label="返回"/g) || []
  assert.deepEqual(extraBacks, [], `${label} 除 cy-nav-bar 外不得再画返回钮(${extraBacks.length} 处),返回入口只能有一个`)
}

test('publish/simple 的返回入口只有 cy-nav-bar 一个', () => {
  assertSingleBackAffordance(read('pages/publish/simple/index.wxml'), 'publish simple')
})

test('negative control: publish/simple 自带圆形返回钮回潮必须判红', () => {
  const source = read('pages/publish/simple/index.wxml')
  const mutated = source.replace(
    '    <view class="simple-ai__nav-copy">',
    '    <view class="simple-ai__back" bindtap="onAiBack" aria-label="返回">‹</view>\n    <view class="simple-ai__nav-copy">',
  )
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSingleBackAffordance(mutated, 'publish simple'), assert.AssertionError)
})

test('negative control: a non-hero page reintroducing a pill is rejected', () => {
  // 2026-09-17 B-06 后原锚点页(pricing/partner)退役,换同形素箭头页作负控标本。
  const source = read('pages/merchant/decor/index.wxml')
  const navTag = source.match(/<cy-nav-bar[^>]*\/>/)
  assert.ok(navTag, 'merchant decor must render cy-nav')
  const mutated = source.replace(navTag[0], navTag[0].replace('<cy-nav-bar', '<cy-nav-bar pill'))
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertPlainNav(mutated, 'merchant decor'))
})

test('negative control: orderinfo 圆形返回钮回潮必须判红', () => {
  const source = read('subpackageMember/orderinfo/orderinfo.wxml')
  const navTag = source.match(/<cy-nav-bar\b[^>]*\/>/)
  assert.ok(navTag, '找不到 cy-nav-bar 标签(源码已改动?)')
  const mutated = source.replace(navTag[0], '<cy-nav-bar overlay pill tint="dark" custom-back bind:back="backToOrderList" />')
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => {
    assert.doesNotMatch(
      mutated,
      /<cy-nav-bar[^>]*\bpill(?:\s|=|\/)/,
      'orderinfo 返回不得再用圆形 pill',
    )
  }, assert.AssertionError)
})

test('negative control: 把标题挂回导航条(双标题)必须判红', () => {
  const source = read('subpackageMember/mycanyu/mycanyu.wxml')
  const mutated = source.replace('<cy-nav-bar custom-back', '<cy-nav-bar title="我的参与" custom-back')
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertTitleBelowBack(mutated, '我的参与', 'canyu-nav-spacer', 'my join'), assert.AssertionError)
})

test('negative control: 删掉导航让位块(大标题压在固定导航下)必须判红', () => {
  const source = read('subpackageMember/mycanyu/mycanyu.wxml')
  const mutated = source.replace(/<view class="canyu-nav-spacer"[^>]*><\/view>\n/, '')
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertTitleBelowBack(mutated, '我的参与', 'canyu-nav-spacer', 'my join'), assert.AssertionError)
})

test('negative control: group-code 返回钮塞回 selecting 条件容器必须判红', () => {
  const source = read('pages/club/group-code/index.wxml')
  const mutated = source
    .replace('<cy-nav-bar custom-back bind:back="onClose" />\n', '')
    .replace('<view class="session-picker__nav-spacer"', '<cy-nav-bar custom-back bind:back="onClose" />\n  <view class="session-picker__nav-spacer"')
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(
    () => assertBackOutsideCondition(mutated, "wx:if=\"{{state === 'selecting' || state === 'empty'}}\"", 'group code'),
    assert.AssertionError,
  )
})
