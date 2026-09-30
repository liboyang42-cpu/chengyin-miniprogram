'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const files = {
  avatarWxml: 'components/cy/avatar/index.wxml',
  avatarWxss: 'components/cy/avatar/index.wxss',
  checkinWxml: 'pages/club/checkin-detail/index.wxml',
  checkinWxss: 'pages/club/checkin-detail/index.wxss',
  merchantWxml: 'pages/play/merchant/index.wxml',
  merchantWxss: 'pages/play/merchant/index.wxss',
}

function read(key, overrides) {
  return overrides[key] === undefined ? fs.readFileSync(path.join(ROOT, files[key]), 'utf8') : overrides[key]
}

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少 ${selector}`)
  return match[1]
}

function assertContract(overrides = {}) {
  const avatarWxml = read('avatarWxml', overrides)
  const avatarWxss = read('avatarWxss', overrides)
  const checkinWxml = read('checkinWxml', overrides)
  const checkinWxss = read('checkinWxss', overrides)
  const merchantWxml = read('merchantWxml', overrides)
  const merchantWxss = read('merchantWxss', overrides)

  assert.match(avatarWxml, /--av-size:\{\{_size\}\}rpx/)
  const clickable = rule(avatarWxss, '.av--clickable')
  assert.match(clickable, /min-width:\s*var\(--cy-btn-h\)/)
  assert.match(clickable, /min-height:\s*var\(--cy-btn-h\)/)
  assert.match(rule(avatarWxss, '.av__visual'), /width:\s*var\(--av-size\)/, '扩大 owner 不得放大头像视觉')

  // 2026-08-27「无头像」只准有一套长相:placeholder 档与显式传 `|| /images/d_profile.png`
  // 的调用点走同一张图。有 name 时仍优先首字母(能区分人),那一档不在此约束内。
  assert.match(avatarWxml, /wx:else class="av__img" src="\/images\/d_profile\.png"/,
    'placeholder 档必须落到全站同一张默认头像')
  assert.doesNotMatch(avatarWxml, /av__ph/,
    '线描占位已退役,不得漂回来 —— 否则「这人没头像」又有两套长相')

  // 2026-09-09 清退退款从名册行内挪到核销详情底部,44px 触控合同跟着搬过来
  assert.match(rule(checkinWxss, '.ckd-refund'), /min-height:\s*var\(--cy-btn-h\)/)
  assert.match(checkinWxml, /class="ckd-refund[^"]*"[\s\S]{0,200}aria-label="清退并退款给 \{\{detail\.displayName \|\| '该玩家'\}\}"/)

  const back = rule(merchantWxss, '.mp-back')
  assert.match(back, /width:\s*var\(--cy-btn-h\)/)
  assert.match(back, /height:\s*var\(--cy-btn-h\)/)
  for (const selector of ['.mp-empty__b', '.mp-consent>view', '.mp-sheet__minor']) {
    assert.match(rule(merchantWxss, selector), /min-height:\s*var\(--cy-btn-h\)/, `${selector} 高度不足 44px`)
  }
  for (const label of ['返回上一页', '撤回当前门店授权', '稍后再拍']) {
    assert.match(merchantWxml, new RegExp(`aria-label="${label}"`))
  }
}

test('可点击头像、俱乐部退款与游玩商家次级动作均有 44px owner', () => {
  assertContract()
})

test('负控：可点击头像取消 44px 最小 owner 会判红', () => {
  const avatarWxss = read('avatarWxss', {}).replace('min-width: var(--cy-btn-h);', 'min-width: 56rpx;')
  assert.throws(() => assertContract({ avatarWxss }), /min-width/)
})

test('负控：退款对象名称丢失会判红', () => {
  const checkinWxml = read('checkinWxml', {}).replace(' aria-label="清退并退款给 {{detail.displayName || \'该玩家\'}}"', '')
  assert.throws(() => assertContract({ checkinWxml }), /ckd-refund/)
})
