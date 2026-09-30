const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const SRC = fs.readFileSync(path.join(ROOT, 'scripts/shot-matrix.js'), 'utf8')

// C23/C24 教训:夹具写了 topicLoaded:true 却没注 info,页面渲染出一片空的深色底,
// 被当成「主题正文全黑」的渲染 bug 追了很久 —— 而闸根本不在页面里,在夹具里。
//
// 一个 `*Loaded: true` / `loaded: true` 的夹具,是在向截图断言「这一屏有内容」。
// 如果同一条夹具没有任何内容字段,那张图证明的只是「壳能渲染」,不是「内容能渲染」,
// 却会被当成后者收进相册。空的成功态比没有截图更坏。
const ROW = /\[\s*'([A-Z]\d+[a-z]?)',\s*'([^']+)',\s*'([^']*)',\s*'[^']*',\s*'[^']*',\s*(\{[\s\S]*?\}),\s*(?:undefined|\[)/g

function rows() {
  const out = []
  let m
  const re = new RegExp(ROW)
  while ((m = re.exec(SRC))) out.push({ id: m[1], file: m[2], route: m[3], fixture: m[4] })
  return out
}

/** 状态/布局键不算内容 —— 它们只证明壳能渲染 */
function stripStatusKeys(fixture) {
  return fixture
    .replace(/\b\w*[Ll]oaded\s*:\s*true/g, '')
    .replace(/\b(loadError|missingTopicId|routeReady|isTabSticky|loading|refreshing|submitting)\s*:\s*(true|false)/g, '')
    .replace(/\b(statusBarHeight|navBarHeight|id|activeTab)\s*:\s*[^,}]+/g, '')
}

/** ⚠️ 空的 {} / [] 不算内容 —— 注一个空数组跟没注一样,页面照样渲染出空壳。
 *  (2026-08-25:master 的 C23 就是 detailFacts: [] / ratingRows: [],旧判据放它过去了。) */
const NON_EMPTY_LITERAL = /:\s*(\{(?!\s*\})|\[(?!\s*\])|'[^']+')/

/** 内容也可以放在本文件的共享常量里(如 info: TOPIC_SHOT_INFO)。
 *  引用只在该常量**真的定义了非空内容**时才算数,否则换个名字就能绕过判据。 */
function constHasSubstance(name) {
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*([\\s\\S]*?)\\n(?=const |function |module|test|$)').exec(SRC)
  return Boolean(m) && NON_EMPTY_LITERAL.test(m[1])
}

function hasSubstance(fixture) {
  const stripped = stripStatusKeys(fixture)
  if (NON_EMPTY_LITERAL.test(stripped)) return true
  for (const m of stripped.matchAll(/:\s*([A-Z][A-Z0-9_]{2,})\b/g)) {
    if (constHasSubstance(m[1])) return true
  }
  return false
}

/**
 * permission / feature-unavailable 这类终态的正文写死在 WXML 的 cy-empty 上，
 * 不需要再伪造一份 data 文案。只有夹具把布尔闸置为 true，且对应页面确实
 * 用该闸渲染了带非空 title/sub 的可见状态时，才算有实质内容。
 */
function hasVisibleStaticTerminalState(route, fixture) {
  const pagePath = String(route || '').replace(/^\//, '').split('?')[0]
  const wxmlPath = path.join(ROOT, pagePath + '.wxml')
  if (!fs.existsSync(wxmlPath)) return false
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const enabledFlags = [...fixture.matchAll(/\b([A-Za-z]\w*)\s*:\s*true\b/g)].map((m) => m[1])
  return enabledFlags.some((flag) => {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const visibleState = new RegExp(
      `<cy-(?:empty|error)\\b[^>]*wx:(?:if|elif)="\\{\\{${escaped}\\}\\}"[^>]*(?:title|sub)="[^"]+"`,
    )
    return visibleState.test(wxml)
  })
}

test('声称「已加载」的夹具必须真的注入内容,不能只注一个 loaded 标志', () => {
  const hollow = []
  for (const r of rows()) {
    if (!/\b\w*[Ll]oaded\s*:\s*true/.test(r.fixture)) continue
    if (!hasSubstance(r.fixture) && !hasVisibleStaticTerminalState(r.route, r.fixture)) {
      hollow.push(`${r.id} (${r.route}) — 夹具:${r.fixture.replace(/\s+/g, ' ').slice(0, 110)}`)
    }
  }
  assert.deepEqual(hollow, [],
    '这些夹具声称已加载却没注任何内容,拍出来是空壳截图:\n  ' + hollow.join('\n  '))
})

test('★负控:空的 [] / {} 不能冒充内容', () => {
  assert.equal(hasSubstance("{ topicLoaded: true, detailFacts: [], ratingRows: [] }"), false,
    '空数组必须判成空壳,否则「注了字段」就成了橡皮图章')
  assert.equal(hasSubstance("{ topicLoaded: true, detailFacts: [{ key: '时长' }] }"), true,
    '负控锚点失效:非空数组本来就该算内容')
})

test('★负控:引用一个不存在/空内容的常量不能冒充内容', () => {
  assert.equal(hasSubstance('{ topicLoaded: true, info: NO_SUCH_CONSTANT }'), false,
    '引用查无此名的常量必须判红')
  assert.equal(hasSubstance('{ topicLoaded: true, info: TOPIC_SHOT_INFO }'), true,
    '负控锚点失效:TOPIC_SHOT_INFO 应当真有内容')
})

test('★负控:只有页面真实渲染的静态终态才可替代夹具内容', () => {
  // 2026-09-09 原锚点 pages/club/membership/setting 随会费整条删除,换成同样
  // 「布尔闸 + 写死在 cy-empty 上的正文」的商家客户页 —— 负控锚点必须是活页面。
  const route = '/pages/merchant/customer/index'
  assert.equal(hasVisibleStaticTerminalState(route, '{ loaded: true, noPermission: true }'), true,
    '商家客户页的 noPermission 分支有可见 cy-empty 正文，应视为实质终态')
  assert.equal(hasVisibleStaticTerminalState(route, '{ loaded: true, ghostPermission: true }'), false,
    '夹具自造但 WXML 未消费的状态不能冒充内容')
})

test('★负控:把 C23 的内容字段拿掉,检查器必须判红', () => {
  const all = rows()
  const c23 = all.find((r) => r.id === 'C23')
  assert.ok(c23, '前提:矩阵里有 C23')
  // info 可能是内联字面量,也可能是共享常量(master 用 TOPIC_SHOT_INFO)
  assert.match(c23.fixture, /info\s*:\s*(\{|[A-Z][A-Z0-9_]*)/, '前提:C23 现在注了 info')
  assert.equal(hasSubstance(c23.fixture), true, '前提:C23 现在是有内容的')
  const stripped = c23.fixture
    .replace(/info\s*:\s*(\{[\s\S]*?\}|[A-Z][A-Z0-9_]*),\s*/, '')
    .replace(/detailFacts[\s\S]*?\],\s*/, '')
    .replace(/ratingText[^,]*,\s*/, '').replace(/ratingTotal[^,}]*/, '')
  assert.equal(hasSubstance(stripped), false,
    '摘掉内容后判据必须认为它是空壳,否则上面那条断言是橡皮图章')
})
