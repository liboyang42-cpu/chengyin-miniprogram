// WXML 表达式禁止「对括号表达式做成员访问」——即 `{{ (...).foo }}`。
//
// 病(2026-08-10 二分坐实):专业发布页写了 `wx:if="{{(chapter.nodes || []).length}}"`,
// 整个 pages/publish/fabu/index 就再也打不开了。症状极难认:
//   - wx.reLaunch 既不回 success 也不回 fail(automator 封装反而报 success),
//   - getCurrentPages() 原地不动,
//   - console / exception 零输出,
//   - `cli preview` 编译阶段照样通过 —— 它只在建页的渲染层炸,静默中止。
// 最小复现:`<view class="fabu"><view>{{ ([]).length }}</view></view>` → 页面进不去;
//          去掉括号或去掉成员访问(`{{ [].length }}` / `{{ (1+2) }}`)立刻恢复。
// 换句话说,坏的不是 `|| []` 也不是 movable-area,是 `( … ) .` 这个组合本身。
//
// 合法且不受影响的写法(本门禁不误伤):
//   - 函数调用后取成员:`{{ img.list(x).length }}`(全仓在用)
//   - 括号只做分组、后面不接点:`{{ (a || 0) }}`、`{{ (1 + 2) * 3 }}`
//   - 直接成员访问:`{{ chapter.nodes.length }}`(WXML 成员访问本身空安全)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const SKIP = /(^|\/)(node_modules|miniprogram_npm)(\/|$)/

// {{ … }} 内、前面不紧邻标识符/`]`/`)` 的括号组(即「不是函数调用」的括号表达式)后接 `.`
const INTERP = /\{\{([\s\S]*?)\}\}/g
const PAREN_MEMBER = /(?<![\w$\])])\((?:[^()]|\([^()]*\))*\)\s*\./

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (SKIP.test(p)) continue
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.wxml')) out.push(p)
  }
  return out
}

function scan(text) {
  const hits = []
  text.split('\n').forEach((line, i) => {
    INTERP.lastIndex = 0
    let m
    while ((m = INTERP.exec(line))) {
      if (PAREN_MEMBER.test(m[1])) hits.push({ line: i + 1, expr: m[0].trim().slice(0, 120) })
    }
  })
  return hits
}

test('全仓 wxml 不得出现「括号表达式 + 成员访问」', () => {
  const files = walk(ROOT)
  assert.ok(files.length > 100, `只扫到 ${files.length} 个 wxml,扫描范围塌了`)
  const bad = []
  for (const f of files) {
    for (const h of scan(fs.readFileSync(f, 'utf8'))) {
      bad.push(`${path.relative(ROOT, f)}:${h.line}: ${h.expr}`)
    }
  }
  assert.deepEqual(bad, [], `这些表达式会让整页静默创建失败(零报错、编译也不红):\n${bad.join('\n')}`)
})

// 负控:门禁必须真能变红,也必须真不误伤合法写法
test('负控:检查器对坏写法报红、对合法写法放行', () => {
  const shouldFail = [
    '<view>{{ (chapter.nodes || []).length }}</view>',
    '<view style="height: {{(a || []).length * n}}px"></view>',
    '<view>{{ ([]).length }}</view>',
    '<view>{{ (obj).key }}</view>',
  ]
  const shouldPass = [
    '<view>{{ chapter.nodes.length }}</view>',
    '<view>{{ img.list(node.imgUrl).length }}</view>',
    '<view>{{ (img.list(x).length) || 0 }}</view>',
    '<view>{{ (a || 0) }}</view>',
    '<view>{{ (1 + 2) * 3 }}</view>',
    '<view>{{ arr[0].name }}</view>',
    '<view>{{ [].length }}</view>',
  ]
  for (const s of shouldFail) assert.equal(scan(s).length, 1, `应报红却放行了: ${s}`)
  for (const s of shouldPass) assert.equal(scan(s).length, 0, `误伤了合法写法: ${s}`)
})
