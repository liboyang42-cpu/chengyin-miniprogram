'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const { DANGER_ACTIONS } = require('../../utils/danger-actions.js')

// 2026-08-27:删除确认从这一页自建的 cy-modal 换成了全站统一的 cy-danger-confirm,
// 文案搬进 utils/danger-actions.js。合同要保的事一条没变 —— 确认必须**点名**具体权益,
// 不许退回「确认删除这个常备权益?」这种泛化文案 —— 只是断言对象从 wxml 换成登记表。
function assertPerksFormAndDeleteA11y(wxml, js, actions) {
  const requiredLabels = ['权益类型', '权益名称', '权益零售价', '成本价', '可接待份数', '有效期']
  requiredLabels.forEach((label) => {
    assert.match(
      wxml,
      new RegExp(`class="dp-field-label"[^>]*>\\s*${label}`),
      `${label} 必须有持续可见的字段标签，不能只依赖 placeholder 或 aria-label`,
    )
  })

  assert.match(wxml, /<cy-danger-confirm\b[^>]*bind:confirm="confirmDelete"/s,
    '删除必须走统一的危险确认组件')
  const perk = actions['perk.delete']
  assert.ok(perk, 'perk.delete 必须登记在 utils/danger-actions.js')
  assert.match(perk.title, /\{name\}/,
    '删除确认必须明确点名将被删除的权益,不能是泛化文案')
  assert.match(perk.confirmText, /删除/,
    '危险确认动作本身必须说清是在删除')
  assert.ok(perk.consequences.some(item => item.text.includes('此操作不可撤销')),
    '不可逆动作必须写明不可撤销')
  assert.match(wxml, /class="dp-delete"[^>]*data-name="\{\{item\.name\}\}"[^>]*aria-label="删除\{\{item\.name\}\}"/s,
    '列表删除动作必须把同一个可读名称传给确认态')
  assert.match(js, /String\(e\.currentTarget\.dataset\.name \|\| '该权益'\)/,
    '打开确认态时必须冻结当前权益名称')
  assert.match(js, /\.open\('perk\.delete',\s*\{\s*name:\s*name\s*\}\)/,
    '冻结下来的名称必须真的传给确认弹窗,否则文案里的占位是空的')
}

test('常备权益字段保留可见标签，删除确认点名具体权益', () => {
  assertPerksFormAndDeleteA11y(
    read('pages/merchant/decor/perks/index.wxml'),
    read('pages/merchant/decor/perks/index.js'),
    DANGER_ACTIONS,
  )
})

test('负控：隐藏字段标签或泛化删除目标必须判红', () => {
  const source = {
    wxml: read('pages/merchant/decor/perks/index.wxml'),
    js: read('pages/merchant/decor/perks/index.js'),
    actions: DANGER_ACTIONS,
  }
  const genericActions = JSON.parse(JSON.stringify(DANGER_ACTIONS))
  genericActions['perk.delete'].title = '确认删除这个常备权益？'
  const noNamePassed = source.js.replace(/\.open\('perk\.delete', \{ name: name \}\)/, ".open('perk.delete', {})")
  const mutants = [
    ['移除可见名称标签', { ...source, wxml: source.wxml.replace(/\s*<view class="dp-field-label"[^>]*>\s*权益名称[\s\S]*?<\/view>/, '') }],
    ['删除确认退回泛化文案', { ...source, actions: genericActions }],
    ['名称没传进确认弹窗', { ...source, js: noNamePassed }],
  ]
  mutants.forEach(([name, mutant]) => {
    assert.notDeepEqual(mutant, source, `负控变异未命中：${name}`)
    assert.throws(
      () => assertPerksFormAndDeleteA11y(mutant.wxml, mutant.js, mutant.actions),
      assert.AssertionError, name,
    )
  })
})

function assertStateShellHasSingleLiveOwner(wxml) {
  const root = /<view class="state-shell[^>]*>/.exec(wxml)
  assert.ok(root, 'state-shell 必须保留单一根容器')
  assert.match(root[0], /aria-role="group"/, '状态壳只负责分组，播报语义由内部状态组件拥有')
  assert.doesNotMatch(root[0], /aria-label=/, '状态分组不能覆盖内部状态组件的可读内容')
  assert.doesNotMatch(root[0], /aria-live=/, '状态壳不能与 cy-empty / cy-error 形成嵌套 live-region')
  assert.doesNotMatch(root[0], /aria-role="(?:alert|status)"/, '状态壳不能制造第二个隐式 live-region')
  assert.match(wxml, /<cy-error\b/)
  assert.match(wxml, /<cy-empty\b/)
  assert.equal((wxml.match(/aria="\{\{aria\}\}"/g) || []).length, 2,
    '状态上下文必须交给真正拥有 live-region 的 empty / error')
}

test('cy-state-shell 只分组，live-region 由实际渲染的单个状态组件负责', () => {
  assertStateShellHasSingleLiveOwner(read('components/cy/state-shell/index.wxml'))
})

test('负控：状态壳重新声明 live-region 必须判红', () => {
  const source = read('components/cy/state-shell/index.wxml')
  const mutant = source.replace('aria-role="group"', 'aria-role="alert" aria-live="polite"')
  assert.notEqual(mutant, source, '负控变异未命中 state-shell 根语义')
  assert.throws(() => assertStateShellHasSingleLiveOwner(mutant), assert.AssertionError)
})
