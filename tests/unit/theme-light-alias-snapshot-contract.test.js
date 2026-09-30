const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// WXSS 自定义属性在 page{} 里就地求值、按值继承(仓库已知行为,tokens.wxss sheet-bg 注释)。
// 因此 .theme-light/.theme-merchant 块必须整组重声明 ② 旧名 alias,否则白页上的旧名元素
// 读到深色快照 —— 2026-08-07 实证:official-mine 卡片、merchantapply2 类别 chip 在白页发黑。
const REQUIRED_ALIASES = [
  '--cy-bg-page',
  '--cy-bg-card',
  '--cy-bg-card-2',
  '--cy-bg-elevated',
  '--cy-text-body',
  '--cy-text-secondary',
  '--cy-border-card',
  '--cy-border-line',
  '--cy-btn-solid-bg',
  '--cy-btn-solid-fg',
]

function lightBlock(tokens) {
  const start = tokens.indexOf('.theme-merchant {')
  assert.ok(start > 0, '找不到 .theme-merchant 选择器块')
  const end = tokens.indexOf('\n}', start)
  return tokens.slice(start, end)
}

test('theme-light/merchant 块必须整组重声明 ② 旧名 alias(防深色快照)', () => {
  const block = lightBlock(read('style/tokens.wxss'))
  for (const alias of REQUIRED_ALIASES) {
    assert.match(
      block,
      new RegExp(alias.replace(/[-]/g, '\\-') + ':\\s*var\\(--cy-color-'),
      `${alias} 未在白域块内重声明,白页旧名元素会读到深色快照`,
    )
  }
})

test('负控:摘掉白域块内的重声明必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const start = tokens.indexOf('.theme-merchant {')
  const end = tokens.indexOf('\n}', start)
  const block = tokens.slice(start, end)
  const line = block.split('\n').find((l) => l.includes('--cy-bg-elevated:'))
  assert.ok(line, '负控锚点失效:重声明行不存在')
  // 只从白域块里摘,基础 page{} 里的同文案行不能碰(负控要打中要害)
  const brokenBlock = block.replace(line + '\n', '')
  assert.notEqual(brokenBlock, block)
  assert.throws(
    () => assert.match(brokenBlock, /--cy-bg-elevated:\s*var\(--cy-color-/),
    assert.AssertionError,
  )
})
