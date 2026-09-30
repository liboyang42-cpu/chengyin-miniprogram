const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  assert.ok(match, `${selector} 必须显式声明几何合同`)
  return match[1]
}

function declarations(body) {
  const result = new Map()
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const statement of withoutComments.split(';')) {
    const colon = statement.indexOf(':')
    if (colon < 0) continue
    result.set(statement.slice(0, colon).trim(), statement.slice(colon + 1).trim())
  }
  return result
}

function declaration(source, selector, property) {
  const value = declarations(rule(source, selector)).get(property)
  assert.notEqual(value, undefined, `${selector} 必须显式声明 ${property}`)
  return value
}

function assertIconHostGeometry({ wxml, wxss }) {
  const hostBox = declarations(rule(wxss, ':host'))
  assert.equal(hostBox.get('display'), 'inline-flex', 'host 必须由唯一 glyph 收缩成确定盒子')
  assert.equal(hostBox.get('line-height'), '0', 'host 不得回退到继承行高与 inline 基线')
  assert.equal(hostBox.get('vertical-align'), 'middle', 'inline icon 必须显式脱离默认 baseline 对齐')
  const boxInflators = [...hostBox.keys()].filter((property) => /^(?:width|height|min-|max-|padding|border|gap|row-gap|column-gap)/.test(property))
  assert.deepEqual(boxInflators, [], 'host 盒子必须精确收缩到 size glyph，不能另加尺寸、边框或内边距')

  assert.match(
    wxml.trim(),
    /^<view\b[^>]*\bclass="cyi cyi--\{\{name\}\}"[^>]*>\s*<\/view>$/,
    'cy-icon 必须保留一个且仅一个 glyph 根盒子'
  )
  const inlineStyle = wxml.match(/\bstyle="([^"]+)"/)
  assert.ok(inlineStyle, 'glyph 必须由 size 显式声明宽高')
  const glyphBox = declarations(inlineStyle[1])
  assert.equal(glyphBox.get('width'), '{{size}}rpx', 'size 必须直接控制 glyph 宽度')
  assert.equal(glyphBox.get('height'), '{{size}}rpx', 'size 必须直接控制 glyph 高度')
  assert.equal(declaration(wxss, '.cyi', 'display'), 'block', 'glyph 不能再生成 inline 基线空隙')
  assert.equal(declaration(wxss, '.cyi', 'flex'), 'none', 'glyph 固定盒子不得在 host 内伸缩')
  assert.equal(
    declaration(wxss, '.cyi', 'transform'),
    'translate(var(--cy-icon-optical-x, 0rpx), var(--cy-icon-optical-y, 0rpx))',
    '光学校正入口必须归 cy-icon 组件所有'
  )
}

test('cy-icon 的 size 同时确定 host 与 glyph 盒子并消除默认行盒', () => {
  assertIconHostGeometry({
    wxml: read('components/cy/icon/index.wxml'),
    wxss: read('components/cy/icon/index.wxss'),
  })
})

test('负控：真实 :host 盒子或 line-height 回退到默认值时契约必须变红', () => {
  const source = {
    wxml: read('components/cy/icon/index.wxml'),
    wxss: read('components/cy/icon/index.wxss'),
  }
  assertIconHostGeometry(source)

  const withoutHost = source.wxss.replace(/(^|})\s*:host\s*\{[^}]*\}/m, '$1')
  assert.notEqual(withoutHost, source.wxss, '负控必须命中真实 :host selector')
  assert.throws(() => assertIconHostGeometry({ ...source, wxss: withoutHost }), /:host 必须显式声明几何合同/)

  const inheritedLineHeight = source.wxss.replace(/(\bline-height\s*:)\s*0\s*;/, '$1 normal;')
  assert.notEqual(inheritedLineHeight, source.wxss, '负控必须命中真实 line-height 声明')
  assert.throws(
    () => assertIconHostGeometry({ ...source, wxss: inheritedLineHeight }),
    /host 不得回退到继承行高与 inline 基线/
  )
})
