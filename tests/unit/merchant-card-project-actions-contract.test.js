'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少 ${selector}`)
  return match[1]
}

function assertContract(overrides = {}) {
  const source = (file) => overrides[file] === undefined ? read(file) : overrides[file]
  const cardWxml = source('components/cy/merchant-card/index.wxml')
  const cardWxss = source('components/cy/merchant-card/index.wxss')
  assert.match(cardWxml, /class="mc__service"[^>]*aria-role="button"[^>]*aria-label=/)
  assert.match(cardWxml, /class="mc__action"[^>]*aria-role="button"[^>]*aria-label=/)
  assert.match(rule(cardWxss, '.mc__service'), /min-height:\s*var\(--cy-btn-h\)/)
  assert.match(rule(cardWxss, '.mc__action'), /height:\s*var\(--cy-btn-h\)/)

  const projectWxml = source('subpackageA/pages/myproject/index.wxml')
  const projectWxss = source('subpackageA/pages/myproject/index.wxss')
  /* 2026-09-08 稿 260:277 的裁决把主题卡上那三个动作(候选池 / 上下架 / 删除)赶出了卡面,
     它们搬进「长按卡片」打开的操作面板。所以 .mp-op 只剩模板 tab 那两个,
     新的三行按 .mp-ops-row 计 —— 动作总数没变,热区与可读名称的要求也没变。 */
  const actions = [...projectWxml.matchAll(/<view\b[^>]*class="mp-op(?:\s[^"\n]*)?"[^>]*>/g)].map((match) => match[0])
  assert.equal(actions.length, 2, '模板管理应保留两个文字动作(上下架 / 删除)')
  for (const action of actions) {
    assert.match(action, /aria-role="button"/)
    assert.match(action, /aria-label=/)
  }
  assert.match(rule(projectWxss, '.mp-op'), /min-height:\s*var\(--cy-btn-h\)/)
  assert.match(rule(projectWxss, '.mp-op'), /display:\s*inline-flex/)

  // 卡面不许再长回按钮:三个动作只能从长按面板走
  assert.doesNotMatch(projectWxml, /catchtap="(goCandidates|toggleStatus|deleteItem)"/,
    '候选池 / 上下架 / 删除不能回到卡面上')
  assert.match(projectWxml, /bindlongpress="onCardLong"/, '长按是这三个动作唯一的入口,不能丢')
  const sheetRows = [...projectWxml.matchAll(/<view\b[^>]*class="mp-ops-row(?:\s[^"\n]*)?"[^>]*>/g)].map((m) => m[0])
  assert.equal(sheetRows.length, 5, '操作面板应有候选池 / 编辑 / 上下架 / 取消 / 删除')
  for (const row of sheetRows) assert.match(row, /bindtap="onOpsPick"/)
  assert.match(rule(projectWxss, '.mp-ops-row'), /min-height:\s*var\(--cy-btn-h\)/)
}

test('商家卡与我的项目管理动作具有 44px 热区和按钮语义', () => {
  assertContract()
})

test('负控：商家服务入口移除最小高度会判红', () => {
  const file = 'components/cy/merchant-card/index.wxss'
  const broken = read(file).replace('  min-height: var(--cy-btn-h);\n', '')
  assert.throws(() => assertContract({ [file]: broken }), /min-height/)
})

test('负控：项目删除动作移除可读名称会判红', () => {
  const file = 'subpackageA/pages/myproject/index.wxml'
  // 现在第一处 aria-label="删除{{item.title}}" 是模板 tab 的删除动作
  const broken = read(file).replace(' aria-role="button" aria-label="删除{{item.title}}"', '')
  assert.throws(() => assertContract({ [file]: broken }), /aria-role/)
})
