/* z 分档天花板契约(2026-09-02)
 *
 * style/tokens.wxss 把层级分了七档,最高是 --cy-z-celebrate(990)。
 * 任何写死的 z-index 字面量一旦越过它,就等于**退出了这套分档**:
 * cy-advanced-game 的遮罩曾是 1800、面板 1801,结果结算、协议这类外壳弹窗
 * (--cy-z-modal 900)反而被游戏面板盖住,而分档表本身完全看不出这件事。
 *
 * 判据是白名单式的:**只有「不超过天花板」才算通过**,拿不准的一律判红。
 * 8 处历史越档冻结进 LEGACY 基线,它只能减不能加 —— 新增一处即红。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SCAN_DIRS = ['components', 'pages', 'style']

/* 冻结基线:合本契约时已存在的越档。每条都是页面自己的吸底/浮层,
 * 改它们要逐页判断堆叠意图且需截图复核,不在本 PR 范围。
 * ⚠️ 只能减不能加。修好一处就把它从这里删掉。 */
const LEGACY = new Set([
  // 2026-09-02:9 条越档**全部清零** —— 本轮逐条判了堆叠意图并改成读 token:
  //   baoming `.address-popup`(1000/1001)→ sheet 档:它是底部地址选择弹层。
  //     ⚠️ 同页 paysuc-layer 读 --cy-z-modal(900),改完地址弹层在它之下 ——
  //     两者不会同屏(选地址在报名前,成功浮层在支付后)。
  //   square `.ap-mask/.ap-gen`(1000/1100)→ sheet 档:同为底部选择弹层。
  //   fabu `.modal-mask/.multi-select-modal`(999/1000)与 publish/activity
  //     `.modal-mask`(999)→ modal 档:居中弹窗。
  //   topic/index 与 merchantinfo 的 `.sticky-tab-wrapper.sticky`(999)→ --cy-z-sticky。
  //     这两条最坏:**页内吸顶 tab 比所有弹窗都高**,任何 sheet/modal/toast 弹出来
  //     都会被这条 tab 压住一截,而且零报错。吸顶条还必须低于 nav(90),
  //     否则会盖住 cy-nav-bar(见 tokens.wxss 那段说明)。
  // 顺带(不在本契约范围、但同类):play 的 .rolemask/.rolecard 原为 960/961,
  //   夹在 toast(950)与 celebrate(990)之间 —— 会压住 toast、又被庆祝层压住,
  //   两头都不是有意设计。已改读 modal 档;本页其它浮层最高 210,相对顺序不变。
])

function ceilingOf(tokensSrc) {
  const m = /--cy-z-celebrate:\s*(\d+)/.exec(tokensSrc)
  assert.ok(m, '读不到 --cy-z-celebrate —— 分档表被改名了?')
  return Number(m[1])
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out) }
    else if (e.name.endsWith('.wxss')) out.push(p)
  }
  return out
}

/** 扫出所有超过天花板的 z-index 字面量,返回 "相对路径:值" 列表 */
function findOverCeiling(ceiling, files) {
  const hits = []
  for (const [rel, src] of files) {
    for (const m of src.matchAll(/z-index:\s*(\d+)/g)) {
      if (Number(m[1]) > ceiling) hits.push(`${rel}:${m[1]}`)
    }
  }
  return hits
}

const realFiles = () => SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
  .map((p) => [path.relative(ROOT, p), fs.readFileSync(p, 'utf8')])

test('没有任何 z-index 字面量越过 --cy-z-celebrate(冻结基线之外)', () => {
  const ceiling = ceilingOf(fs.readFileSync(path.join(ROOT, 'style/tokens.wxss'), 'utf8'))
  const over = findOverCeiling(ceiling, realFiles())
  const news = over.filter((h) => !LEGACY.has(h))
  assert.deepEqual(
    news, [],
    `这些 z-index 越过了分档天花板 ${ceiling},会盖住 modal/toast/celebrate:\n${news.join('\n')}\n` +
    '改成 var(--cy-z-sheet) / --cy-z-modal 等分档 token,别写字面量。',
  )
})

test('冻结基线只能减不能加:LEGACY 里已修好的条目必须及时删掉', () => {
  const ceiling = ceilingOf(fs.readFileSync(path.join(ROOT, 'style/tokens.wxss'), 'utf8'))
  const over = new Set(findOverCeiling(ceiling, realFiles()))
  const stale = [...LEGACY].filter((h) => !over.has(h))
  assert.deepEqual(
    stale, [],
    `这些越档已经修好了,但还挂在 LEGACY 基线上 —— 基线会因此对新问题失效:\n${stale.join('\n')}`,
  )
})

test('负控:新增一处越档必须判红', () => {
  const ceiling = 990
  const clean = [['components/cy/x/index.wxss', '.a { z-index: var(--cy-z-sheet); }']]
  assert.deepEqual(findOverCeiling(ceiling, clean), [], '干净输入不该报')

  const mutated = [['components/cy/x/index.wxss', '.a { z-index: 1800; }']]
  const hits = findOverCeiling(ceiling, mutated)
  assert.deepEqual(hits, ['components/cy/x/index.wxss:1800'], '检查器没抓到注入的越档')
  assert.equal(LEGACY.has(hits[0]), false, '注入值不该恰好落在基线里,否则这条负控是假的')
})

test('负控:天花板本身被调高必须体现在判据里(不是写死 990)', () => {
  assert.equal(ceilingOf('--cy-z-celebrate: 1234;'), 1234)
  assert.deepEqual(
    findOverCeiling(1234, [['x.wxss', '.a { z-index: 1000; }']]), [],
    '天花板抬高后,原本越档的值应当不再判红 —— 说明判据真的读的是 token 不是常量',
  )
})

test('负控:cy-advanced-game 必须已经归位到分档 token', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/play/components/advanced-game/index.wxss'), 'utf8')
  assert.doesNotMatch(src, /z-index:\s*18\d\d/, 'advanced-game 又写回 1800/1801 了')
  assert.match(src, /z-index:\s*var\(--cy-z-sheet\)/, 'advanced-game 遮罩必须用 --cy-z-sheet')
})
