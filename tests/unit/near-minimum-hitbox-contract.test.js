'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function body(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少 ${selector}`)
  return match[1]
}

function assertContract(overrides = {}) {
  const source = (file) => overrides[file] === undefined ? read(file) : overrides[file]

  // 订单详情加载失败卡的重试/返回钮已按稿 356:5220 删除(零按钮结果半屏),该 owner 不复存在。

  const rewardWxml = source('pages/publish/components/reward-selector/index.wxml')
  const rewardWxss = source('pages/publish/components/reward-selector/index.wxss')
  assert.match(rewardWxml, /class="reward-selector__field"[^>]*aria-role="button"[^>]*aria-label=/)
  assert.match(rewardWxml, /class="create-date"[^>]*aria-role="button"[^>]*aria-label="选择优惠券日期"/)
  assert.match(body(rewardWxss, '.reward-selector__field'), /(?:^|\n)\s*min-height:\s*var\(--cy-btn-h\)/)
  assert.match(body(rewardWxss, '.create-date'), /(?:^|\n)\s*min-height:\s*var\(--cy-btn-h\)/)

  const editorWxml = source('pages/publish/fabu/index.wxml')
  const editorWxss = source('pages/publish/fabu/index.wxss')
  assert.match(editorWxml, /class="slopes-back"[^>]*aria-role="button"[^>]*aria-label="返回上一页"/)
  assert.match(body(editorWxss, '.slopes-back'), /(?:^|\n)\s*width:\s*var\(--cy-btn-h\)/)
  assert.match(body(editorWxss, '.slopes-back'), /(?:^|\n)\s*height:\s*var\(--cy-btn-h\)/)
}

test('40–42px 的真实交互 owner 统一提升到 44px 并补齐语义', () => {
  assertContract()
})

test('负控：发布页返回移除可读名称会判红', () => {
  const file = 'pages/publish/fabu/index.wxml'
  const broken = read(file).replace(
    /(<view class="slopes-back"[^>]*?) aria-role="button" aria-label="返回上一页"/,
    '$1',
  )
  assert.throws(() => assertContract({ [file]: broken }), /slopes-back/)
})
