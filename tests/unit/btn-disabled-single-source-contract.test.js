// 按钮禁用态「单一真源」契约(R1 缺口 G7,2026-07-29)
//
// 修的是什么:全局类 style/components.wxss 用 `opacity: .4` 表达禁用,
// 组件层 components/cy/btn 用「占位色字 + 中性底」表达禁用 —— 同一个"不可用"两种样子,
// 且 opacity 会把各主题块逐块调过的文字色整体压暗到 4.5:1 以下。
//
// 每条断言都读磁盘真实源码,并配一条负控(见文件末尾:把错误写法喂给同一批断言必须判红)。
// 判据是「两层读同一组 token 且都不含 opacity」,不是「长得像禁用」。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 禁用态必须读的两个 token —— 与组件层 .btn--disabled 逐字同源
const DISABLED_FG = '--cy-text-placeholder'
const DISABLED_BG = '--cy-bg-subtle'

/** 抽出全局类的禁用规则体。选择器写法允许变(逗号/换行/顺序),规则体必须存在。 */
function globalDisabledBlock(wxss) {
  const m = wxss.match(/\.cy-btn\[disabled\][^{]*\{([\s\S]*?)\}/)
  assert.ok(m, 'style/components.wxss 必须有 .cy-btn[disabled] 禁用规则')
  return m[1]
}

/** 抽出组件层的禁用变体规则体。 */
function componentDisabledBlock(wxss) {
  const m = wxss.match(/\.btn--disabled \{([\s\S]*?)\}/)
  assert.ok(m, 'components/cy/btn/index.wxss 必须有 .btn--disabled 变体')
  return m[1]
}

/** 一个禁用规则体「合规」的三条判据:换色不降透明度、色走 token、两个 token 都在。 */
function assertDisabledIsTokenRecolor(block, where) {
  assert.doesNotMatch(block, /opacity\s*:/,
    `${where}:禁用态不得用 opacity(会把已调过对比度的文字色整体压暗)`)
  assert.match(block, new RegExp(`color:\\s*var\\(${DISABLED_FG}\\)`),
    `${where}:禁用文字必须读 var(${DISABLED_FG})`)
  assert.match(block, new RegExp(`background:\\s*var\\(${DISABLED_BG}\\)`),
    `${where}:禁用底色必须读 var(${DISABLED_BG})`)
}

test('全局类 .cy-btn 的禁用态 = 占位色字 + 中性底,不用 opacity', () => {
  assertDisabledIsTokenRecolor(
    globalDisabledBlock(read('style/components.wxss')),
    'style/components.wxss .cy-btn[disabled]')
})

test('组件层 .btn--disabled 的禁用态判据相同(单一真源的另一半)', () => {
  assertDisabledIsTokenRecolor(
    componentDisabledBlock(read('components/cy/btn/index.wxss')),
    'components/cy/btn/index.wxss .btn--disabled')
})

test('全局类禁用态必须清掉 secondary 的描边(组件层 variant 互斥,全局类会叠加)', () => {
  // 组件层 disabled 是独立 variant,天然不带描边;全局类里 .cy-btn--secondary 的
  // 2rpx 描边会与禁用规则同时命中,不显式清掉就还是"两种样子"。
  const block = globalDisabledBlock(read('style/components.wxss'))
  assert.match(block, /border:\s*none/,
    '全局类禁用态必须显式 border: none,否则禁用的 secondary 仍留强描边')
})

// ============================================================
// 负控:证明上面的断言真的能变红,而不是恒真
// ============================================================
// 这里不改磁盘(改磁盘做变异会与并行会话互踩,失败时还可能留下脏文件),
// 而是把「该红的写法」喂给同一批断言函数 —— 断言函数吃的是文本,与读磁盘同一条代码路径。
// 磁盘级真变异已在提交前手工做过一次(把规则改回 opacity: .4 → 前两条断言判红,
// 组件层那条仍绿,证明红得精准而非满盘皆红)。

test('负控:opacity 写法必须判红', () => {
  assert.throws(
    () => assertDisabledIsTokenRecolor(' opacity: .4; ', '负控'),
    /不得用 opacity/,
    '负控失效:opacity 写法没被判红,说明正向断言是恒真的')
})

test('负控:硬编码色值(不走 token)必须判红', () => {
  assert.throws(
    () => assertDisabledIsTokenRecolor(' color: #888; background: #eee; ', '负控'),
    /必须读 var\(--cy-text-placeholder\)/,
    '负控失效:硬编码色值没被判红')
})

test('负控:只换字色、漏掉底色必须判红', () => {
  assert.throws(
    () => assertDisabledIsTokenRecolor(' color: var(--cy-text-placeholder); ', '负控'),
    /必须读 var\(--cy-bg-subtle\)/,
    '负控失效:漏掉禁用底色没被判红')
})

test('负控:借用别的 token(如 text-disabled)必须判红', () => {
  // --cy-color-text-disabled 在暗端是 rgba(255,255,255,.40) —— 半透明,等于把 opacity
  // 换个名字塞回来。禁用态要的是**不透明的占位色**,两者不可互换。
  assert.throws(
    () => assertDisabledIsTokenRecolor(
      ' color: var(--cy-color-text-disabled); background: var(--cy-bg-subtle); ', '负控'),
    /必须读 var\(--cy-text-placeholder\)/,
    '负控失效:借用半透明的 text-disabled 没被判红')
})

test('负控:规则整块被删必须判红(而不是静默通过)', () => {
  assert.throws(
    () => globalDisabledBlock('.cy-btn { height: 88rpx; }'),
    /必须有 \.cy-btn\[disabled\] 禁用规则/,
    '负控失效:禁用规则整块消失没被判红')
})
