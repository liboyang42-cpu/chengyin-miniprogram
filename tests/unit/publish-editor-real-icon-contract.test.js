'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function visibleSource(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\d+(?:\.\d+)?\s*×\s*\d+(?:\.\d+)?/g, '')
}

function assertSourceHasNoTextPseudoIcons(source, label) {
    source = visibleSource(source)
    assert.doesNotMatch(source, /[›‹×✕✓＋↗◷✦⋯→←]/,
      `${label} 仍以文字字符充当箭头、关闭、勾选或添加图标`)
    assert.doesNotMatch(source, />\s*\+\s*<\/(?:text|view)>/,
      `${label} 仍以 ASCII + 充当添加图标`)
}

function assertNoTextPseudoIcons(relativePaths) {
  for (const relativePath of relativePaths) {
    assertSourceHasNoTextPseudoIcons(read(relativePath), relativePath)
  }
}

function cssRule(relativePath, selector) {
  const source = read(relativePath).replace(/\/\*[\s\S]*?\*\//g, '')
  const bodies = []
  for (const match of source.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].split(',').map((item) => item.trim()).includes(selector)) bodies.push(match[2])
  }
  assert.ok(bodies.length, `${relativePath} 缺少 ${selector}`)
  return bodies.join('\n')
}

function assertRpxAtLeast(rule, property, minimum, message) {
  const match = rule.match(new RegExp(`${property}:\\s*(\\d+)rpx`))
  assert.ok(match, `${message} 必须显式声明 ${property}`)
  assert.ok(Number(match[1]) >= minimum, `${message} 的 ${property} 只有 ${match[1]}rpx`)
}

test('专业发布编辑器以真实图标表达箭头、关闭、勾选、删除与添加', () => {
  assertNoTextPseudoIcons([
    'pages/publish/fabu/index.wxml',
    'pages/publish/fabu/step3.wxml',
    'pages/publish/fabu/topic-detail-sheet.wxml',
  ])
})

test('简单发布与官方活动入口使用真实图标并注册统一图标组件', () => {
  const pages = [
    'pages/publish/simple/index',
    'pages/activity/list/index',
  ]
  assertNoTextPseudoIcons(pages.map((base) => `${base}.wxml`))
  for (const base of pages) {
    const config = JSON.parse(read(`${base}.json`))
    assert.equal(config.usingComponents && config.usingComponents['cy-icon'], '/components/cy/icon/index',
      `${base}.json 未注册 cy-icon`)
    assert.match(visibleSource(read(`${base}.wxml`)), /<cy-icon\b/,
      `${base}.wxml 没有使用统一图标组件`)
  }
})

test('本批次新增与替换的可点图标具备可读名称和 88rpx 命中区', () => {
  const fabuWxml = visibleSource(read('pages/publish/fabu/index.wxml'))
  const topicWxml = visibleSource(read('pages/publish/fabu/topic-detail-sheet.wxml'))
  const simpleWxml = visibleSource(read('pages/publish/simple/index.wxml'))
  const activityWxml = visibleSource(read('pages/activity/list/index.wxml'))

  for (const marker of [
    /class="slopes-node-photo"[\s\S]{0,240}aria-role="button"[\s\S]{0,120}aria-label=/,
    /class="slopes-node-more"[\s\S]{0,240}aria-role="button"[\s\S]{0,120}aria-label=/,
    /class="pc-item pc-item-blocking"[\s\S]{0,240}aria-role="button"[\s\S]{0,120}aria-label=/,
    /class="pc-item pc-item-advisory"[\s\S]{0,240}aria-role="button"[\s\S]{0,120}aria-label=/,
  ]) assert.match(fabuWxml, marker, `专业编辑器缺少可点图标语义：${marker}`)
  assert.match(topicWxml, /class="pd-gdel"[\s\S]{0,180}aria-role="button"[\s\S]{0,120}aria-label=/)
  assert.match(simpleWxml, /class="simple-ai__chip"[\s\S]{0,220}aria-role="button"[\s\S]{0,120}aria-label=/)
  assert.match(simpleWxml, /class="simple-ai__send[^\"]*"[\s\S]{0,220}aria-role="button"[\s\S]{0,120}aria-label=/)
  assert.match(activityWxml, /class="oe-inbox-link"[\s\S]{0,180}aria-role="button"[\s\S]{0,120}aria-label=/)
  // 2026-09-03:.op-chk 是「发起官方活动」面板里的通知对象复选,面板整块删了 ——
  //   这条断言的锚点不存在了,留着会因为 match 找不到而恒红。同页仍在的可点图标
  //   (oe-inbox-link)由上一行盯着,语义保护没有缺口。
  assert.doesNotMatch(activityWxml, /class="op-chk/, '发布面板不许复活')

  const fabuCss = 'pages/publish/fabu/index.wxss'
  for (const selector of ['.slopes-node-more', '.pd-gdel']) {
    const rule = cssRule(fabuCss, selector)
    assertRpxAtLeast(rule, 'width', 88, selector)
    assertRpxAtLeast(rule, 'height', 88, selector)
  }
  for (const selector of ['.slopes-chapter-hd', '.slopes-add-chapter', '.pc-item']) {
    assertRpxAtLeast(cssRule(fabuCss, selector), 'min-height', 88, selector)
  }

  const simpleCss = 'pages/publish/simple/index.wxss'
  for (const selector of ['.simple-ai__chip', '.simple-ai__poi']) {
    assertRpxAtLeast(cssRule(simpleCss, selector), 'min-height', 88, selector)
  }
  const sendRule = cssRule(simpleCss, '.simple-ai__send')
  assertRpxAtLeast(sendRule, 'min-width', 88, '.simple-ai__send')
  assertRpxAtLeast(sendRule, 'height', 88, '.simple-ai__send')

  const activityCss = 'pages/activity/list/index.wxss'
  const inboxRule = cssRule(activityCss, '.oe-inbox-link')
  assertRpxAtLeast(inboxRule, 'min-width', 88, '.oe-inbox-link')
  assertRpxAtLeast(inboxRule, 'min-height', 88, '.oe-inbox-link')
  // 2026-09-03:.op-chk 随「发起官方活动」面板一起删了,热区断言没有锚点了(见上面那条 doesNotMatch)。
})

test('负控：把真实箭头退回文字 chevron 时图标契约必须判红', () => {
  const source = read('pages/publish/simple/index.wxml')
  const mutated = source.replace('<cy-icon name="arrow-right" size="28" />', '<text>›</text>')
  assert.notEqual(mutated, source, '变异锚点失效，未能替换简单发布页真实箭头')
  assert.throws(
    () => assertSourceHasNoTextPseudoIcons(mutated, 'mutated simple editor'),
    /仍以文字字符充当/,
  )
  assert.doesNotThrow(
    () => assertSourceHasNoTextPseudoIcons('<text>画面比例 3 × 4</text>', 'numeric multiplication'),
    '数值乘号是正文，不得被字符伪图标契约误杀',
  )
})
