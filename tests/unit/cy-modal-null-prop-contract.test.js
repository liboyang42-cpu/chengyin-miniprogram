'use strict'

/* cy-modal 空值传参契约(2026-09-15)
 *
 * 病(开发者工具控制台实拍):components/cy/modal/index 反复收到 title / content /
 * confirmText = null、consequences 非数组,微信报 type-uncompatible。现场集中在
 * 挂了 cy-modal-host 的页面(商家首页 loadMerchantConsole、协作邀请页…),因为 host
 * 内嵌了 cy-danger-confirm —— 它的 <cy-modal> 三块模板把 `{{action.title}}` 这类表达式
 * 直接绑进子组件属性,而 action 的初值 / 收起后都是 null。
 *
 * 关键语义(不是猜测):WXML 里对 null 取成员不抛错,但会把 **null 原样**传进组件属性
 * (不是 undefined 走默认值),于是属性类型校验告警。pages/agreement/index.wxml:11
 * 记着 2026-07-30 控制台实拍的同类现场,当时的修法就是 `doc ? doc.title : ''`。
 *
 * 契约:绑进 cy-modal 的表达式,基对象初值为 null 时必须显式三元兜底 ——
 * 字符串属性给 '',数组属性给 []。不改 cy-modal 对外合同,修在调用方。
 *
 * 负控(本文件自带,证明判据真的能红):
 *   ①把 danger-confirm 的 `action ? action.title : ''` 改回 `action.title`,
 *     nullRiskBindings 必须报红(下方逐条变异验证);
 *   ②把 modal-host 的 `String(opts.title == null ? '' : opts.title)` 拆掉,
 *     归一化用例的等价负控必须拿到 null(证明断言不是恒真)。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..', '..')
const SKIP = /(^|\/)(node_modules|miniprogram_npm|tests|scripts)(\/|$)/
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

function walkWxml(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (SKIP.test(p)) continue
    if (e.isDirectory()) walkWxml(p, out)
    else if (e.name.endsWith('.wxml')) out.push(p)
  }
  return out
}

// 引号感知地取一个标签的全文:属性值里的 `>`(如 `{{a > b}}`)不当作标签结束。
function readTag(src, start) {
  let i = start
  let quote = false
  while (i < src.length) {
    const c = src[i]
    if (c === '"') quote = !quote
    else if (c === '>' && !quote) return src.slice(start, i + 1)
    i += 1
  }
  return src.slice(start)
}

const ATTR = /([A-Za-z][\w:-]*)="([^"]*)"/g

// 抓出 src 里所有 <cy-modal …>(不含 cy-modal-host;后者是 `-` 不是空格/斜杠)。
function modalTags(src) {
  const out = []
  const re = /<cy-modal(?=[\s/>])/g
  let m
  while ((m = re.exec(src))) {
    const text = readTag(src, m.index)
    const attrs = []
    ATTR.lastIndex = 0
    let a
    while ((a = ATTR.exec(text))) attrs.push([a[1], a[2]])
    out.push({ line: src.slice(0, m.index).split('\n').length, attrs })
  }
  return out
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

// 取 `key { … }` 的块(字符串/注释先剥掉,避免里面的括号干扰计数)。
function blockAfter(src, key) {
  const at = src.indexOf(key)
  if (at < 0) return ''
  const open = src.indexOf('{', at)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return ''
}

// 同目录 js 的 data{} 里初值为 null 的顶层字段(正是会把 null 传下去的那类基对象)。
function nullableDataBases(js) {
  const clean = stripComments(js)
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
  const data = blockAfter(clean, 'data:')
  const bases = new Set()
  const re = /([A-Za-z_$][\w$]*)\s*:\s*null\b/g
  let m
  while ((m = re.exec(data))) bases.add(m[1])
  return bases
}

// 判据(启发式棘轮,不是表达式求值器):表达式里对 nullable base 做了成员访问
// (base.xxx / base.xxx.yyy),就必须有对这个成员链自己的三元兜底 —— `base ? …`
// 或 `base.x ? …`。`|| ''` 这类其他兜底不在支持之列(现状也不用,判红时改成三元即可)。
function nullRiskBindings(src, nullableBases) {
  const findings = []
  for (const tag of modalTags(src)) {
    for (const [name, raw] of tag.attrs) {
      const m = /^\{\{([\s\S]*)\}\}$/.exec(raw.trim())
      if (!m) continue
      const expr = m[1]
      for (const base of nullableBases) {
        const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const guarded = new RegExp(`\\b${esc}(?:\\.[\\w$]+)*\\s*\\?`).test(expr)
        const usesMember = new RegExp(`\\b${esc}\\s*\\.`).test(expr)
        if (!guarded && usesMember) findings.push({ line: tag.line, prop: name, expr: expr.trim() })
      }
    }
  }
  return findings
}

test('全仓 cy-modal 属性绑定:基对象初值为 null 的成员访问必须三元兜底', () => {
  const files = walkWxml(ROOT)
  assert.ok(files.length > 100, `只扫到 ${files.length} 个 wxml,扫描范围塌了`)
  const bad = []
  let scannedTags = 0
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    if (!src.includes('<cy-modal')) continue
    scannedTags += modalTags(src).length
    const jsPath = f.replace(/\.wxml$/, '.js')
    if (!fs.existsSync(jsPath)) continue
    const bases = nullableDataBases(fs.readFileSync(jsPath, 'utf8'))
    if (!bases.size) continue
    for (const hit of nullRiskBindings(src, bases)) {
      bad.push(`${rel(f)}:${hit.line}: ${hit.prop}="{{${hit.expr}}}"`)
    }
  }
  // 扫描器必须真的看到了 cy-modal(扫范围为 0 的绿是假绿)。
  // 2026-09-15 集成总线:本文件原定 >=20,是在「弹窗合同第 3 轮」(6462f7fc7)之前的基线上标定的。
  //   r3 把 pages/merchant/decor 的整页失败弹窗改成零按钮 fail 半屏并删掉那只 <cy-modal>,
  //   合并树因此只剩 19 只。逐文件比对过 20→19 的差集恰好只有 decor 这一只(其余 17 个文件
  //   与 danger-confirm 的 3 只一只不少),下面的 bad 实质断言仍全绿,故按实测把地板调到 19。
  // 2026-09-18 UI-21:cy-danger-confirm 第三段结果回执按稿 txQoyVyK 356:4992 改走 cy-result-sheet,
  //   删掉 danger-confirm 里那只 done 用的 <cy-modal>(确认 / 失败两只仍在),19→18,差集只有这一只。
  //   ⚠️ 这是防「扫描范围塌成 0」的活性地板,只准显式改小并写明差在哪一只。
  assert.ok(scannedTags >= 18, `只扫到 ${scannedTags} 个 cy-modal 标签,扫描范围塌了`)
  assert.deepEqual(bad, [],
    `这些绑定会把 null 传进 cy-modal 属性(微信 type-uncompatible):\n${bad.join('\n')}`)
})

test('cy-danger-confirm:四个可空属性都落了默认值(字符串给空串、数组给空数组)', () => {
  const src = read('components/cy/danger-confirm/index.wxml')
  // 第一块 cy-modal 是「确认」段(唯一绑 action.* 的那块);后两块是结果卡 / 失败卡。
  const attrs = modalTags(src)[0].attrs
  const expect = [
    ['title', 'title', "''"],
    ['content', 'content', "''"],
    ['confirm-text', 'confirmText', "''"],
    ['consequences', 'consequences', '[]'],
  ]
  for (const [prop, member, fallback] of expect) {
    const hits = attrs.filter(([n]) => n === prop)
    assert.equal(hits.length, 1, `cy-danger-confirm 应恰好有一处 ${prop} 绑定`)
    assert.equal(hits[0][1].replace(/\s+/g, ' ').trim(),
      `{{action ? action.${member} : ${fallback}}}`.replace(/\s+/g, ' ').trim(),
      `${prop} 必须写成 action ? … : ${fallback} —— 直接把 action.xxx 绑下去,action=null 时会把 null 传进组件`)
  }
})

function loadComponent(jsFile) {
  let captured = null
  const sandbox = {
    Component: (o) => { captured = o },
    Behavior: (o) => o,
    getApp: () => ({ globalData: {} }),
    wx: {},
    console,
    module: { exports: {} },
  }
  vm.runInNewContext(fs.readFileSync(jsFile, 'utf8'), sandbox, { filename: jsFile })
  return captured
}

function loadHost() {
  const captured = loadComponent(path.join(ROOT, 'components/cy/modal-host/index.js'))
  return Object.assign({}, captured.methods, {
    data: Object.assign({}, captured.data),
    setData(p) { Object.assign(this.data, p) },
  })
}

test('cy-modal-host:null / 缺省参数在 host 层就被归一化,不进 cy-modal 属性', () => {
  const host = loadHost()
  host.open({ title: null, content: null, confirmText: null, cancelText: null, placeholderText: null })
  assert.equal(host.data.title, '')
  assert.equal(host.data.content, '')
  assert.equal(host.data.confirmText, '确定')
  assert.equal(host.data.cancelText, '取消')
  assert.equal(host.data.placeholderText, '')
  for (const key of ['title', 'content', 'confirmText', 'cancelText', 'placeholderText']) {
    assert.equal(typeof host.data[key], 'string', `${key} 必须归一化成字符串,不许落 null`)
  }
  // 缺省(options 为空)走 cy-modal 初始 data 的默认值,同样不许 null。
  const blank = loadHost()
  blank.open({})
  assert.deepEqual([blank.data.title, blank.data.content, blank.data.confirmText], ['', '', '确定'])
  assert.equal(blank.open(undefined), undefined, 'open() 无参也必须不抛(返回 undefined 即可)')
})

// ===== 负控:判据和断言都必须能变红 =====
test('负控:nullRiskBindings 对旧写法报红、对现文件放行', () => {
  // ① 2026-09-15 之前的真写法(修复前源码),必须全部报红
  const before = [
    '<cy-modal title="{{action.title}}" content="{{action.content}}"',
    '  consequences="{{action.consequences}}" confirm-text="{{action.confirmText}}" />',
  ].join('\n')
  const beforeHits = nullRiskBindings(before, new Set(['action']))
  assert.deepEqual(beforeHits.map((h) => h.prop).sort(), ['confirm-text', 'consequences', 'content', 'title'],
    '旧写法必须被四条全数抓到')

  // ② 现文件必须放行(不是靠"没扫到"绿:先确认它真的含 action 成员访问)
  const now = read('components/cy/danger-confirm/index.wxml')
  assert.match(now, /action\.title/, '现文件应仍存在 action 成员访问,否则本条是空扫描')
  assert.deepEqual(nullRiskBindings(now, new Set(['action'])), [])

  // ③ 逐条变异:把四处兜底分别拆掉改回旧写法,判据必须各自报红
  //    (证明判的是活文件,不只是 fixture)
  const mutations = [
    ["action ? action.title : ''", 'action.title'],
    ["action ? action.content : ''", 'action.content'],
    ["action ? action.consequences : []", 'action.consequences'],
    ["action ? action.confirmText : ''", 'action.confirmText'],
  ]
  for (const [from, to] of mutations) {
    const mutated = now.replace(from, to)
    assert.notEqual(mutated, now, `变异没生效: ${from}`)
    const hits = nullRiskBindings(mutated, new Set(['action']))
    assert.equal(hits.length, 1, `兜底被拆掉后必须报红: ${from}`)
  }
})

test('负控:host 归一化被拆掉后,同一断言必须拿到 null(证明断言不是恒真)', () => {
  const src = read('components/cy/modal-host/index.js')
  const mutated = src.replace("String(opts.title == null ? '' : opts.title)", 'opts.title')
  assert.notEqual(mutated, src, '归一化变异没生效')
  const file = path.join(require('node:os').tmpdir(), `cy-modal-host-mutated-${process.pid}.js`)
  fs.writeFileSync(file, mutated)
  try {
    const captured = loadComponent(file)
    const host = Object.assign({}, captured.methods, {
      data: Object.assign({}, captured.data),
      setData(p) { Object.assign(this.data, p) },
    })
    host.open({ title: null })
    assert.equal(host.data.title, null, '拆掉归一化后 title 必须原样落下 null —— 断言该红就得红')
  } finally {
    fs.unlinkSync(file)
  }
})
