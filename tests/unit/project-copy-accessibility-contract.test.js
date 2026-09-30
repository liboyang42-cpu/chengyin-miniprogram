'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PAIRS = [
  ['pages/topic/components/project-host/index.wxml', 'pages/topic/components/project-host/index.wxss'],
  ['pages/topic/components/project-join/index.wxml', 'pages/topic/components/project-join/index.wxss'],
]

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function assertContract(overrides = {}) {
  for (const [wxmlFile, wxssFile] of PAIRS) {
    const wxml = overrides[wxmlFile] === undefined ? read(wxmlFile) : overrides[wxmlFile]
    const wxss = overrides[wxssFile] === undefined ? read(wxssFile) : overrides[wxssFile]
    const controls = [...wxml.matchAll(/<view\b[^>]*class="dr-copy"[^>]*>/g)].map((match) => match[0])
    assert.equal(controls.length, 3, `${wxmlFile} 应保留三处复制动作`)
    for (const control of controls) {
      assert.match(control, /aria-role="button"/, `${wxmlFile} 复制动作缺少 button 语义`)
      assert.match(control, /aria-label="复制(?:电话|答案)"/, `${wxmlFile} 复制动作缺少可读名称`)
    }
    const rule = wxss.match(/\.dr-copy\s*\{([^}]*)\}/)
    assert.ok(rule, `${wxssFile} 缺少 .dr-copy`)
    assert.match(rule[1], /width:\s*var\(--cy-btn-h\)/, `${wxssFile} 复制动作宽度不足 88rpx`)
    assert.match(rule[1], /height:\s*var\(--cy-btn-h\)/, `${wxssFile} 复制动作高度不足 88rpx`)
    const glyph = wxss.match(/\.dr-copy-img\s*\{([^}]*)\}/)
    assert.match(glyph && glyph[1], /width:\s*32rpx/)
    assert.match(glyph && glyph[1], /height:\s*32rpx/, '只扩大透明热区，不放大复制图标')
  }
}

test('项目抽屉复制动作有 44px 热区、按钮语义且保持原图标尺寸', () => {
  assertContract()
})

test('负控：复制动作缩回 40rpx 会判红', () => {
  const file = 'pages/topic/components/project-host/index.wxss'
  const broken = read(file).replace('width: var(--cy-btn-h);\n  height: var(--cy-btn-h);', 'width: 40rpx;\n  height: 40rpx;')
  assert.throws(() => assertContract({ [file]: broken }), /宽度不足/)
})

test('负控：复制动作移除可读名称会判红', () => {
  const file = 'pages/topic/components/project-join/index.wxml'
  const broken = read(file).replace(' aria-label="复制答案"', '')
  assert.throws(() => assertContract({ [file]: broken }), /可读名称/)
})
