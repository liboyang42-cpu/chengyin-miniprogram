/* 弹层中性阶完整性契约(2026-09-02)
 *
 * scene-sheet 的 .ss--player / .ss--merchant 各自声明了一整套中性面 token,
 * 让弹层内部不受宿主页影响。问题在于**这套声明必须覆盖到阶梯末端**:
 * 少覆盖一档,那一档就会穿透到宿主页,而字已经被弹层强制成本域色。
 *
 * 实际发生过:raised / interactive 是后加进阶梯的两档(PR #981),当时没同步扩展弹层。
 * 五个 club-topic-* 组件用 bg-raised 当卡底、bg-interactive 当控件底、text-primary 当字,
 * 一旦挂在 merchant-light 宿主页上:
 *     卡 #E6E6E6 + 字 #F8F8F8 = 1.18:1
 *     控件底 #FFFFFF + 字 #F8F8F8 = 1.06:1     ← 白字压白底,完全看不见
 * 而暗宿主下同样的组合是 13.49:1,所以**单测、门禁、暗色截图全都发现不了**。
 *
 * 判据是白名单式的:玩家档 page{} 里有几个 --cy-color-bg-*,两个弹层域就必须各自覆盖几个。
 * 新增中性档时这条会立刻判红,逼你同步扩展弹层 —— 这正是上次漏掉的那一步。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 取某选择器块的正文(选择器行到配平的 }) */
function ruleBody(src, anchor) {
  const at = src.indexOf(anchor)
  assert.ok(at >= 0, `找不到选择器 ${anchor}`)
  const open = src.indexOf('{', at)
  let depth = 0, end = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  return src.slice(open + 1, end)
}

const bgKeys = (body) => [...new Set(
  (body.match(/^\s*(--cy-color-bg-[a-z0-9-]+)\s*:/gm) || [])
    .map((s) => s.trim().replace(/\s*:$/, '')),
)]

/** 弹层域必须覆盖玩家档 page{} 里的每一个中性面档 */
function findLadderGaps(baseBody, scopes) {
  const base = bgKeys(baseBody)
  assert.ok(base.length >= 5, `玩家档 page{} 只解析出 ${base.length} 个中性面档,解析器失效?`)
  const gaps = []
  for (const [what, body] of scopes) {
    const have = new Set(bgKeys(body))
    // bg-glass 由 --cy-sheet-bg 单独承担,弹层不必重映射它
    for (const k of base) {
      if (k === '--cy-color-bg-glass') continue
      if (!have.has(k)) gaps.push(`${what} 缺 ${k}`)
    }
  }
  return gaps
}

const scopes = () => {
  const sheet = read('components/cy/scene-sheet/index.wxss')
  return [
    ['.ss--player', ruleBody(sheet, '.ss--player {')],
    ['.ss--merchant', ruleBody(sheet, '.ss--merchant {')],
  ]
}

test('① 两个弹层域都覆盖到中性阶末端,不留穿透缺口', () => {
  const gaps = findLadderGaps(ruleBody(read('style/tokens.wxss'), '\npage {'), scopes())
  assert.deepEqual(gaps, [],
    '这些档会穿透到宿主页,而字已被弹层强制成本域色 —— 挂在异色宿主上就是白字压白底:\n' + gaps.join('\n'))
})

test('② 弹层内的 raised/interactive 走自己的 comp 出口,不直接引用全局暗端值', () => {
  const sheet = read('components/cy/scene-sheet/index.wxss')
  for (const scope of ['player', 'merchant']) {
    const body = ruleBody(sheet, `.ss--${scope} {`)
    assert.match(body, new RegExp(`--cy-color-bg-raised:\\s*var\\(--cy-comp-sheet-${scope}-raised\\)`),
      `.ss--${scope} 的 raised 必须走本域 comp 出口`)
    assert.match(body, new RegExp(`--cy-color-bg-interactive:\\s*var\\(--cy-comp-sheet-${scope}-interactive\\)`),
      `.ss--${scope} 的 interactive 必须走本域 comp 出口`)
    assert.match(body, new RegExp(`--cy-color-bg-surface-strong:\\s*var\\(--cy-comp-sheet-${scope}-surface-strong\\)`),
      `.ss--${scope} 的 surface-strong 必须走本域 comp 出口`)
  }
  const tokens = read('style/tokens.wxss')
  for (const name of ['player-raised', 'player-interactive', 'player-surface-strong',
                      'merchant-raised', 'merchant-interactive', 'merchant-surface-strong']) {
    assert.match(tokens, new RegExp(`--cy-comp-sheet-${name}:\\s*[^;]+;`), `tokens 缺 --cy-comp-sheet-${name}`)
  }
})

/* ---------- 负控 ---------- */

test('负控:弹层少覆盖一档必须判红', () => {
  const base = ruleBody(read('style/tokens.wxss'), '\npage {')
  const real = scopes()
  assert.deepEqual(findLadderGaps(base, real), [], '干净输入不该报')

  const victim = '--cy-color-bg-raised'
  const [what, body] = real[0]
  const mutated = body.replace(new RegExp(`^\\s*${victim}\\s*:[^;]+;.*$`, 'm'), '')
  assert.notEqual(mutated, body, '负控变异注入失败')
  assert.equal(bgKeys(mutated).includes(victim), false, `变异没真删掉 ${victim}`)
  const gaps = findLadderGaps(base, [[what, mutated], real[1]])
  assert.ok(gaps.some((g) => g.includes(victim)), `没抓到被删的 ${victim}:${gaps.join()}`)
})

test('负控:玩家档新增一个中性档而弹层没跟上,必须判红', () => {
  // 这一条模拟的正是 PR #981 当时的处境:阶梯长了一档,弹层没同步
  const base = ruleBody(read('style/tokens.wxss'), '\npage {') + '\n  --cy-color-bg-brandnew: #123456;\n'
  const gaps = findLadderGaps(base, scopes())
  assert.ok(gaps.length === 2 && gaps.every((g) => g.includes('--cy-color-bg-brandnew')),
    `新增档没被两个弹层域同时报出来:${gaps.join(' | ')}`)
})

test('负控:bg-glass 由 --cy-sheet-bg 承担,不该被误判成缺口', () => {
  // 合成数据要满足检查器自己的健全性下限(≥5 档),否则挂在那条断言上而不是在判据上
  const ladder = ['page', 'surface', 'surface-subtle', 'elevated', 'raised']
  const decl = (ks) => ks.map((k) => `  --cy-color-bg-${k}: #000;`).join('\n') + '\n'
  const base = decl([...ladder, 'glass'])
  const scope = [['x', decl(ladder)]]   // 覆盖了除 glass 外的全部
  assert.deepEqual(findLadderGaps(base, scope), [],
    'bg-glass 是显式豁免项,报它就是误伤')
})
