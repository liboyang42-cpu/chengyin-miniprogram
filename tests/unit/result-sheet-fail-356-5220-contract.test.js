/* cy-result-sheet 失败态对稿 356-5220(2026-09-15)
 * 钉三件会静默走样的事:
 *   ① 失败态读的每个 var() 都有真声明(未定义 var() 整条作废,门禁看不见);
 *   ② 抓手实色 token 在全部主题作用域都重声明(就地求值快照,漏一处那一档就回落成别的色);
 *   ③ cy-sheet 暴露的钩子都带回退且回退值 = 原值,其它 sheet 渲染不变。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const RS = read('components/cy/result-sheet/index.wxss')
const SHEET = read('components/cy/sheet/index.wxss')
const TOKENS = read('style/tokens.wxss')
const DARK = read('style/dark-mode.wxss')
const MERCHANT = read('style/merchant-light.wxss')

function rule(css, selector) {
  const i = strip(css).indexOf(selector + ' {')
  assert.ok(i >= 0, '切不到规则 ' + selector)
  const s = strip(css)
  return s.slice(i, s.indexOf('}', i))
}

function undefinedVars(css, sources) {
  const all = sources.map(strip).join('\n')
  const used = new Set((strip(css).match(/var\(--cy-[a-z0-9-]+(?=[),])/g) || []).map((v) => v.slice(4)))
  return [...used].filter((name) => !new RegExp('(^|[\\s;{])' + name + '\\s*:', 'm').test(all))
}

test('① 失败态与壳读到的 token 全部有声明', () => {
  const sources = [TOKENS, DARK, MERCHANT, RS]   // RS 自己在 .rs-shell 上声明钩子
  assert.deepEqual(undefinedVars(RS, sources), [])
})

test('② 原因条 / 标题 / 徽章 i 字形按稿', () => {
  const reason = rule(RS, '.rs__reason')
  assert.match(reason, /width:\s*672rpx/)
  assert.match(reason, /min-height:\s*var\(--cy-comp-result-fail-reason-h\)/)
  assert.match(reason, /justify-content:\s*center/)
  assert.match(reason, /font-size:\s*var\(--cy-comp-result-fail-reason-size\)/)
  assert.match(reason, /color:\s*var\(--cy-color-text-primary\)/)
  assert.match(TOKENS, /--cy-comp-result-fail-reason-size:\s*calc\(27rpx \* var\(--cy-type-scale\)\)/)
  assert.match(TOKENS, /--cy-comp-result-fail-title-size:\s*calc\(34rpx \* var\(--cy-type-scale\)\)/)
  const wxml = read('components/cy/result-sheet/index.wxml')
  assert.match(wxml, /<view class="rs__bang"[^>]*>\s*<view class="rs__bang-dot"><\/view>\s*<view class="rs__bang-stem"><\/view>/,
    '稿是 info「i」:圆点在上、竖条在下')
  assert.match(wxml, /<cy-sheet class="rs-shell"/)
})

test('③ 抓手实色在全部主题作用域重声明', () => {
  const decl = (src) => (strip(src).match(/--cy-color-sheet-handle:\s*([^;]+);/g) || []).length
  assert.equal(decl(TOKENS), 4, 'page / theme-merchant / theme-topic-editor / theme-dark')
  assert.equal(decl(MERCHANT), 2, 'merchant-light 浅色块 + 自己的深色块')
  assert.equal(decl(DARK), 1, 'dark-mode 媒体查询')
})

test('④ cy-sheet 钩子都带回退,回退值就是改前的值', () => {
  const handle = rule(SHEET, '.sh__handle')
  assert.match(handle, /width:\s*var\(--cy-comp-sheet-handle-w,\s*64rpx\)/)
  assert.match(handle, /height:\s*var\(--cy-comp-sheet-handle-h,\s*8rpx\)/)
  assert.match(handle, /background:\s*var\(--cy-comp-sheet-handle-bg,\s*var\(--cy-border-line\)\)/)
  assert.match(handle, /margin:\s*var\(--cy-comp-sheet-handle-mt,\s*16rpx\) auto var\(--cy-comp-sheet-handle-mb,\s*8rpx\)/)
})

test('负控:删掉一处 token 声明 / 把 i 改回感叹号顺序,必须判红', () => {
  const brokenTokens = TOKENS.replace(/--cy-comp-result-fail-reason-h:[^;]+;/, '')
  assert.notEqual(brokenTokens, TOKENS)
  assert.deepEqual(undefinedVars(RS, [brokenTokens, DARK, MERCHANT, RS]), ['--cy-comp-result-fail-reason-h'])
  const bang = '<view class="rs__bang"><view class="rs__bang-stem"></view><view class="rs__bang-dot"></view></view>'
  assert.doesNotMatch(bang, /<view class="rs__bang"[^>]*>\s*<view class="rs__bang-dot"><\/view>/)
})
