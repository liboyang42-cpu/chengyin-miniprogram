const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const SHEET_WXML = 'components/cy/sheet/index.wxml'
const SHEET_WXSS = 'components/cy/sheet/index.wxss'

function assertFullSceneTopLevel(wxml, wxss) {
  const nav = wxml.match(/<view class="sh__nav"[\s\S]*?<\/view>\s*<!-- full:步骤进度/)
  assert.ok(nav, 'full scene 必须有独立顶层导航，不能借用 bottom sheet 标题栏')
  assert.match(nav[0], /bindtap="onBack"[^>]*aria-role="button"[^>]*aria-label="上一步"/,
    'full scene 的上一步必须是有语义的可操作控件')
  assert.match(nav[0], /bindtap="onClose"[^>]*data-testid="sheet-close"[^>]*aria-role="button"[^>]*aria-label="\{\{closeLabel\}\}"/,
    'full scene 的退出必须是有语义的可操作控件')

  const controls = wxss.match(/\.sh--full \.sh__nav-btn \{[\s\S]*?\n\}/)
  assert.ok(controls, 'full scene 顶层控件样式必须存在')
  assert.match(controls[0], /width:\s*var\(--cy-btn-h\);/,
    'full scene 顶层控件横向热区必须为 88rpx')
  assert.match(controls[0], /height:\s*var\(--cy-btn-h\);/,
    'full scene 顶层控件纵向热区必须为 88rpx')
}

test('Q117: full scene 顶层返回与退出使用 88rpx 热区', () => {
  assertFullSceneTopLevel(read(SHEET_WXML), read(SHEET_WXSS))
})

test('Q117 negative control: 顶层退出退回 56rpx 必须判红', () => {
  const wxml = read(SHEET_WXML)
  const wxss = read(SHEET_WXSS)
  const mutated = wxss.replace(
    /\.sh--full \.sh__nav-btn \{([\s\S]*?)width:\s*var\(--cy-btn-h\);/,
    '.sh--full .sh__nav-btn {$1width:var(--cy-btn-h-xs);',
  )
  assert.notEqual(mutated, wxss, '变异锚点失效：请同步检查 full scene 顶层按钮样式')
  assert.throws(
    () => assertFullSceneTopLevel(wxml, mutated),
    (error) => error instanceof assert.AssertionError && /横向热区必须为 88rpx/.test(error.message),
    '56rpx 变异必须由顶层横向热区断言判红',
  )
})
