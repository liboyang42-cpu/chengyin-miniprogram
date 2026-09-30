'use strict'

/* 2026-09-15 审查C · null 兜底(同 modal-null-0915 / 43ecd817e 的三元写法)
 *
 * 病:pages/club/topic-detail/index.js 的 data.setting 初值是 null,而 index.wxml 把
 * `setting.topicName` 直接绑进 cy-club-topic-end-confirm 的 topic-name。WXML 对 null
 * 取成员不报错,但会把 **null 原样**传给子组件属性(不是 undefined 走默认值),与
 * 2026-09-15 cy-modal 控制台实拍(type-uncompatible)同型;也正因如此,组件自己的
 * String 默认值救不了这条。
 *
 * 契约:绑给组件的属性,基对象初值为 null 时成员访问必须显式三元兜底(字符串给 '');
 * 判据扫描活文件与变异源码各跑一遍 —— 负控必须能在旧写法上拿到命中。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const WXML = 'pages/club/topic-detail/index.wxml'
const JS = 'pages/club/topic-detail/index.js'
const COMPONENT = 'cy-club-topic-end-confirm'
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

// 同目录 js 的 data{} 块里初值为 null 的顶层字段(正是会把 null 传下去的那类基对象)
function nullableDataBases(js) {
  const clean = stripComments(js)
  const at = clean.indexOf('data:')
  const open = at >= 0 ? clean.indexOf('{', at) : -1
  if (open < 0) return new Set()
  let depth = 0
  let end = clean.length - 1
  for (let i = open; i < clean.length; i += 1) {
    if (clean[i] === '{') depth += 1
    else if (clean[i] === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  const bases = new Set()
  const re = /([A-Za-z_$][\w$]*)\s*:\s*null\b/g
  let m
  while ((m = re.exec(clean.slice(open, end)))) bases.add(m[1])
  return bases
}

// 引号感知地取标签全文:属性值里的 `>`(如 `{{a > b}}`)不当作标签结束
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

function componentTags(src, name) {
  const out = []
  const re = new RegExp('<(' + name + ')(?=[\\s/>])', 'g')
  let m
  while ((m = re.exec(src))) {
    const text = readTag(src, m.index)
    const tags = []
    ATTR.lastIndex = 0
    let a
    while ((a = ATTR.exec(text))) tags.push([a[1], a[2]])
    if (tags.some(([n]) => n === 'show' || n === 'topic-name')) out.push({ line: src.slice(0, m.index).split('\n').length, attrs: tags })
  }
  return out
}

function bindingOf(src, name, prop) {
  const tags = componentTags(src, name)
  assert.equal(tags.length, 1, `应恰好有一个 <${name}>,实际 ${tags.length} 个`)
  const hit = tags[0].attrs.filter(([n]) => n === prop)
  assert.equal(hit.length, 1, `<${name}> 应恰好有一处 ${prop} 绑定`)
  return hit[0][1].replace(/\s+/g, ' ').trim()
}

// 判据(与 modal-null 的 nullRiskBindings 同构):nullable base 的成员访问,
// 没对这条成员链自己写三元兜底就命中。`|| ''` 之类不在支持之列。
function unguardedMemberBindings(wxml, js) {
  const bases = nullableDataBases(js)
  const hits = []
  for (const tag of componentTags(wxml, COMPONENT)) {
    for (const [name, raw] of tag.attrs) {
      const m = /^\{\{([\s\S]*)\}\}$/.exec(raw.trim())
      if (!m) continue
      const expr = m[1]
      for (const base of bases) {
        const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const guarded = new RegExp(`\\b${esc}\\s*\\?`).test(expr)
        const usesMember = new RegExp(`\\b${esc}\\s*\\.`).test(expr)
        if (usesMember && !guarded) hits.push({ line: tag.line, prop: name, expr: expr.trim() })
      }
    }
  }
  return hits
}

const wxml = read(WXML)
const js = read(JS)

test('前提:setting 初值为 null,且这条绑定被渲染在设置面板之外(不是 ready 才求值)', () => {
  assert.ok(nullableDataBases(js).has('setting'), 'data.setting 初值不再是 null —— 判据前提变了,先核对')
  assert.equal(componentTags(wxml, COMPONENT)[0].line > 480, true,
    '结束主题确认弹层应挂在设置面板(block wx:else)之外,才能在 setting=null 时求值')
})

test('cy-club-topic-end-confirm 的 topic-name:对可空 setting 必须三元兜底', () => {
  assert.equal(bindingOf(wxml, COMPONENT, 'topic-name'), "{{setting ? setting.topicName : ''}}")
  assert.deepEqual(unguardedMemberBindings(wxml, js), [],
    'setting=null 时 topic-name 会把 null 原样传给组件(微信 type-uncompatible)')
})

test('负控:把兜底拆回旧写法,同一判据必须报红', () => {
  const mutated = wxml.replace("topic-name=\"{{setting ? setting.topicName : ''}}\"", 'topic-name="{{setting.topicName}}"')
  assert.notEqual(mutated, wxml, '负控锚点失效:三元兜底写法变了,先修锚点')
  const hits = unguardedMemberBindings(mutated, js)
  assert.equal(hits.length, 1, '拆掉兜底后必须恰好命中一条')
  assert.equal(hits[0].prop, 'topic-name')

  // 前提负控:setting 初值不是 null(如 {})时,同一条旧写法就不再命中 ——
  // 证明判据盯的是「初值 null」这个前提,不是属性名本身
  const nonNullInit = js.replace('setting: null,', 'setting: { topicName: \'\' },')
  assert.notEqual(nonNullInit, js, '负控锚点失效:setting 初值行变了,先修锚点')
  assert.deepEqual(unguardedMemberBindings(mutated, nonNullInit), [])
})
