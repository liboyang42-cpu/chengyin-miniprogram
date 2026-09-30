const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const XCX_ROOT = path.resolve(__dirname, '../..')
const roamWxml = fs.readFileSync(path.join(XCX_ROOT, 'pages/roam/index.wxml'), 'utf8')
const roamWxss = fs.readFileSync(path.join(XCX_ROOT, 'pages/roam/index.wxss'), 'utf8')
const hitboxVerifier = fs.readFileSync(path.join(XCX_ROOT, 'scripts/verify-roam-go-hitbox.js'), 'utf8')

function rule(source, selector) {
  const start = source.indexOf(selector + '{')
  assert.notEqual(start, -1, `找不到 ${selector} 样式规则`)
  const bodyStart = start + selector.length + 1
  const end = source.indexOf('}', bodyStart)
  assert.notEqual(end, -1, `${selector} 样式规则未闭合`)
  return source.slice(bodyStart, end)
}

function compact(value) {
  return value.replace(/\s+/g, '')
}

function mapContinuesBehindGo(source) {
  const stage = rule(source, '.intro-stage')
  const goWrap = rule(source, '.go-wrap')
  return compact(stage).includes('margin-bottom:0;')
    && compact(goWrap).includes('position:absolute;')
    && compact(goWrap).includes('z-index:20;')
}

function mapStartsBehindPagination(source) {
  const stage = compact(rule(source, '.intro-stage'))
  const dots = compact(rule(source, '.intro-dots'))
  return stage.includes('margin:calc(-1*var(--cy-space-5))calc(-1*var(--cy-page-x))0;')
    && dots.includes('position:relative;')
    && dots.includes('z-index:3;')
}

function mapLeavesButtonsTappable(wxml, source) {
  const map = compact(rule(source, '.intro-map__el'))
  return /<free-map class="intro-map__el"[\s\S]*?interactive="\{\{false\}\}"[\s\S]*?\/>/.test(wxml)
    && map.includes('pointer-events:none;')
    && /class="go-side" bindtap="openRoamRules"[\s\S]*?class="go-btn" bindtap="goStart"[\s\S]*?class="go-side" bindtap="goStartAndShoot"/.test(wxml)
}

function mapEdgesBlendIntoPage(wxml, source) {
  if (!/<free-map class="intro-map__el"[\s\S]*?<view class="intro-stage__shade"><\/view>/.test(wxml)) return false
  const shade = compact(rule(source, '.intro-stage__shade'))
  return shade.includes('inset:-2rpx00;')
    && shade.includes('pointer-events:none;')
    && shade.includes('linear-gradient(180deg,var(--cy-color-bg-page)0%,rgba(0,0,0,.94)8%,rgba(0,0,0,.62)24%,rgba(0,0,0,.32)46%,rgba(0,0,0,.36)68%,rgba(0,0,0,.78)88%,var(--cy-color-bg-page)100%)')
    && shade.includes('linear-gradient(90deg,rgba(0,0,0,.78)0%,rgba(0,0,0,.34)16%,rgba(0,0,0,.10)38%,rgba(0,0,0,.10)62%,rgba(0,0,0,.34)84%,rgba(0,0,0,.78)100%)')
    && !shade.includes('radial-gradient(')
    && !shade.includes('rgba(0,0,0,0)')
}

function controlsFloatAsOneCanvas(source) {
  const side = compact(rule(source, '.go-side'))
  const sideIcon = compact(rule(source, '.go-side__icon'))
  const main = compact(rule(source, '.go-btn'))
  return side.includes('background:rgba(255,255,255,.88);')
    && side.includes('color:var(--cy-color-play-ink);')
    && sideIcon.includes('color:var(--cy-color-play-ink);')
    && main.includes('background:var(--cy-color-action-primary-bg);')
    && main.includes('box-shadow:020rpx70rpxrgba(255,255,255,.45);')
}

test('漫游起始页地图必须延伸到三个出发按钮背后', () => {
  assert.match(
    roamWxml,
    /class="intro-stage"[\s\S]*?<free-map class="intro-map__el"[\s\S]*?class="go-wrap"[\s\S]*?class="go-btn" bindtap="goStart"/,
    'GO 必须仍是预览地图后的真实出发入口'
  )

  assert.ok(
    mapContinuesBehindGo(roamWxss),
    'GO 三按钮必须绝对定位浮在地图上，不能用 margin-bottom 截短地图露出黑色带'
  )
})

test('漫游起始页地图必须提前进入分页点背后，不再留独立黑带', () => {
  assert.ok(
    mapStartsBehindPagination(roamWxss),
    '地图舞台应向上与分页点重叠，分页点必须保持在地图之上'
  )
})

test('负控：地图退回分页点之后时连续画布契约必须判红', () => {
  const mutated = roamWxss.replace(
    'margin:calc(-1 * var(--cy-space-5)) calc(-1 * var(--cy-page-x)) 0;',
    'margin:var(--cy-space-5) calc(-1 * var(--cy-page-x)) 0;'
  )
  assert.notEqual(mutated, roamWxss, '负控必须真的把地图推回分页点之后')
  assert.equal(mapStartsBehindPagination(mutated), false)
})

test('负控：给地图重新预留 GO 黑色带时契约必须判红', () => {
  const mutated = roamWxss.replace(
    /margin-bottom:\s*0;/,
    'margin-bottom:calc(var(--cy-tabbar-h) + 56rpx + 220rpx + var(--cy-space-2));'
  )
  assert.notEqual(mutated, roamWxss, '负控必须真的加回黑色带')
  assert.equal(mapContinuesBehindGo(mutated), false)
})

test('漫游预览地图不得吞掉 info、GO、camera 三个按钮的点击', () => {
  assert.ok(
    mapLeavesButtonsTappable(roamWxml, roamWxss),
    '预览地图必须关闭交互并禁用 pointer events，三个按钮必须保留各自真实 handler'
  )
})

test('负控：预览地图恢复 pointer events 时按钮命中契约必须判红', () => {
  const mutated = roamWxss.replace('pointer-events:none;', 'pointer-events:auto;')
  assert.notEqual(mutated, roamWxss, '负控必须真的恢复地图 pointer events')
  assert.equal(mapLeavesButtonsTappable(roamWxml, mutated), false)
})

test('漫游起始页地图必须四周渐隐并向上覆盖硬接缝', () => {
  assert.ok(
    mapEdgesBlendIntoPage(roamWxml, roamWxss),
    '地图遮罩必须用独立图层覆盖上沿、下沿和四角，并向上跨过 1px 栅格接缝'
  )
})

test('负控：退回仅顶部渐变时四周渐隐契约必须判红', () => {
  const shade = rule(roamWxss, '.intro-stage__shade')
  const mutatedShade = shade.replace(
    /,\s*(?:\/\*[\s\S]*?\*\/\s*)?linear-gradient\(90deg,[^;]+\)/,
    ''
  )
  assert.notEqual(mutatedShade, shade, '负控必须真的把四周晕影退回仅顶部渐变')
  const mutatedWxss = roamWxss.replace(shade, mutatedShade)
  assert.equal(mapEdgesBlendIntoPage(roamWxml, mutatedWxss), false)
})

test('漫游出发三按钮必须与地图形成连续画布，而不是三块黑色遮挡', () => {
  assert.ok(
    controlsFloatAsOneCanvas(roamWxss),
    '左右按钮应为近白半透明面与黑图标，主按钮应保持白色柔光'
  )
})

test('负控：左右按钮退回深色面时连续画布契约必须判红', () => {
  const mutatedWxss = roamWxss.replace('background:rgba(255,255,255,.88);', 'background:var(--cy-color-bg-elevated);')
  assert.notEqual(mutatedWxss, roamWxss, '负控必须真的把左右按钮退回深色面')
  assert.equal(controlsFloatAsOneCanvas(mutatedWxss), false)
})

test('DevTools 验证器必须实点地图上的 info、GO、camera 三个按钮', () => {
  assert.doesNotMatch(hitboxVerifier, /hitboxGap|安全间距不足/, '旧验证器仍要求按钮避开地图，与连续画布目标相反')
  assert.match(hitboxVerifier, /page\.\$\$\('\.go-side'\)/, '必须取得左右两个真实按钮')
  assert.match(hitboxVerifier, /await info\.tap\(\)/, '必须真实点击 info')
  assert.match(hitboxVerifier, /sceneCurrent[\s\S]*?roam-rules/, 'info 点击后必须回读规则场景')
  assert.match(hitboxVerifier, /await go\.tap\(\)/, '必须真实点击 GO')
  assert.match(hitboxVerifier, /await camera\.tap\(\)/, '必须真实点击 camera')
  assert.match(hitboxVerifier, /cameraCalls[\s\S]*?1/, 'camera 点击后必须回读拍照 handler 调用事实')
})
