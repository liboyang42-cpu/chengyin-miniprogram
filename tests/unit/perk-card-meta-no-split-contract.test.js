/**
 * 权益卡片元信息:一条事实不许被拆到两行(CU-M-172)
 *
 * 走查:合作经营 → 常备权益,卡片把「零售价 ¥32 · 成本 ¥12 · 可接待 200 份 · 至」
 * 挤在同一条 text 里,日期 2100-01-01 独自换到下一行,「至」挂在上一行末尾 ——
 * 读起来像被截断。
 *
 * 根因不是间距,是**承载单位**:四档事实写在同一个自然折行的 <text> 里,
 * 折行点只认空格,而分隔点「·」和「至」恰好是写在文案里的空格旁字符 ——
 * 于是排版可以在「· 至」之后断,把日期单独甩下去。修法是换承载单位:
 * 一档一个 white-space:nowrap 的项,外层 flex-wrap 排不开就整档换行,
 * 「有效期至 2100-01-01」永远是一个整体(与 pages/club/event-ops 的 .roster-summary 同形)。
 *
 * 所以判据锁的是这条不变量,不是字面文案:
 *   ① 外层必须是可换行的 flex 行,不再是一条自然折行的 text;
 *   ② 每一项自带 nowrap,且标签与值写在同一个节点里(缺一样都会再次被拆开);
 *   ③ 分隔符不得再藏在视图模型的字符串里 —— 间距归 layout 管,字符串只放事实。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const DIR = 'pages/merchant/decor/perks'

/** 取 .dp-meta 那一段标记(从开标签到配对的 </view>) */
function metaBlock(wxml) {
  const open = wxml.match(/<view class="dp-meta">([\s\S]*?)<\/view>/)
  assert.ok(open, '.dp-meta 不再是带 class="dp-meta" 的 <view>,判据锚点漂了')
  return open[1]
}

function ruleBody(wxss, selector) {
  const re = new RegExp(`(^|\\n)\\s*\\.${selector}\\s*\\{([^}]*)\\}`, 'm')
  const m = wxss.match(re)
  assert.ok(m, `.${selector} 规则不见了`)
  return m[2]
}

const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'))
  return m ? m[1].trim() : null
}

/**
 * 一条事实要"整档换行",必须同时满足:
 * 外层是可换行的 flex 行 + 本项 nowrap + 标签与值在同一个节点。
 * 少任何一条,排版都还能在中间断开。
 */
function assertMetaCannotSplit(wxml, wxss) {
  const outer = ruleBody(wxss, 'dp-meta')
  assert.equal(decl(outer, 'display'), 'flex', '.dp-meta 必须靠 flex 排布事实,不能回退成一条自然折行的文本')
  assert.equal(decl(outer, 'flex-wrap'), 'wrap', '.dp-meta 排不开时必须整档换行,而不是溢出或裁掉')

  const item = ruleBody(wxss, 'dp-meta-item')
  assert.equal(decl(item, 'white-space'), 'nowrap', '.dp-meta-item 不 nowrap,档内还能被拆开——修的就是这个')

  const inner = metaBlock(wxml)
  const items = [...inner.matchAll(/<text class="dp-meta-item"[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].trim())
  assert.equal(items.length, 4, `.dp-meta 里应有 4 档事实,实得 ${items.length}:\n${inner}`)

  // 有效期是走查点名的那一档:标签「有效期至」和值必须在同一个节点里,不能只留一个裸日期。
  const expiry = items.find((t) => t.includes('item.validText'))
  assert.ok(expiry, '有效期这一档不见了')
  assert.ok(/有效期至\s*\{\{item\.validText\}\}/.test(expiry), `有效期必须是「标签 + 值」的完整片段,实得:${expiry}`)
  assert.ok(!/^\s*[·・]/.test(expiry), '分隔点不得再写进文案 —— 间距由 layout 的 gap 供给')
  items.forEach((t) => assert.ok(!/[·]/.test(t), `事实串里混进了分隔点:${t}`))
}

test('常备权益卡片:四档事实各自成块,不会被拆到两行', () => {
  assertMetaCannotSplit(read(`${DIR}/index.wxml`), read(`${DIR}/index.wxss`))
})

test('负控:外层退回一条自然折行的 text 必须判红', () => {
  const mutated = read(`${DIR}/index.wxss`).replace(/(\.dp-meta \{[^}]*?)display: flex/, '$1display: block')
  assert.notEqual(mutated, read(`${DIR}/index.wxss`), '变异锚点漂了,负控本身是假的')
  assert.throws(() => assertMetaCannotSplit(read(`${DIR}/index.wxml`), mutated), assert.AssertionError)
})

test('负控:项不再 nowrap 必须判红', () => {
  const mutated = read(`${DIR}/index.wxss`).replace('.dp-meta-item { white-space: nowrap; }', '.dp-meta-item { }')
  assert.notEqual(mutated, read(`${DIR}/index.wxss`), '变异锚点漂了,负控本身是假的')
  assert.throws(() => assertMetaCannotSplit(read(`${DIR}/index.wxml`), mutated), assert.AssertionError)
})

test('负控:把日期降成一个没有标签的裸值必须判红(正是走查读到的那个形态)', () => {
  const mutated = read(`${DIR}/index.wxml`).replace(
    '<text class="dp-meta-item" wx:if="{{item.validText}}">有效期至 {{item.validText}}</text>',
    '<text class="dp-meta-item" wx:if="{{item.validText}}">{{item.validText}}</text>',
  )
  assert.notEqual(mutated, read(`${DIR}/index.wxml`), '变异锚点漂了,负控本身是假的')
  assert.throws(() => assertMetaCannotSplit(mutated, read(`${DIR}/index.wxss`)), assert.AssertionError)
})

test('负控:把分隔点重新写回文案必须判红', () => {
  const mutated = read(`${DIR}/index.wxml`).replace(
    '>零售价 {{money.amount(item.retailValue)}}<',
    '>· 零售价 {{money.amount(item.retailValue)}}<',
  )
  assert.notEqual(mutated, read(`${DIR}/index.wxml`), '变异锚点漂了,负控本身是假的')
  assert.throws(() => assertMetaCannotSplit(mutated, read(`${DIR}/index.wxss`)), assert.AssertionError)
})

// ③ 视图模型侧:份数那一档以前是 ' · 可接待 20 份',分隔符被塞进了字符串。
// 排版换成 gap 之后留着它,这一档单独换行时会以点开头。四档必须同为"裸值"。
test('视图模型:quotaText 不再走私分隔符,与其余三档同为裸值', () => {
  const src = read(`${DIR}/index.js`)
  const m = src.match(/quotaText:\s*[^\n]*\?\s*'([^']*)'\s*\+/)
  assert.ok(m, 'quotaText 的字面前缀锚点漂了,判据失效')
  assert.equal(m[1], '可接待 ', `前缀应只剩中文标签,实得:${JSON.stringify(m[1])}`)
})

test('负控:把「 · 」前缀加回 quotaText 必须判红', () => {
  const src = read(`${DIR}/index.js`)
  const mutated = src.replace("quotaText: Number.isInteger(p.quota) && p.quota >= 0 ? '可接待 '", "quotaText: Number.isInteger(p.quota) && p.quota >= 0 ? ' · 可接待 '")
  assert.notEqual(mutated, src, '变异锚点漂了,负控本身是假的')
  const m = mutated.match(/quotaText:\s*[^\n]*\?\s*'([^']*)'\s*\+/)
  assert.equal(m[1], ' · 可接待 ')
  assert.notEqual(m[1], '可接待 ', '撤掉修复却仍满足判据,说明上面那条是空转')
})
