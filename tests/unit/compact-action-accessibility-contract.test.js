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

  const activityWxml = source('components/cy/scene-play-activity-detail/index.wxml')
  const activityWxss = source('components/cy/scene-play-activity-detail/index.wxss')
  assert.match(activityWxml, /class="activity-person"[^>]*aria-role="button"[^>]*aria-label=/)
  assert.match(activityWxml, /class="ticket__more"[^>]*aria-role="button"[^>]*aria-expanded=/)
  assert.match(rule(activityWxss, '.activity-person'), /width:\s*var\(--cy-btn-h\)/)
  assert.match(rule(activityWxss, '.activity-person'), /height:\s*var\(--cy-btn-h\)/)
  assert.match(rule(activityWxss, '.ticket__more'), /min-height:\s*var\(--cy-btn-h\)/)
}

test('紧凑型文字/头像动作具有 44px owner 和可读状态', () => {
  assertContract()
})

test('负控：票种展开动作缩回 64rpx 会判红', () => {
  const file = 'components/cy/scene-play-activity-detail/index.wxss'
  const broken = read(file).replace(
    /(\.ticket__more\s*\{[^}]*?)min-height:\s*var\(--cy-btn-h\);/s,
    '$1min-height: 64rpx;',
  )
  assert.throws(() => assertContract({ [file]: broken }), /min-height/)
})
