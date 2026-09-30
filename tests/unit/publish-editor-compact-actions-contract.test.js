'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const TEMP_WXML = path.join(ROOT, 'pages/publish/temp/index.wxml')
const TEMP_WXSS = path.join(ROOT, 'pages/publish/temp/index.wxss')
const FABU_WXML = path.join(ROOT, 'pages/publish/fabu/index.wxml')
const GRID_WXSS = path.join(ROOT, 'pages/publish/styles/photo-grid.wxss')

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少 ${selector}`)
  return match[1]
}

function assertMinHeight(wxss, selector) {
  assert.match(rule(wxss, selector), /min-height:\s*var\(--cy-btn-h\)/, `${selector} 高度不足 44px`)
}

function assertSquare(wxss, selector) {
  const cssRule = rule(wxss, selector)
  assert.match(cssRule, /width:\s*var\(--cy-btn-h\)/, `${selector} 宽度不足 44px`)
  assert.match(cssRule, /height:\s*var\(--cy-btn-h\)/, `${selector} 高度不足 44px`)
}

function assertContract(overrides = {}) {
  const tempWxml = overrides.tempWxml === undefined ? fs.readFileSync(TEMP_WXML, 'utf8') : overrides.tempWxml
  const tempWxss = overrides.tempWxss === undefined ? fs.readFileSync(TEMP_WXSS, 'utf8') : overrides.tempWxss
  const fabuWxml = overrides.fabuWxml === undefined ? fs.readFileSync(FABU_WXML, 'utf8') : overrides.fabuWxml
  const gridWxss = overrides.gridWxss === undefined ? fs.readFileSync(GRID_WXSS, 'utf8') : overrides.gridWxss

  // 2026-09-22 勋章样式两颗 .cg-ms-opt 改成 cy-dropdown,触发器是 .cg-pick(height:88rpx = 44px),不再有 .cg-ms-opt
  for (const selector of ['.cg-chip', '.cg-chip-add', '.cg-opt-chip', '.cg-cfg-add', '.cg-medal-clear', '.cg-beat-del', '.cg-audio-del', '.cg-pv-usehint']) {
    assertMinHeight(tempWxss, selector)
  }
  for (const selector of ['.cg-chip-x', '.cg-choice-radio', '.cg-opt-thumb-hit', '.cg-audio-play', '.cg-pv-arrow']) {
    assertSquare(tempWxss, selector)
  }
  assertSquare(gridWxss, '.pgrid-del')

  for (const label of [
    '删除类别 {{item.categoryName}}', '添加玩法类别',
    '设为正确答案 {{opt.letter}}', '更换选项 {{opt.letter}} 配图', '上传选项 {{opt.letter}} 配图',
    '配置选项 {{opt.letter}} 音频', '清除选项 {{opt.letter}} 媒体', '添加选项',
    '清除勋章图片',
    '删除时间节点 {{bi + 1}}', "{{audioPreviewPlaying?'暂停导览音频':'播放导览音频'}}", '删除导览音频',
    '上一步预览', '下一步预览', '使用提示', '删除剧情配图 {{ii + 1}}',
  ]) {
    assert.match(tempWxml, new RegExp(`aria-label="${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `缺少可读名称：${label}`)
  }
  // 2026-09-22 编辑页单选统一下拉:玩法形态、勋章样式不再是一颗颗芯片,可读名称由 cy-dropdown 触发器自带
  //   (「当前选择 X，点击更换」),这里钉住组件那一处,不再逐颗钉芯片的 aria-label。
  assert.match(fs.readFileSync(path.join(__dirname, '../../components/cy/dropdown/index.wxml'), 'utf8'),
    /aria-label="\{\{labels\[value\] \? '当前选择 ' \+ labels\[value\] \+ '，点击更换' : '展开选项'\}\}"/)
  assert.match(fabuWxml, /class="pgrid-del"[^\n]*aria-role="button"[^\n]*aria-label="删除节点照片 \{\{pi \+ 1\}\}"/)
}

test('玩法编辑器紧凑动作与共享照片删除均满足 44px 和可读语义', () => {
  assertContract()
})

test('负控：语音播放按钮退回 76rpx 会判红', () => {
  const tempWxss = fs.readFileSync(TEMP_WXSS, 'utf8').replace(
    /(\.cg-audio-play\s*\{[^}]*?)width:\s*var\(--cy-btn-h\);\s*height:\s*var\(--cy-btn-h\);/s,
    '$1width:76rpx; height:76rpx;',
  )
  assert.throws(() => assertContract({ tempWxss }), /宽度不足/)
})

test('负控：播放按钮丢失状态名称会判红', () => {
  const tempWxml = fs.readFileSync(TEMP_WXML, 'utf8').replace(" aria-label=\"{{audioPreviewPlaying?'暂停导览音频':'播放导览音频'}}\"", '')
  assert.throws(() => assertContract({ tempWxml }), /播放导览音频/)
})
