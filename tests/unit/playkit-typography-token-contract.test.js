/* 玩法屏字号必须走 token(2026-09-24)
 *
 * 2026-09-24 量出来的分叉:全站 252 个页面/组件里 font-size **90% 走 --cy-* token**,
 * 老代玩法屏(playkit.wxss 那一代)93%,而**新代玩法屏只有 28%** ——
 * 136 处硬编码,全挂着 `ds-ok 照原型 11.5px` 之类的豁免。
 * 那不是失手,是有意识地「逐值照原型」;但后果是实打实的:
 *   · 改全站 token 影响不到玩法屏(它只认自己那套 --bg/--ink/--sub skin 变量);
 *   · 硬编码不带 --cy-type-scale,系统字体放大时玩法屏不跟随。
 *
 * 收口时发现 125/136(91%)可接全站 ramp，其中 118 处偏差 ≤1px、7 处为 2–3px —— 相似之处本来就在,只是没接上。
 * 只有 11 处真的超出全站尺度(HUD 读数:骰子点数 / 秒表 / 罗盘度数 / 估数),
 * 那 5 档单列成 --cy-play-display-*,与 data-xl / display 同口径**不参与缩放**。
 *
 * 这道门禁钉住:玩法屏不许再出现裸字号。规范的定义不是「不许有自己的语言」,
 * 是「自己的语言也得是一组 token,不是一百多处豁免」。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const KITS = path.join(ROOT, 'pages', 'play', 'components')
const SURFACE = path.join(ROOT, 'pages', 'play', 'style', 'play-surface.wxss')

/** 新代玩法屏 = 吃 play-surface 那套皮面的。老代(playkit.wxss)另算,见下面的说明。 */
function newGenWxss() {
  const out = [SURFACE]
  for (const dir of fs.readdirSync(KITS)) {
    if (!dir.startsWith('playkit-')) continue
    const p = path.join(KITS, dir, 'index.wxss')
    if (!fs.existsSync(p)) continue
    if (fs.readFileSync(p, 'utf8').slice(0, 200).includes('play-surface')) out.push(p)
  }
  return out
}

/** 裸字号 = font-size 后面不是 var(--cy-…)。注释里写的不算。 */
function bareFontSizes(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...code.matchAll(/font-size:\s*([^;]+);/g)]
    .map((m) => m[1].trim())
    .filter((v) => !v.startsWith('var(--cy-'))
}

test('扫描分母正常:新代玩法屏要扫得到(否则这条是空转)', () => {
  assert.ok(newGenWxss().length >= 20, `只扫到 ${newGenWxss().length} 份新代 wxss`)
})

test('★新代玩法屏不许出现裸字号 —— 零基线硬断言', () => {
  const bad = []
  for (const p of newGenWxss()) {
    for (const v of bareFontSizes(fs.readFileSync(p, 'utf8'))) {
      bad.push(`${path.relative(ROOT, p)}: ${v}`)
    }
  }
  assert.deepEqual(bad, [],
    `这些地方还在写裸字号:\n  ${bad.join('\n  ')}\n` +
    '  正文档用全站 --cy-type-*，默认 375px 画布下偏差不得超过 4px;\n' +
    '  真的超出全站尺度的 HUD 读数用 --cy-play-display-xl/2xl/3xl/4xl/5xl。')
})

test('★--cy-play-display-* 只补全站没有的那一段,不许和全站 ramp 重叠', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'style', 'tokens.wxss'), 'utf8')
  const play = [...tokens.matchAll(/--cy-play-display-[\w]+:\s*(\d+)rpx/g)].map((m) => Number(m[1]))
  assert.ok(play.length >= 3, '玩法屏显示档一个都没读到')
  // 全站最大档 page-title=58rpx、data-2xl=84rpx;玩法屏这一段必须严格更大
  assert.ok(Math.min(...play) > 84,
    `玩法屏显示档最小值 ${Math.min(...play)}rpx 没超过全站 data-2xl(84rpx) —— ` +
    '那一段全站已经有了,自己再立一份就是两套并存。')
})

test('★玩法屏显示档不参与缩放 —— 与 data-xl / display 同口径', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'style', 'tokens.wxss'), 'utf8')
  const block = tokens.match(/--cy-play-display-xl[\s\S]{0,400}/)[0]
  assert.doesNotMatch(block, /--cy-play-display-[\w]+:\s*calc\([^;]*--cy-type-scale/,
    '玩法屏显示档乘了 --cy-type-scale。全站大数字档(data-xl / display)都刻意不缩放:' +
    '已够大,放大必破版 —— 这一档要跟它们同口径。')
})

/* ===================== 负控 ===================== */

test('negative control:塞一个裸字号进新代玩法屏,必须被抓出来', () => {
  assert.deepEqual(bareFontSizes('.a { font-size: 30rpx; }'), ['30rpx'])
  assert.deepEqual(bareFontSizes('.a { font-size: var(--cy-type-body); }'), [])
})

test('negative control:注释里的旧值不算违规 —— 判据看声明不看说明', () => {
  const src = '/* 原先是 font-size: 23rpx,照原型 11.5px */\n.a { font-size: var(--cy-type-caption); }'
  assert.deepEqual(bareFontSizes(src), [], '把注释里的旧值当成了裸字号')
})

test('negative control:老代玩法屏(playkit.wxss)不在本条管辖内,不许被误扫', () => {
  const files = newGenWxss().map((p) => path.basename(path.dirname(p)))
  for (const old of ['playkit-steps', 'playkit-blindtaste', 'playkit-timewindow']) {
    assert.ok(!files.includes(old),
      `${old} 是老代(吃 playkit.wxss、93% 已走 token),被错误地扫进新代名单了`)
  }
})


test('玩法主按钮使用按钮语义字号，标题调整不能改变按钮', () => {
  for (const [file, selector] of [
    ['pages/play/style/play-surface.wxss', '.g-btn'],
    ['pages/play/components/playkit-stopwatch/index.wxss', '.sw__btn'],
  ]) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const body = source.slice(source.indexOf(selector + ' {')).split('}')[0]
    assert.match(body, /font-size:\s*var\(--cy-type-button\);/, file + ' ' + selector)
  }
})


const baseline = require('../fixtures/playkit-typography-baseline.json')
const tokenSource = fs.readFileSync(path.join(ROOT, 'style/tokens.wxss'), 'utf8')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '')

// 只接受这些文件实际使用的简单规则；同名规则一律报错，避免媒体查询/覆盖被悄悄忽略。
function fontRules(source) {
  const rules = new Map()
  for (const [, head, body] of stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sizes = [...body.matchAll(/font-size\s*:\s*([^;]+);/g)].map(m => m[1].trim())
    if (!sizes.length) continue
    assert.equal(sizes.length, 1, '同一规则不许重复 font-size，避免后声明覆盖基线')
    const selector = head.split(';').pop().trim().replace(/\s+/g, ' ')
    assert.ok(!rules.has(selector), `重复字号规则: ${selector}`)
    rules.set(selector, sizes)
  }
  return rules
}

function tokenValues(source) {
  const values = new Map()
  for (const [, name, value] of stripComments(source).matchAll(/(--cy-[\w-]+)\s*:\s*([^;{}]+);/g)) {
    if (!values.has(name)) values.set(name, [])
    values.get(name).push(value.trim())
  }
  return values
}

function rpx(value, tokens, seen = []) {
  const literal = value.match(/^(\d+(?:\.\d+)?)rpx$/)
  if (literal) return Number(literal[1])
  const scaled = value.match(/^calc\(\s*(\d+(?:\.\d+)?)rpx\s*\*\s*var\(--cy-type-scale\)\s*\)$/)
  if (scaled) return Number(scaled[1]) // 基准固定 scale=1，辅助字号布局另用模拟器验收。
  const ref = value.match(/^var\((--cy-[\w-]+)\)$/)
  assert.ok(ref, `无法解析字号: ${value}`)
  const name = ref[1]
  assert.ok(!seen.includes(name), `字号 token 循环: ${name}`)
  const definitions = tokens.get(name)
  assert.equal(definitions && definitions.length, 1, `字号 token 缺失或多重定义: ${name}`)
  return rpx(definitions[0], tokens, [...seen, name])
}

function assertDeviation(readSource = file => fs.readFileSync(path.join(ROOT, file), 'utf8'), tokensText = tokenSource) {
  assert.equal(baseline.viewportWidthPx, 375)
  assert.equal(baseline.typeScale, 1)
  assert.equal(baseline.maxDeviationPx, 4)
  const tokens = tokenValues(tokensText)
  let count = 0
  for (const [file, declarations] of Object.entries(baseline.declarations)) {
    const rules = fontRules(readSource(file))
    const locations = new Set()
    for (const [selector, declarationIndex, oldRpx] of declarations) {
      const location = `${file} ${selector} font-size[${declarationIndex}]`
      assert.ok(!locations.has(location), `重复基线: ${location}`)
      locations.add(location)
      const value = (rules.get(selector) || [])[declarationIndex]
      assert.ok(value, `字号声明丢失: ${location}`)
      assert.ok(Number.isFinite(oldRpx) && oldRpx > 0, `无效原字号: ${location}`)
      const current = rpx(value, tokens)
      assert.ok(Math.abs(current - oldRpx) / 2 <= 4,
        `${location}: ${oldRpx} → ${current}rpx，偏差 ${Math.abs(current - oldRpx) / 2}px 超过 4px`)
      count++
    }
  }
  assert.equal(count, 136, '原始 136 处基线不能缩小')
}

test('136 处字号相对原稿的偏差不超过 4px（375px / scale=1）', () => {
  assertDeviation()
})

test('偏差负控：显示档超限必须判红，恰好 4px 仍通过', () => {
  assertDeviation()
  const changed = tokenSource.replace(/(--cy-play-display-xl:\s*)112rpx/, '$1' + '114rpx')
  assert.notEqual(changed, tokenSource, '负控未改变真实 token')
  assert.throws(() => assertDeviation(undefined, changed), /超过 4px/)
})

test('偏差负控：丢声明、未知表达式、缺失或循环 token 不得跳过', () => {
  const file = 'pages/play/components/playkit-diceroll/index.wxss'
  const original = fs.readFileSync(path.join(ROOT, file), 'utf8')
  for (const replacement of ['', 'font-size: var(--cy-not-defined);', 'font-size: calc(112rpx + 2rpx);']) {
    const changed = original.replace(/font-size:\s*var\(--cy-play-display-xl\);/, replacement)
    assert.notEqual(changed, original)
    assert.throws(() => assertDeviation(p => p === file ? changed : fs.readFileSync(path.join(ROOT, p), 'utf8')),
      /字号声明丢失|token 缺失|无法解析字号/)
  }
  const cyclic = tokenSource.replace(/(--cy-play-display-xl:\s*)112rpx/, '$1var(--cy-play-display-xl)')
  assert.throws(() => assertDeviation(undefined, cyclic), /token 循环/)
})


test('偏差负控：追加覆盖字号或同名规则必须判红', () => {
  const file = 'pages/play/components/playkit-diceroll/index.wxss'
  const original = fs.readFileSync(path.join(ROOT, file), 'utf8')
  for (const changed of [
    original.replace('font-size: var(--cy-play-display-xl);',
      'font-size: var(--cy-play-display-xl); font-size: var(--cy-play-display-5xl);'),
    original + '\n.dz__sum { font-size: var(--cy-play-display-5xl); }',
  ]) {
    assert.notEqual(changed, original)
    assert.throws(() => assertDeviation(p => p === file ? changed : fs.readFileSync(path.join(ROOT, p), 'utf8')),
      /重复 font-size|重复字号规则/)
  }
})
