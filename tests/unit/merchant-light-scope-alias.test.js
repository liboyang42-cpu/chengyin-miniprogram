const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SCOPE_PATH = path.resolve(__dirname, '../../style/merchant-light-scope.wxss')
const TOKENS_PATH = path.resolve(__dirname, '../../style/tokens.wxss')

const MERCHANT_ALIAS_BRIDGES = [
  ['--cy-bg-page', '--cy-color-bg-page'],
  ['--cy-bg-card', '--cy-color-bg-surface'],
  ['--cy-bg-card-2', '--cy-color-bg-surface-subtle'],
  ['--cy-text-title', '--cy-color-text-primary'],
  ['--cy-text-body', '--cy-color-text-secondary'],
  ['--cy-text-secondary', '--cy-color-text-tertiary'],
  ['--cy-text-inverse', '--cy-color-text-inverse'],
  ['--cy-border-card', '--cy-color-border-subtle'],
  ['--cy-border-line', '--cy-color-border-strong'],
  ['--cy-btn-solid-bg', '--cy-color-action-primary-bg'],
  ['--cy-btn-solid-fg', '--cy-color-action-primary-fg'],
  ['--cy-danger', '--cy-color-status-danger'],
  ['--cy-white-16', '--cy-color-border-strong']
]

const MERCHANT_LITERAL_OVERRIDES = [
  ['--cy-bg-subtle', '#f8fafc']
]

function source() {
  return fs.readFileSync(SCOPE_PATH, 'utf8')
}

function merchantScopeBlock(scopeWxss) {
  const open = scopeWxss.search(/\.theme-merchant\s*\{/)
  assert.notEqual(open, -1, '必须存在 .theme-merchant 作用域 block')
  const bodyStart = scopeWxss.indexOf('{', open) + 1
  let depth = 1
  for (let i = bodyStart; i < scopeWxss.length; i += 1) {
    if (scopeWxss[i] === '{') depth += 1
    if (scopeWxss[i] === '}') {
      depth -= 1
      if (depth === 0) return scopeWxss.slice(bodyStart, i)
    }
  }
  assert.fail('.theme-merchant 作用域 block 未闭合')
}

function aliasPattern(legacyName, semanticName) {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escape(legacyName)}\\s*:\\s*var\\(${escape(semanticName)}\\)\\s*;`)
}

function assertMerchantAliasBridges(scopeBlock) {
  for (const [legacyName, semanticName] of MERCHANT_ALIAS_BRIDGES) {
    assert.match(
      scopeBlock,
      aliasPattern(legacyName, semanticName),
      `${legacyName} 必须在商家作用域桥接到 ${semanticName}`
    )
  }
}

function literalPattern(legacyName, expectedValue) {
  const escape = value => value.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')
  return new RegExp(
    escape(legacyName) + '\\s*:\\s*' + escape(expectedValue) + '\\s*;'
  )
}

function assertMerchantLiteralOverrides(scopeBlock) {
  for (const [legacyName, expectedValue] of MERCHANT_LITERAL_OVERRIDES) {
    assert.match(scopeBlock, literalPattern(legacyName, expectedValue), '商家日间旧 alias 字面契约漂移')
  }
}

test('merchant scope:页面消费的旧 alias 全部桥接到日间语义 token,玩家暗色真值不变', () => {
  const scopeBlock = merchantScopeBlock(source())
  const tokens = fs.readFileSync(TOKENS_PATH, 'utf8')
  assertMerchantAliasBridges(scopeBlock)
  assertMerchantLiteralOverrides(scopeBlock)
  // 这两条原本写死 #020104 / #0A090D。意图是「商家修复不能污染玩家暗色」，
  // 但字面量断言把色值本身也锁死了 —— 2026-08-05 去紫相时它挡在前面，而去紫
  // 相恰恰是要改这两个值。断言改成语义：玩家侧仍是**暗色**、且和商家日间**不同值**，
  // 原意图一条不少，色值可以正常演进。
  assertPlayerDarkNotOverwritten(tokens)
})

// 玩家暗色真值的判据：**每一个**声明它的暗色块都得是暗的，且和商家日间不同值。
// ⚠️ 第一版用全文 min/max 扫，结果 page{} 被改亮、.theme-dark 还暗着，min 照样
// 取到暗值 —— 负控注入后测试还是绿的。判据必须落到具体块，不能全文取极值。
function playerDarkBlocks(tokens) {
  // 顶层块 = 行首非空白起始、以 { 结尾；玩家暗色块 = page{} 和 .theme-dark
  // 直接定位块的起始行，取到下一个行首 `}`。
  // ⚠️ 别用「从行首 } 往回切到第一个 {」——文件头的注释块里就有 `{`，切出来的
  // 选择器是一坨注释，两次都没定位到块。
  const lines = tokens.split('\n')
  const blocks = []
  lines.forEach((line, i) => {
    if (!/^(page\s*\{|\.theme-dark\s*\{|page\.theme-dark\b)/.test(line)) return
    let j = i + 1
    while (j < lines.length && lines[j] !== '}') j += 1
    blocks.push({ sel: line.trim(), body: lines.slice(i + 1, j).join('\n') })
  })
  return blocks
}

function assertPlayerDarkNotOverwritten(tokens) {
  const lum = (hex) => [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0) / 3
  const darkBlocks = playerDarkBlocks(tokens)
  assert.ok(darkBlocks.length >= 2, '应能定位到 page{} 与 .theme-dark 两个玩家暗色块')
  for (const name of ['--cy-color-bg-page', '--cy-color-bg-surface']) {
    let seen = 0
    for (const b of darkBlocks) {
      const hit = new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})\\s*;`).exec(b.body)
      if (!hit) continue
      seen += 1
      assert.ok(lum(hit[1]) <= 32,
        `${b.sel} 里的 ${name} 被改亮成 ${hit[1]}(明度 ${lum(hit[1]).toFixed(1)})，商家修复污染了玩家暗色主题`)
    }
    assert.ok(seen >= 2, `${name} 应在两个玩家暗色块里都有定义，实测 ${seen} 处`)
  }
}

test('merchant scope:负控移除 bg-card 桥接时契约精准变红', () => {
  const scopeBlock = merchantScopeBlock(source())
  assertMerchantAliasBridges(scopeBlock)
  const withoutCardBridge = scopeBlock.replace(
    /\s*--cy-bg-card\s*:\s*var\(--cy-color-bg-surface\)\s*;/,
    ''
  )
  assert.throws(() => assertMerchantAliasBridges(withoutCardBridge))
})

const UNRELATED_TRAILING_BLOCK = [
  '',
  '.some-later-block {',
  ...MERCHANT_ALIAS_BRIDGES.map(([legacy, semantic]) => `  ${legacy}: var(${semantic});`),
  ...MERCHANT_LITERAL_OVERRIDES.map(([legacy, value]) => `  ${legacy}: ${value};`),
  '}',
  ''
].join('\n')

test('merchant scope:尾部追加无关 block 后,删除 .theme-merchant 内的 bg-card 桥接仍必须变红', () => {
  const scopeWxss = source()
  const withTrailing = scopeWxss + UNRELATED_TRAILING_BLOCK
  assertMerchantAliasBridges(merchantScopeBlock(withTrailing))
  assertMerchantLiteralOverrides(merchantScopeBlock(withTrailing))
  const brokenSource = scopeWxss.replace(
    /\n\s*--cy-bg-card\s*:\s*var\(--cy-color-bg-surface\)\s*;/,
    ''
  )
  assert.notEqual(brokenSource, scopeWxss, '负控变异必须真的改到源文件文本')
  assert.throws(
    () => assertMerchantAliasBridges(merchantScopeBlock(brokenSource + UNRELATED_TRAILING_BLOCK)),
    /--cy-bg-card 必须在商家作用域桥接到 --cy-color-bg-surface/
  )
})
