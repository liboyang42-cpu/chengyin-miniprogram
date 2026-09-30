/**
 * WXML <template> 作用域契约
 *
 * 为什么有这条:WXML 的 <template is> **有独立作用域**,不传 data 就是空对象。
 * #572 把 qr-voucher 正文抽成 <template name="qr-voucher-body"> 时,两处 <template is> 都漏了 data=,
 * 于是模板首行 wx:if="{{show}}" 求值 undefined —— 码卡整体静默不渲染:
 * 标题正常、正文全空、零 console error。四个承载面(入场码/优惠券/据点码/团码)的
 * 页面侧与弹窗侧同时空白,原有的 qr-voucher-layout-contract 因为只静态解析 <template name> 块内的
 * class 与布局,从头到尾是绿的。
 *
 * 判据是**语义关系**不是字面量:模板体里引用到的每个根标识符,都必须由每一处 <template is> 的 data 提供。
 * 所以往模板体里加新字段却忘了同步 data,同样会红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', '.git'])
// WXML 表达式里这些不是数据字段
const NON_DATA = new Set(['true', 'false', 'null', 'undefined'])

function walkWxml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkWxml(path.join(dir, entry.name), out)
    } else if (entry.name.endsWith('.wxml')) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

/** 取 {{ ... }} 里的根标识符(a.b / a[0] 都归为 a),排除字符串字面量与关键字 */
function referencedRoots(source) {
  const roots = new Set()
  for (const m of source.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const expr = m[1].replace(/'[^']*'|"[^"]*"/g, ' ')
    for (const id of expr.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const name = id[0]
      const before = expr.slice(0, id.index).trimEnd()
      if (before.endsWith('.')) continue // a.b 里的 b 是属性名,不是根标识符
      const after = expr.slice(id.index + name.length).trimStart()
      if (after.startsWith('(')) continue // 函数调用名不是数据字段
      if (NON_DATA.has(name)) continue
      roots.add(name)
    }
  }
  return roots
}

/** 模板体内 wx:for 自带/自命名的局部变量,不需要由 data 提供 */
function localLoopVars(body) {
  const locals = new Set()
  for (const m of body.matchAll(/wx:for-item\s*=\s*"([^"]+)"/g)) locals.add(m[1].trim())
  for (const m of body.matchAll(/wx:for-index\s*=\s*"([^"]+)"/g)) locals.add(m[1].trim())
  if (/wx:for\s*=/.test(body)) {
    if (!/wx:for-item\s*=/.test(body)) locals.add('item')
    if (!/wx:for-index\s*=/.test(body)) locals.add('index')
  }
  return locals
}

/** 解析 data="{{a, b: c}}" 提供了哪些键;展开运算符视为「提供一切」返回 null */
function providedKeys(dataAttr) {
  const inner = dataAttr.replace(/^\{\{/, '').replace(/\}\}$/, '').trim()
  if (inner.includes('...')) return null
  const keys = new Set()
  for (const part of inner.split(',')) {
    const seg = part.trim()
    if (!seg) continue
    keys.add((seg.includes(':') ? seg.slice(0, seg.indexOf(':')) : seg).trim())
  }
  return keys
}

function collect() {
  const findings = []
  for (const file of walkWxml(ROOT)) {
    const src = fs.readFileSync(file, 'utf8')
    const defs = new Map()
    for (const m of src.matchAll(/<template\s+name="([^"]+)"\s*>([\s\S]*?)<\/template>/g)) {
      defs.set(m[1], m[2])
    }
    if (!defs.size) continue
    for (const m of src.matchAll(/<template\s+is="([^"]+)"([^>]*?)\/?>/g)) {
      const [, name, attrs] = m
      const body = defs.get(name)
      if (body === undefined) continue // 跨文件 import 的模板不在本条契约范围
      const needed = referencedRoots(body)
      for (const local of localLoopVars(body)) needed.delete(local)
      const dataMatch = attrs.match(/data\s*=\s*"([^"]*)"/)
      const provided = dataMatch ? providedKeys(dataMatch[1]) : new Set()
      if (provided === null) continue
      const missing = [...needed].filter(k => !provided.has(k)).sort()
      if (missing.length) {
        findings.push({ file: path.relative(ROOT, file), name, missing, hasData: Boolean(dataMatch) })
      }
    }
  }
  return findings
}

test('每处 <template is> 的 data 都必须覆盖模板体引用的字段', () => {
  const findings = collect()
  const report = findings
    .map(f => `${f.file} 的 <template is="${f.name}">${f.hasData ? '' : ' 完全没有 data='},缺字段:${f.missing.join(', ')}`)
    .join('\n')
  assert.equal(
    findings.length,
    0,
    `WXML template 作用域独立,data 没传到的字段在模板里恒为 undefined,会静默渲染成空白且不报错:\n${report}`,
  )
})

test('negative control:判定逻辑本身不是空的', () => {
  // 模拟「抽了模板却忘了传 data」——正是 #572 的形态
  const body = '<view wx:if="{{show}}">{{errorText}}</view>'
  const needed = referencedRoots(body)
  assert.ok(needed.has('show') && needed.has('errorText'), '根标识符提取失效,门禁会恒绿')
  assert.deepEqual([...needed].filter(k => !new Set().has(k)).sort(), ['errorText', 'show'])

  // 局部循环变量不该被当成缺失字段
  const looped = '<view wx:for="{{list}}" wx:for-item="tag">{{tag.name}}</view>'
  const locals = localLoopVars(looped)
  assert.ok(locals.has('tag'), 'wx:for-item 声明的局部变量必须被排除,否则会误伤 searchmap')

  // data 提供的键要能被正确解析出来
  assert.deepEqual([...providedKeys('{{item: selected}}')], ['item'])
  assert.equal(providedKeys('{{...rest}}'), null, '展开运算符无法静态判定,应放行而不是误报')
})
