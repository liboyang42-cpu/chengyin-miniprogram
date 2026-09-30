'use strict'

/* 生产 WXML 的标签必须成对闭合(2026-08-30)
 *
 * 起因:`pages/play/index.wxml` 末尾多出一个 `</view>`,开发者工具报
 * 「get tag end without start」——**整个玩法页编译不出来**,渲染层跟着抛
 * `__route__ is not defined`。页面在生产里就是白的,而仓库里所有门禁全绿。
 *
 * 旁边早就有 `wxss-balanced-blocks-contract`(WXSS 的 `{}` 配对),
 * 唯独 WXML 这边没有对应的一条 —— 于是这个错能一路合进 master。
 *
 * ⚠️ 只判「配对」,不判语义:自闭合标签、void 标签、注释、字符串里的尖括号
 * 都要排除掉,否则会把一堆合法写法误判成红。
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['.git', 'node_modules', 'miniprogram_npm', 'tests', 'artifacts', 'docs'])
// 小程序里没有 HTML 那套 void 元素,但这几个惯例上不写闭合标签。
const VOID = new Set(['image', 'input', 'icon', 'import', 'include', 'br'])
const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g

function collect(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(target, files)
    else if (entry.isFile() && entry.name.endsWith('.wxml')) files.push(target)
  }
  return files
}

/** 返回第一处配对错误(行号 + 说明),全平衡则返回 null。 */
function firstImbalance(raw) {
  // 注释按换行数替换,保住行号
  const src = raw.replace(/<!--[\s\S]*?-->/g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
  const lineOf = (pos) => src.slice(0, pos).split('\n').length
  const stack = []
  TAG.lastIndex = 0
  let m
  while ((m = TAG.exec(src)) !== null) {
    const [, closing, name, , selfClose] = m
    if (selfClose || VOID.has(name)) continue
    const line = lineOf(m.index)
    if (closing) {
      if (stack.length === 0) return { line, why: `</${name}> 没有对应的开启标签` }
      const top = stack[stack.length - 1]
      if (top.name !== name) return { line, why: `</${name}> 撞上未闭合的 <${top.name}>(第 ${top.line} 行)` }
      stack.pop()
    } else {
      stack.push({ name, line })
    }
  }
  if (stack.length) {
    const top = stack[stack.length - 1]
    return { line: top.line, why: `<${top.name}> 一直没闭合` }
  }
  return null
}

test('生产 WXML 的标签必须成对闭合', () => {
  const broken = collect(ROOT)
    .map((file) => ({ file: path.relative(ROOT, file), bad: firstImbalance(fs.readFileSync(file, 'utf8')) }))
    .filter(({ bad }) => bad !== null)
    .map(({ file, bad }) => `${file}:${bad.line} ${bad.why}`)
  assert.deepEqual(broken, [], '这些 WXML 编译不出来 —— 页面在生产里是白的:\n  ' + broken.join('\n  '))
})

test('★负控:塞一个孤儿闭合标签进去,门禁必须判红', () => {
  const good = '<view class="a"><text>x</text></view>\n'
  assert.equal(firstImbalance(good), null, '合法写法不该报红')

  const orphan = good + '</view>\n'
  const r1 = firstImbalance(orphan)
  assert.ok(r1 && /没有对应的开启标签/.test(r1.why), '末尾多一个闭合必须被抓到')
  assert.equal(r1.line, 2, '要报出真实行号')

  const unclosed = '<view class="a">\n  <text>x</text>\n'
  const r2 = firstImbalance(unclosed)
  assert.ok(r2 && /一直没闭合/.test(r2.why), '少一个闭合也必须被抓到')

  // 这些合法写法不许误伤
  assert.equal(firstImbalance('<image src="a.png" />\n'), null, '自闭合标签')
  assert.equal(firstImbalance('<image src="a.png">\n'), null, 'void 标签不写闭合')
  assert.equal(firstImbalance('<view a="{{ x > 1 }}"><text>y</text></view>'), null, '属性里的 > 不算标签')
  assert.equal(firstImbalance('<!-- </view> -->\n<view></view>'), null, '注释里的标签不算数')
})
