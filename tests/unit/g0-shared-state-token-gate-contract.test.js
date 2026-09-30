'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function loadComponent(relativePath) {
  const filename = path.join(ROOT, relativePath)
  let definition
  vm.runInNewContext(read(relativePath), {
    Component(value) { definition = value },
  }, { filename })
  assert.ok(definition, `${relativePath} 必须注册 Component`)
  return definition
}

function createInstance(definition, properties = {}) {
  const defaults = {}
  Object.entries(definition.properties || {}).forEach(([key, config]) => {
    defaults[key] = config.value
  })
  const instance = {
    data: Object.assign({}, definition.data || {}, defaults, properties),
    events: [],
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name) { this.events.push(name) },
  }
  Object.assign(instance, definition.methods || {})
  return instance
}

test('cy-empty 的每个公开 kind 只传 kind 也有图形或加载指示', () => {
  const definition = loadComponent('components/cy/empty/index.js')
  const observer = definition.observers['kind, icon, title, sub']
  const kinds = [
    'empty', 'success', 'offline', 'network', 'error', 'data',
    'no-permission', 'permission', 'forbidden', 'not-started',
    'missing-param', 'not-found', 'stale', 'loading',
  ]

  kinds.forEach((kind) => {
    const instance = createInstance(definition, { kind })
    observer.call(instance, kind, '', '', '')
    assert.ok(instance.data._icon || instance.data._glyph || instance.data._loading,
      `kind=${kind} 只传 kind 时必须有可见图形或加载指示`)
  })

  const legacy = createInstance(definition, { kind: 'unknown-kind' })
  observer.call(legacy, 'unknown-kind', '', '', '')
  assert.deepEqual(
    [legacy.data._icon, legacy.data._glyph, legacy.data._loading],
    ['', '', false],
    '未知 kind 继续走旧版中性回退，不能猜测状态',
  )
})

test('cy-error 冻结整页错误双出口 API，局部错误仍可不传 secondary', () => {
  const definition = loadComponent('components/cy/error/index.js')
  assert.equal(definition.properties.secondary.value, '')
  const instance = createInstance(definition, { retry: '重试', secondary: '返回' })
  instance.onRetry()
  instance.onSecondary()
  assert.deepEqual(instance.events, ['retry', 'secondary'])

  const wxml = read('components/cy/error/index.wxml')
  assert.match(wxml, /wx:if="\{\{secondary\}\}"/)
  assert.match(wxml, /bindtap="onSecondary"/)
  assert.match(wxml, /aria-label="\{\{secondary\}\}"/)

  const stateShell = read('components/cy/state-shell/index.wxml')
  assert.match(stateShell, /<cy-error[\s\S]*?secondary="\{\{secondary\}\}"[\s\S]*?bind:secondary="onSecondary"/)
  assert.match(stateShell, /wx:if="\{\{_renderer !== 'error' && secondary\}\}"/,
    'state-shell 的 error 分支不能在组件内外重复渲染第二出口')

  const docs = read('components/cy/error/README.md')
  assert.match(docs, /整页阻断态/)
  assert.match(docs, /局部错误态/)
  assert.match(docs, /bind:secondary/)
})

test('token 真源补齐 8 个未定义名字并冻结语义映射', () => {
  const tokens = read('style/tokens.wxss')
  const expected = new Map([
    ['--cy-opacity-disabled', '0.4'],
    ['--cy-font-micro', 'var(--cy-type-micro)'],
    ['--cy-text-tertiary', 'var(--cy-color-text-tertiary)'],
    ['--cy-text-sub', 'var(--cy-color-text-secondary)'],
    ['--cy-border', 'var(--cy-color-border-subtle)'],
    ['--cy-color-border-default', 'var(--cy-color-border-strong)'],
    ['--cy-surface', 'var(--cy-color-bg-surface)'],
    ['--cy-text-muted', 'var(--cy-color-text-tertiary)'],
  ])
  expected.forEach((value, name) => {
    assert.match(tokens, new RegExp(`${escapeRegExp(name)}\\s*:\\s*${escapeRegExp(value)}\\s*;`),
      `${name} 必须映射到 ${value}`)
  })

  const mapping = read('style/TOKEN-MAPPING.md')
  ;['正文', '标签', '展示数字', 'glyph', 'Figma 特批', 'card padding', 'gap']
    .forEach((term) => assert.match(mapping, new RegExp(term)))
})

test('状态可见性门禁同时拦裸错误文案与空白错误分支', () => {
  const { analyzeWxml } = require('../../scripts/state-visibility-gate')
  const broken = `
    <block wx:if="{{state === 'ready'}}"><view>{{title}}</view></block>
    <block wx:elif="{{state === 'error'}}"></block>
    <view wx:if="{{submitError}}">{{submitError}}</view>
  `
  assert.deepEqual(
    analyzeWxml(broken, 'pages/demo/index.wxml').map((issue) => issue.rule).sort(),
    ['BLANK_STATE_BRANCH', 'RAW_ERROR_TEXT'],
  )

  const repaired = `
    <block wx:if="{{state === 'ready'}}"><view>{{title}}</view></block>
    <cy-error wx:elif="{{state === 'error'}}" sub="{{submitError}}"
      retry="重试" bind:retry="reload" />
  `
  assert.deepEqual(analyzeWxml(repaired, 'pages/demo/index.wxml'), [])
})
