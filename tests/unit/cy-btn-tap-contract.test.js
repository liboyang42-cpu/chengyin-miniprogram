'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')

test('cy-btn 根节点必须接入 __onTap，disabled/loading 守卫不能成为死代码', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/btn/index.wxml'), 'utf8')
  const root = wxml.match(/^<view\b[^>]*>/)
  assert.ok(root, 'cy-btn 缺少根节点')
  assert.match(root[0], /catchtap="__onTap"/, '根节点未接 __onTap 时 disabled/loading 仍会把点击透传给页面')
})

function loadComponent(data) {
  let definition
  const source = fs.readFileSync(path.join(ROOT, 'components/cy/btn/index.js'), 'utf8')
  vm.runInNewContext(source, { Component(value) { definition = value } }, { filename: 'components/cy/btn/index.js' })
  const events = []
  const component = {
    data: { _v: 'primary', loading: false, ...(data || {}) },
    triggerEvent(name, detail, options) { events.push({ name, detail, options }) },
  }
  return { component, events, tap: definition.methods.__onTap.bind(component) }
}

test('cy-btn enabled 单发 tap 并保留 detail；disabled/loading 不得把动作透传', () => {
  const event = { detail: { source: 'cta', value: 7 }, currentTarget: { dataset: { id: '42' } } }
  const enabled = loadComponent()
  enabled.tap(event)
  assert.equal(enabled.events.length, 1)
  assert.equal(enabled.events[0].name, 'tap')
  assert.equal(enabled.events[0].detail, event.detail)
  assert.equal(enabled.events[0].options.bubbles, true)
  assert.equal(enabled.events[0].options.composed, true)

  const disabled = loadComponent({ _v: 'disabled' })
  disabled.tap(event)
  assert.deepEqual(disabled.events, [{ name: 'disabledtap', detail: event.detail, options: undefined }])

  const loading = loadComponent({ loading: true })
  loading.tap(event)
  assert.deepEqual(loading.events, [])
})

test('cy-btn 真实内根必须暴露 button 语义、可访问名称和禁用状态', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/btn/index.wxml'), 'utf8')
  const root = wxml.match(/^<view\b[^>]*>/)
  assert.match(root[0], /aria-role="button"/)
  assert.match(root[0], /aria-disabled="{{[^}]+}}"/)
  assert.match(root[0], /aria-label="{{[^}]+}}"/)
})

test('纯图标 cy-btn 必须显式声明可访问名称', () => {
  const missing = []
  const walk = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      if (entry.name === 'node_modules' || entry.name === '.git') return
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { walk(file); return }
      if (!entry.isFile() || !entry.name.endsWith('.wxml')) return
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(/<cy-btn\b([^>]*)>([\s\S]*?)<\/cy-btn>/g)) {
        const visibleText = match[2].replace(/<[^>]*>/g, '').trim()
        if (!visibleText && !/(?:aria-label|accessibility-label)\s*=/.test(match[1])) {
          missing.push(`${path.relative(ROOT, file)}:${source.slice(0, match.index).split('\n').length}`)
        }
      }
    })
  }
  walk(ROOT)
  assert.deepEqual(missing, [])
})
