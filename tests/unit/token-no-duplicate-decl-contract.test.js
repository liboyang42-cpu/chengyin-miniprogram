/* 同一个块里不许重复声明同一个 token(2026-09-02)
 *
 * 起因是一次真实事故:PR #979 先把 6 个语义 token 加进了 master,
 * 而并行的 PR #981 也加了同名 token。合并 #981 时 rebase 冲突按「保留双方」解,
 * 于是每个主题块里同一个 token 被声明了两次 —— **8 处**。
 *
 * CSS 里后者覆盖前者、值又恰好相同,所以不炸、不判红、单测全绿:
 * 这是最难发现的那种污染。但下一个人改其中一份时会发现改了没效果,
 * 而且真源从此有两个。
 *
 * 判据:每个规则块内,同名 `--cy-*` 只许出现一次。
 * ⚠️ 只看**声明**(行首 token 后紧跟冒号),注释里提到某个名字不算 ——
 *    本仓的 token 注释大量互相引用,按原文扫必然误报。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const FILES = ['style/tokens.wxss', 'style/dark-mode.wxss', 'style/merchant-light.wxss']
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/**
 * 返回 ["文件 行N: token ×M", ...]。
 *
 * ⚠️ 用**大括号配平**切规则体,不用「行首长得像选择器」的启发式 ——
 *    第一版就是那么写的,结果把 page{} 之后另一条规则里的同名声明算进了同一块,
 *    自动去重据此删掉了 merchant-light 的 --cy-comp-nav-bg,把深浅镜像的键集打破了。
 *    只统计**最内层**规则体(@media 外壳不算,里面的 page{} 才算)。
 * ⚠️ 扫描前先把块注释换成等量空格。本仓 token 注释是多行的,续行常常长成
 *    `  --cy-comp-scrim-top-h:消费方在元素上内联注入…` —— 行首缩进 + token 名 + 冒号,
 *    和声明一模一样,按原文扫必然误报。换等量空格(而不是删行)是为了行号不漂。
 */
function findDuplicateDecls(files) {
  const out = []
  for (const [name, raw] of files) {
    const masked = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    const lines = masked.split('\n')
    const stack = []
    const bodies = []
    lines.forEach((l, i) => {
      for (const ch of l) {
        if (ch === '{') stack.push(i)
        else if (ch === '}' && stack.length) bodies.push([stack.pop(), i])
      }
    })
    const inner = bodies.filter(([a, b]) =>
      !bodies.some(([x, y]) => (x !== a || y !== b) && a < x && y < b))
    for (const [a, b] of inner) {
      const seen = new Map()
      for (let i = a; i <= b; i++) {
        const m = /^\s*(--cy-[a-z0-9-]+)\s*:/.exec(lines[i])
        if (!m) continue
        seen.set(m[1], (seen.get(m[1]) || 0) + 1)
      }
      for (const [k, n] of seen) {
        if (n > 1) out.push(`${name} 行${a + 1} 起的规则体: ${k} ×${n}`)
      }
    }
  }
  return out
}

const realFiles = () => FILES.filter((p) => fs.existsSync(path.join(ROOT, p))).map((p) => [p, read(p)])

test('同一个块里不许重复声明同一个 token', () => {
  const dupes = findDuplicateDecls(realFiles())
  assert.deepEqual(dupes, [],
    '这些 token 在同一个块里被声明了多次。CSS 里后者覆盖前者、值相同就不炸,'
    + '但真源从此有两个,改其中一份会「改了没效果」:\n' + dupes.join('\n'))
})

test('负控:叠一份重复声明必须判红', () => {
  const real = realFiles()
  assert.deepEqual(findDuplicateDecls(real), [], '干净输入不该报')
  const [name, src] = real[0]
  const m = /^(\s*)(--cy-color-bg-page)\s*:\s*([^;]+);/m.exec(src)
  assert.ok(m, '找不到注入锚点')
  const mutated = src.replace(m[0], `${m[0]}\n${m[1]}${m[2]}: ${m[3]};`)
  assert.notEqual(mutated, src, '负控变异注入失败')
  const dupes = findDuplicateDecls([[name, mutated]])
  assert.ok(dupes.some((d) => d.includes('--cy-color-bg-page')), `没抓到注入的重复:${dupes.join()}`)
})

test('负控:注释里提到 token 名不算声明 —— 判据看声明不看注解', () => {
  const fixture = 'page {\n'
    + '  /* --cy-comp-scrim-top-h:消费方在元素上内联注入满色段高度 */\n'
    + '  --cy-comp-scrim-top-h: 0px;\n'
    + '}\n'
  assert.deepEqual(findDuplicateDecls([['x.wxss', fixture]]), [],
    '注释里引用同名 token 是本仓常态,按原文扫会误报')
})
