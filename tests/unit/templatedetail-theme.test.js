const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const WXSS_PATH = path.resolve(__dirname, '../../pages/templatedetail/templatedetail.wxss')

function assertTemplateDetailThemeContract(wxss) {
  assert.doesNotMatch(wxss, /#107c10\b/i, '模板详情不能保留 Xbox 裸绿色板')
  assert.match(
    wxss,
    /--xb-green\s*:\s*var\(--cy-color-brand\)\s*;/,
    '--xb-green 兼容名必须桥到 DS 品牌语义 token'
  )
}

test('templatedetail:旧 xb-green 兼容名桥到 DS 品牌色,不再使用裸绿', () => {
  const wxss = fs.readFileSync(WXSS_PATH, 'utf8')
  assertTemplateDetailThemeContract(wxss)
})

test('templatedetail:负控恢复 #107C10 裸绿时契约精准变红', () => {
  const wxss = fs.readFileSync(WXSS_PATH, 'utf8')
  assertTemplateDetailThemeContract(wxss)

  const nakedGreen = wxss.replace(
    /--xb-green\s*:\s*var\(--cy-color-brand\)\s*;/,
    '--xb-green: #107C10;'
  )
  assert.throws(() => assertTemplateDetailThemeContract(nakedGreen))
})
