'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const TARGETS = [
  'pages/activity/baoming/baoming',
  'pages/activity/official-detail/index',
  'pages/play/index',
  'pages/roam/index',
  'pages/topic/index/index',
  'pages/topic/components/project-host/index',
  'pages/topic/components/project-join/index',
  'components/cy/free-map/index',
  'subpackageMember/signup/index',
]

const PSEUDO_ICON = /[›‹×✕✓＋↗◷✦⋯→←⏳◈✎🏅▶⏸]/
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function visibleSource(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(?:\d|\}\})\s*×\s*(?:\d|\{\{)/g, '')
}

function assertNoTextPseudoIcons(relativePath, source = read(relativePath)) {
  assert.doesNotMatch(
    visibleSource(source),
    PSEUDO_ICON,
    `${relativePath} 仍以文字字符或 emoji 充当可见图标`,
  )
}

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `${selector} 缺少样式规则`)
  return match[1]
}

test('玩家活动、游玩、漫游、话题与票夹不再用字符、emoji 或 CSS art 伪造图标', () => {
  for (const base of TARGETS) {
    const view = visibleSource(read(`${base}.wxml`))
    const config = JSON.parse(read(`${base}.json`))
    assertNoTextPseudoIcons(`${base}.wxml`)
    assert.match(view, /<cy-icon\b/, `${base}.wxml 没有接入统一真实图标`)
    assert.equal(
      config.usingComponents && config.usingComponents['cy-icon'],
      '/components/cy/icon/index',
      `${base}.json 未注册 cy-icon`,
    )
  }

  const freeMapView = visibleSource(read('components/cy/free-map/index.wxml'))
  const freeMapStyle = read('components/cy/free-map/index.wxss')
  assert.match(freeMapView, /class="fmap-exit">退出<\/cover-view>/, '地图退出必须保留清晰文字语义')
  assert.match(freeMapView, /bindtap="zoomOut"[^>]*>[\s\S]*?<cy-icon name="zoom-out"/, '缩小地图必须使用语义正确的真实图标')
  assert.doesNotMatch(freeMapView, /class="fmap-(?:locate|plus|minus)"/, '地图控制仍在用空 view 画图标')
  assert.doesNotMatch(freeMapStyle, /\.fmap-(?:locate|plus|minus)(?=[\s,{:.])/, '地图控制仍在用 CSS art 画图标')

  for (const page of ['pages/play/index', 'pages/roam/index']) {
    assert.doesNotMatch(visibleSource(read(`${page}.wxml`)), /pico--pause/, `${page}.wxml 仍以空 view 充当暂停图标`)
    assert.doesNotMatch(read(`${page}.wxss`), /\.pico--pause/, `${page}.wxss 仍以伪元素绘制暂停图标`)
  }
})

test('替换后的可交互图标保留读屏名称、状态语义与至少 88rpx 热区', () => {
  const baomingView = read('pages/activity/baoming/baoming.wxml')
  const baomingStyle = read('pages/activity/baoming/baoming.wxss')
  assert.doesNotMatch(baomingView, /team-signup|选择队伍人数/)
  assert.throws(() => cssRule(baomingStyle, '.team-signup__count'), /缺少样式规则/)

  const officialView = read('pages/activity/official-detail/index.wxml')
  const officialStyle = read('pages/activity/official-detail/index.wxss')
  assert.match(officialView, /class="od-task[^>]*aria-role="button"[^>]*aria-label=/)
  assert.match(cssRule(officialStyle, '.od-task'), /min-height:\s*(?:88|(?:9\d|1\d\d))rpx/)

  const playView = read('pages/play/index.wxml')
  const playStyle = read('pages/play/index.wxss')
  // 2026-09-10 手记照原型 journalScreen 重做成半屏:关闭钮从 .jhead-close 换成原型
  //   那枚右上角圆 ✕(.sheet__x)。断的仍是同两件事 —— 读屏器念得出来、热区够 44pt。
  assert.match(playView, /class="sheet__x"[^>]*aria-role="button"[^>]*aria-label="合上旅程手记"/)
  assert.match(cssRule(playStyle, '.sheet__x::after'), /width:\s*88rpx/)
  assert.match(cssRule(playStyle, '.ending__close'), /width:\s*88rpx[^}]*height:\s*88rpx/)

  const topicView = read('pages/topic/index/index.wxml')
  const topicStyle = read('pages/topic/index/index.wxss')
  assert.match(topicView, /class="delete-btn"[^>]*aria-role="button"[^>]*aria-label=/)
  assert.match(cssRule(topicStyle, '.delete-btn'), /width:\s*88rpx[^}]*height:\s*88rpx/)

  const hostView = read('pages/topic/components/project-host/index.wxml')
  const joinView = read('pages/topic/components/project-join/index.wxml')
  // 2026-09-06:承接方那条按稿 88:4014 挪进底栏(类名 sec rules → rules);
  // 主办方那条还在正文里(它没有对应稿,不动)。断言按各自现状分开写,不合并。
  assert.match(hostView, /class="sec rules"[^>]*aria-role="button"[^>]*aria-expanded=/)
  assert.match(joinView, /class="rules"[^>]*aria-role="button"[^>]*aria-expanded=/)

  const freeMapStyle = read('components/cy/free-map/index.wxss')
  assert.match(cssRule(freeMapStyle, '.fmap-exit-hit'), /min-width:\s*88rpx[^}]*min-height:\s*88rpx/)
  assert.match(cssRule(freeMapStyle, '.fmap-btn'), /width:\s*88rpx[^}]*height:\s*88rpx/)

  const signupView = read('subpackageMember/signup/index.wxml')
  assert.match(signupView, /<swiper-item[^>]*aria-role="button"[^>]*aria-label=/)
})

test('负控：把真实箭头恢复成文字箭头时，范围契约必须判红', () => {
  const relativePath = 'pages/topic/components/project-host/index.wxml'
  const source = read(relativePath)
  const mutated = source.replace(/<cy-icon\b[^>]*name="arrow-right"[^>]*\/>/, '<text>›</text>')
  assert.notEqual(mutated, source, '负控锚点失效：主办方组件缺少真实箭头')
  assert.throws(() => assertNoTextPseudoIcons(relativePath, mutated), /文字字符或 emoji/)
})
