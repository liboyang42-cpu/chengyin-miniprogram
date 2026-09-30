'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_PATH = path.join(ROOT, 'subpackageP3/pages/badge-3d/index.js')
const WXML_PATH = path.join(ROOT, 'subpackageP3/pages/badge-3d/index.wxml')
const COMPONENT_PATH = path.join(ROOT, 'subpackageP3/components/xr-badge/index.js')
const ENGINE_PATH = path.join(ROOT, 'subpackageP3/pages/badge-wall/index/engine.js')
const DEMO = '/subpackageP3/assets/badge-demo.png'

function loadPage() {
  let definition
  global.Page = (config) => { definition = config }
  global.wx = {
    getMenuButtonBoundingClientRect: () => ({ top: 52 }),
    createSelectorQuery: () => {
      const query = {
        in() { return query },
        select() { return query },
        fields() { return query },
        exec(callback) { callback([]) },
      }
      return query
    },
  }
  delete require.cache[require.resolve(PAGE_PATH)]
  require(PAGE_PATH)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.assign(this.data, patch)
      if (done) done.call(this)
    },
  })
  return page
}

test('3D 徽章先显示真实静态预览，贴图 ready 后才切换到可旋转状态', () => {
  const page = loadPage()
  const actual = 'https://cdn.example.com/badges/city.png'
  page.onLoad({ img: encodeURIComponent(actual), name: encodeURIComponent('城市提案'), style: 'enamel' })
  assert.equal(page.data.src, actual)
  assert.equal(page.data.fallbackSrc, actual)
  assert.equal(page.data.renderState, 'loading')

  page.onXrReady()
  assert.equal(page.data.renderState, 'loading', '只有 WebGL ready 还不代表贴图已显示')
  page.onLoaded()
  assert.equal(page.data.renderState, 'ready')
  assert.equal(page.data.unsupported, false)
})

test('渲染器不支持时保留真实徽章图；贴图本身失败时退到正式 demo 素材', () => {
  const page = loadPage()
  const actual = 'https://cdn.example.com/badges/city.png'
  page.onLoad({ img: encodeURIComponent(actual), style: 'enamel' })
  page.onUnsupported({ detail: { reason: 'renderer' } })
  assert.equal(page.data.renderState, 'fallback')
  assert.equal(page.data.fallbackSrc, actual)

  page.setData({ unsupported: false, renderState: 'loading', fallbackSrc: actual })
  page.onUnsupported({ detail: { reason: 'asset' } })
  assert.equal(page.data.renderState, 'fallback')
  assert.equal(page.data.fallbackSrc, DEMO)
})

test('glow canvas 获取失败与坏 URL 编码都可恢复，不留黑屏或页面崩溃', () => {
  const page = loadPage()
  assert.doesNotThrow(() => page.onLoad({ name: '%E0%A4%A', img: '%E0%A4%A', style: 'glow' }))
  assert.equal(page.data.name, '徽章')
  assert.equal(page.data.src, DEMO)
  page._initGlow()
  assert.equal(page.data.unsupported, true)
  assert.equal(page.data.renderState, 'fallback')
  page.onUnload()
})

test('模板以真实素材承接 loading/fallback，3D 与 glow 均只在 ready 后显现', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  assert.match(wxml, /<image\b[^>]*wx:if="\{\{renderState !== 'ready'\}\}"[^>]*src="\{\{fallbackSrc\}\}"/s)
  assert.match(wxml, /<xr-badge\b[^>]*class="b3__xr \{\{renderState === 'ready' \? '' : 'b3__xr--loading'\}\}"/s)
  assert.match(wxml, /<canvas\b[^>]*wx:elif="\{\{!unsupported\}\}"[^>]*class="b3__xr \{\{renderState === 'ready' \? '' : 'b3__xr--loading'\}\}"/s)
  assert.doesNotMatch(wxml, /trophy\.png/)

  const component = fs.readFileSync(COMPONENT_PATH, 'utf8')
  assert.match(component, /img\.onerror\s*=\s*\(\)\s*=>\s*\{[^}]*triggerEvent\('unsupported',\s*\{\s*reason:\s*'asset'\s*\}\)/s)
})

test('3D 徽章把系统减少动态偏好传给 WebGL 转台，自动旋转不得绕过偏好', () => {
  const pageSource = fs.readFileSync(PAGE_PATH, 'utf8')
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  assert.match(pageSource, /require\('\.\.\/\.\.\/\.\.\/utils\/motion-preference\.js'\)/)
  assert.match(pageSource, /reducedMotion:\s*readReducedMotion\(\)/)
  assert.match(pageSource, /onShow\(\)[\s\S]*readReducedMotion\(\)[\s\S]*setData\(\{ reducedMotion/)
  assert.match(wxml, /<xr-badge\b[^>]*reduced="\{\{reducedMotion\}\}"/s)
})

test('glow 徽章减少动态时只渲染稳定帧，不启动持续 RAF', () => {
  const pageSource = fs.readFileSync(PAGE_PATH, 'utf8')
  const engineSource = fs.readFileSync(ENGINE_PATH, 'utf8')
  assert.match(engineSource, /function renderStatic\(\)\s*\{[\s\S]*render\(now\)/,
    '波点引擎必须提供不续订 RAF 的稳定帧入口')
  assert.match(engineSource, /renderStatic:\s*function\s*\(\)\s*\{\s*renderStatic\(\);\s*\}/,
    '稳定帧入口必须由页面可调用')
  assert.match(pageSource, /if \(that\.data\.reducedMotion && eng\.renderStatic\)[\s\S]*eng\.openDetail\(0\);[\s\S]*eng\.renderStatic\(\);[\s\S]*\} else \{[\s\S]*eng\.start\(\)/,
    '初始化 glow 时减少动态不得调用 start')
  assert.match(pageSource, /onShow\(\)[\s\S]*if \(reducedMotion\)[\s\S]*\.stop\(\)[\s\S]*\.renderStatic\(\)[\s\S]*else[\s\S]*\.start\(\)/,
    '系统偏好变化后也必须在静态帧与持续动画之间正确切换')
})

test('负控：静态预览退回无关奖杯图时素材契约必须判红', () => {
  const source = fs.readFileSync(WXML_PATH, 'utf8')
  const mutated = source.replace('src="{{fallbackSrc}}"', 'src="/images/play/trophy.png"')
  assert.notEqual(mutated, source, '负控锚点失效：未找到 fallbackSrc')
  assert.throws(
    () => assert.match(mutated, /<image\b[^>]*src="\{\{fallbackSrc\}\}"/s),
    assert.AssertionError,
  )
})
