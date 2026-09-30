const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const componentPath = path.join(ROOT, 'pages/publish/components/creation-success/index.js')
const behaviorPath = path.join(ROOT, 'behaviors/reduced-motion.js')

function loadComponentDefinition() {
  let definition = null
  global.Behavior = (config) => config
  global.Component = (config) => { definition = config }
  delete require.cache[require.resolve(componentPath)]
  delete require.cache[require.resolve(behaviorPath)]
  require(componentPath)
  delete global.Behavior
  delete global.Component
  return definition
}

function hasReducedMotionGuard(definition, wxml, wxss) {
  return Boolean(
    definition.behaviors && definition.behaviors.length === 1
    && definition.behaviors[0].properties.reducedMotion.type === Boolean
    && /_syncReducedMotionPreference/.test(definition.behaviors[0].pageLifetimes.show.toString())
    && /class="cs \{\{reducedMotion \? 'cs--reduced-motion' : ''\}\}"/.test(wxml)
    && /\.cs--reduced-motion[^{]*\{[^}]*animation:none/s.test(wxss)
  )
}

function hasOneShotStableMotion(wxss) {
  const animatedRules = (wxss.match(/\.cs__(?:halo|mark|confetti(?: \.cs__confetti-dot)?|copy|facts|actions)[^{]*\{[^}]*animation:[^}]+\}/g) || [])
    .filter(rule => /animation:\s*cs-/.test(rule))
  const keyframeEndsVisible = (name) => {
    const start = wxss.indexOf(`@keyframes ${name}`)
    if (start < 0) return false
    const next = wxss.indexOf('@keyframes ', start + 1)
    const block = wxss.slice(start, next < 0 ? wxss.length : next)
    return /100%\s*\{[^}]*opacity:\s*1/.test(block)
  }
  return animatedRules.length >= 7
    && animatedRules.every(rule => /\bboth\b/.test(rule) && !/\binfinite\b/.test(rule))
    && keyframeEndsVisible('cs-copy')
    && keyframeEndsVisible('cs-actions')
}

test('创建成功动效遵从全局减少动态效果偏好，且不移除完成后的行动出口', () => {
  const definition = loadComponentDefinition()
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/publish/components/creation-success/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/publish/components/creation-success/index.wxss'), 'utf8')

  assert.ok(hasReducedMotionGuard(definition, wxml, wxss),
    'creation-success 必须接入唯一的 reduced-motion 行为，不能自行复制一套存储读取')
  assert.match(wxml, /class="cs__primary"[^>]*bindtap="onAction"/)
})

test('负控：移除成功动效的 reduced-motion behavior 必须判红', () => {
  const definition = loadComponentDefinition()
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/publish/components/creation-success/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/publish/components/creation-success/index.wxss'), 'utf8')
  const mutated = { ...definition, behaviors: [] }

  assert.equal(hasReducedMotionGuard(mutated, wxml, wxss), false)
})

test('负控：移除成功动效的 reduced-motion WXML class 必须判红', () => {
  const definition = loadComponentDefinition()
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/publish/components/creation-success/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/publish/components/creation-success/index.wxss'), 'utf8')
  const strippedWxml = wxml.replace(" {{reducedMotion ? 'cs--reduced-motion' : ''}}", '')

  assert.notEqual(strippedWxml, wxml, '负控必须真的移除 WXML class，不能在未变异源码上假绿')
  assert.equal(hasReducedMotionGuard(definition, strippedWxml, wxss), false)
})

test('负控：移除成功动效的 reduced-motion WXSS guard 必须判红', () => {
  const definition = loadComponentDefinition()
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/publish/components/creation-success/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/publish/components/creation-success/index.wxss'), 'utf8')
  const strippedWxss = wxss.replace(/\.cs--reduced-motion[^\n]*\n/g, '')

  assert.notEqual(strippedWxss, wxss, '负控必须真的移除 WXSS guard，不能在未变异源码上假绿')
  assert.equal(hasReducedMotionGuard(definition, wxml, strippedWxss), false)
})

test('创建成功动效只播放一次，并停在正文与行动按钮可见的最终状态', () => {
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/publish/components/creation-success/index.wxss'), 'utf8')
  assert.equal(hasOneShotStableMotion(wxss), true,
    '成功动效不能无限重播或在周期末把正文/按钮再次淡出')
})

test('负控：把一次性完成动效改回 infinite 必须判红', () => {
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/publish/components/creation-success/index.wxss'), 'utf8')
  const mutated = wxss.replace(/\bboth\b/g, 'infinite')
  assert.notEqual(mutated, wxss, '负控必须真实改动 animation fill/iteration')
  assert.equal(hasOneShotStableMotion(mutated), false)
})
