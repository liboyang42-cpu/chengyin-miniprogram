const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SELECTORS = require('../../scripts/selectors.json')
const { SHOTS } = require('../../scripts/shot-matrix.js')
const BASELINE = require('../../scripts/uiaudit/weak-anchor-baseline.json')

/**
 * 正向断言强度门禁(2026-08-19)。
 *
 * ★ 为什么必须有这一条:UI 全量复核批1 实测,144 行里 64 行的正向锚点是**页面根容器**
 *   或裸 `view` —— 页面只要渲染出来就命中,**永远不会红**。它比没有断言更坏:
 *   矩阵拍了、绿了、报告里写「已验」,而实际上什么都没验。实证后果:B32/D13/D16/E27
 *   四行画面全是错误态,矩阵声称 normal 内容态,status 一律判 ok。
 *
 * 与 coverage-gate 同一条纪律:**门禁只有一个方向 = 另一个方向永远不会红**。
 * shot-matrix 自带的体检查的是「矩阵引用了不存在的页」,查不出「断言弱到不会红」。
 *
 * 判据(可机器判、不靠人眼):一条锚点算「弱」,当它的每一个 selector 都落在
 * **该页恒渲染的外层包裹**上 —— 即从 wxml 顶部往下、直到第一个带 wx:if / wx:for 的标签
 * 为止的那些 class,以及裸标签选择器(view / page)。
 *
 * 白名单靠 weak-anchor-baseline.json 棘轮:**只许减不许增**。
 */

function routeOf(shot) {
  return String(shot.route || '').replace(/^\//, '').split('?')[0]
}

/**
 * 判一个 selector 在这张 wxml 里**能不能红**。
 *
 * 判据:该 selector 命中的元素里,只要**全部**都是「无条件渲染」的,它就是恒真锚点 ——
 * 页面渲染出来就命中,数据没了照样命中。只有当命中的元素挂在 wx:if / wx:elif / wx:for
 * 之下(自己带,或任一祖先带)时,这条断言才会随数据消失而变红。
 *
 * ⚠️ 裸标签要分两种:`view`/`block`/`text` 这类内置容器任何页面都有,恒真;
 *    `cy-empty` / `cy-error` / `cy-qr-voucher` 这类**组件标签**只在对应分支渲染,
 *    是强锚点 —— 第一版把「没有点号就算弱」一刀切,把它们全误判成弱(41 条假阳性)。
 */
const BUILTIN_TAGS = new Set([
  'view', 'block', 'text', 'image', 'scroll-view', 'swiper', 'swiper-item', 'page',
  'button', 'input', 'textarea', 'form', 'navigator', 'cover-view', 'canvas', 'map', 'video',
])

/** 把 wxml 走一遍,返回 (selector) => 是否存在「至少一个条件渲染」的命中元素。 */
function buildConditionalIndex(wxml) {
  const src = wxml.replace(/<!--[\s\S]*?-->/g, '')
  const conditionalHits = new Set()   // '.cls' / 'tag'
  const anyHits = new Set()
  const stack = []
  const tokenRe = /<\/([a-z][a-z0-9-]*)\s*>|<([a-z][a-z0-9-]*)\b([^>]*?)(\/?)>/g
  let m
  while ((m = tokenRe.exec(src))) {
    if (m[1]) { stack.pop(); continue }
    const tag = m[2]
    const attrs = m[3] || ''
    const selfClosing = m[4] === '/'
    const own = /\bwx:(if|elif|else|for)\b/.test(attrs)   // ⚠️ else 也是条件分支,漏了它会把 wx:else 里的节点当恒渲染
    const cond = own || stack.some(Boolean)
    const keys = [tag]
    const cls = /class="([^"{]*)/.exec(attrs)
    if (cls) cls[1].split(/\s+/).filter(Boolean).forEach((c) => keys.push('.' + c))
    keys.forEach((k) => { anyHits.add(k); if (cond) conditionalHits.add(k) })
    if (!selfClosing) stack.push(cond)
  }
  return { conditionalHits, anyHits }
}

/** 单个 selector 是否恒真(不会红)。 */
function isTautologicalSelector(sel, index) {
  const s = String(sel).trim()
  if (!s) return true
  // 复合选择器(带空格/>)超出本门禁能判的范围,按「不恒真」放行,由行为断言兜
  if (/[\s>]/.test(s)) return false
  if (BUILTIN_TAGS.has(s)) return true              // view/block/text… 任何页面都有,最弱
  // ⚠️ 页面 wxml 里根本没有这个 key ⇒ 它指的是**子组件内部**的节点(深链壳大量如此)。
  //    静态扫不到,不代表它弱 —— 一刀切判弱会造出 20+ 条假阳性(第二版栽在这)。
  if (!index.anyHits.has(s)) return false
  return !index.conditionalHits.has(s)              // 出现过,且每一处都无条件渲染 ⇒ 恒真
}

/** 一行的锚点:所有 selector 都恒真才算这一行弱。 */
function isWeakAnchor(selector, index) {
  return String(selector).split(',').map((x) => x.trim()).filter(Boolean)
    .every((x) => isTautologicalSelector(x, index))
}

function scan() {
  const byId = Object.fromEntries(SHOTS.map((s) => [s.id, s]))
  const weak = []
  Object.entries(SELECTORS).forEach(([id, want]) => {
    const shot = byId[id]
    if (!shot || shot.blocked) return
    const wxml = path.join(ROOT, routeOf(shot) + '.wxml')
    if (!fs.existsSync(wxml)) return
    const index = buildConditionalIndex(fs.readFileSync(wxml, 'utf8'))
    if (isWeakAnchor(want.selector, index)) {
      weak.push({ id, selector: want.selector, page: routeOf(shot) })
    }
  })
  return weak
}

test('弱锚点棘轮:只许减不许增(新增恒真断言必须显式改 baseline)', () => {
  const weak = scan()
  const allowed = new Set(BASELINE.weakIds)
  const added = weak.filter((w) => !allowed.has(w.id))
  assert.deepEqual(
    added.map((w) => `${w.id}(${w.page}) -> ${w.selector}`),
    [],
    '出现了新的恒真断言。要么把锚点改成该状态独有的内容节点,要么显式写进 weak-anchor-baseline.json 并说明理由',
  )
  assert.ok(
    weak.length <= BASELINE.count,
    `弱锚点条数只许减不许增:baseline=${BASELINE.count} 实际=${weak.length}`,
  )
})

test('baseline 不许留已经修好的行(修完必须回收,否则棘轮会松)', () => {
  const weak = new Set(scan().map((w) => w.id))
  const stale = BASELINE.weakIds.filter((id) => !weak.has(id))
  assert.deepEqual(stale, [], '这些行已经不弱了,请从 weak-anchor-baseline.json 里删掉')
})

test('★负控:把任一行的锚点换回恒渲染节点,门禁必须判它弱', () => {
  const byId = Object.fromEntries(SHOTS.map((x) => [x.id, x]))
  const victim = 'B27'                       // 本轮已改成 .oe-card 的行
  const shot = byId[victim]
  assert.ok(shot, '负控靶子不存在,锚点失效')
  assert.ok(!BASELINE.weakIds.includes(victim), '负控靶子不该在 baseline 里,否则这条负控没意义')
  const index = buildConditionalIndex(fs.readFileSync(path.join(ROOT, routeOf(shot) + '.wxml'), 'utf8'))

  assert.equal(isWeakAnchor(SELECTORS[victim].selector, index), false, '现锚点(.oe-card)不该被判弱')
  assert.equal(isWeakAnchor('.oe-page', index), true, '换回页面根容器 .oe-page 必须被判弱')
  assert.equal(isWeakAnchor('view', index), true, '裸标签 view 必须被判弱')
  // 组件标签要分两种:恒渲染的弱、只在分支里出现的强
  assert.equal(isWeakAnchor('cy-empty', index), false, '只在空态分支渲染的 cy-empty 是强锚点,不该被判弱')
})

test('★负控:wx:else 分支里的节点不许被当成恒渲染(第一版漏了 else)', () => {
  const index = buildConditionalIndex(`
    <view class="root">
      <view wx:if="{{a}}" class="branch-a"></view>
      <view wx:else class="branch-b"></view>
      <view class="always"></view>
    </view>`)
  assert.equal(isWeakAnchor('.branch-a', index), false)
  assert.equal(isWeakAnchor('.branch-b', index), false, 'wx:else 也是条件分支')
  assert.equal(isWeakAnchor('.root', index), true)
  assert.equal(isWeakAnchor('.always', index), true, '和分支同级但无条件 ⇒ 恒真')
})

test('★负控:页面 wxml 里根本没有的 key 不判弱(它指的是子组件内部)', () => {
  const index = buildConditionalIndex('<view class="shell"><cy-scene-x /></view>')
  assert.equal(isWeakAnchor('.id-item', index), false, '深链壳的正文在组件里,静态扫不到不等于弱')
  assert.equal(isWeakAnchor('.shell', index), true)
})

// ---------- 死锚点:比弱更糟 —— 永远匹配不到,那一行永远红 ----------
// C58 就是这么来的:ledger 重写后 wxml 不再有 .coop-settlement-list,
// 那条 class 只剩在 wxss 和一条单测里,而 selectors.json 没跟着改 ⇒ 该行永远红。
function allSourceText() {
  const out = []
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      if (e.name === 'node_modules' || e.name.startsWith('.')) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(wxml|wxss|js)$/.test(e.name) && !p.includes(path.sep + 'tests' + path.sep)) {
        out.push(fs.readFileSync(p, 'utf8'))
      }
    })
  }
  walk(ROOT)
  return out.join('\n')
}

function deadAnchors(sourceText) {
  const dead = []
  Object.entries(SELECTORS).forEach(([id, want]) => {
    String(want.selector).split(',').map((x) => x.trim()).filter(Boolean).forEach((sel) => {
      if (!sel.startsWith('.')) return
      if (/[\s>]/.test(sel)) return                    // 后代选择器不判
      const parts = sel.slice(1).split('.')             // 复合 .a.b:逐段判
      parts.forEach((cls) => {
        if (!cls) return
        const esc = cls.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
        const re = new RegExp('(^|[\\s"\'{(,])' + esc + '($|[\\s"\'}),:.])')
        if (!re.test(sourceText)) dead.push(`${id} -> .${cls}`)
      })
    })
  })
  return dead
}

test('★死锚点棘轮:只许减不许增(锚点在全仓源码里必须真的存在)', () => {
  const dead = deadAnchors(allSourceText())
  const allowed = new Set(BASELINE.deadAnchors || [])
  const added = dead.filter((d) => !allowed.has(d))
  assert.deepEqual(added, [], '出现了新的死锚点:wxml 改了、selectors.json 没跟。这一行会永远红,而「永远红」和「永远绿」一样没有信息')
  assert.ok(dead.length <= (BASELINE.deadAnchors || []).length, '死锚点条数只许减不许增')
})

test('★负控:塞一条全仓不存在的 class,死锚点门禁必须红', () => {
  const dead = deadAnchors('<view class="real-one"></view>')
  assert.ok(dead.length > 0, '构造出的死锚点没被识别,门禁失效')
  const stillAlive = deadAnchors('<view class="real-one"></view>').filter((d) => d.includes('.real-one'))
  assert.deepEqual(stillAlive, [], '源码里真实存在的 class 不该被误判成死锚点')
})
