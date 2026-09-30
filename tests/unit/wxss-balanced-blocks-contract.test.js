'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['.git', 'node_modules', 'miniprogram_npm', 'tests'])

function collectWxss(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) collectWxss(target, files)
    else if (entry.isFile() && entry.name.endsWith('.wxss')) files.push(target)
  }
  return files
}

function braceBalance(source) {
  const clean = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '')
  let depth = 0
  for (const char of clean) {
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth < 0) return depth
  }
  return depth
}

test('生产 WXSS 的规则块必须成对闭合', () => {
  const invalid = collectWxss(ROOT)
    .map((file) => ({ file: path.relative(ROOT, file), balance: braceBalance(fs.readFileSync(file, 'utf8')) }))
    .filter(({ balance }) => balance !== 0)
  assert.deepEqual(invalid, [])
})

// ⚠️ 2026-09-03 事故:tokens.wxss 混进一行孤立的 `*/`,WXSS 整份编译不过,
//    小程序**一个页面都起不来**(DevTools 只报 `simulator launch failed`,
//    要连上 automation 才看得到真正的 `unexpected 半 at pos 6371`)。
//    而它一路绿灯合进了 master —— 因为本文件原来只查 `{}` 配平,不查注释。
//    根因是 rebase 解冲突时「两侧全留」把一行注释尾巴留成了孤儿。
//
// 注释不配平比花括号不配平更隐蔽:一个漏掉的 `/*` 会把后面几百行**全部吞成注释**,
// 门禁看起来还是「块配平」的,页面却整片消失。
test('生产 WXSS 的注释必须成对闭合,且不得有孤立的 */', () => {
  const offenders = []
  for (const file of collectWxss(ROOT)) {
    const rel = path.relative(ROOT, file)
    const src = fs.readFileSync(file, 'utf8')
    let depth = 0
    let openedAt = 0
    let line = 1
    for (let i = 0; i < src.length; i += 1) {
      if (src[i] === '\n') { line += 1; continue }
      if (src[i] === '/' && src[i + 1] === '*') {
        if (depth === 0) { depth = 1; openedAt = line }
        i += 1
      } else if (src[i] === '*' && src[i + 1] === '/') {
        if (depth === 0) offenders.push(`${rel}:${line} 孤立的 */`)
        depth = 0
        i += 1
      }
    }
    if (depth === 1) offenders.push(`${rel}:${openedAt} 注释开了没关,后面全被吞掉`)
  }
  assert.deepEqual(offenders, [], 'WXSS 注释不配平,整份文件编译不过')
})

test('负控:塞一个孤立的 */ 进去,门禁必须判红', () => {
  const scan = (src) => {
    let depth = 0
    const bad = []
    for (let i = 0; i < src.length; i += 1) {
      if (src[i] === '/' && src[i + 1] === '*') { if (depth === 0) depth = 1; i += 1 }
      else if (src[i] === '*' && src[i + 1] === '/') { if (depth === 0) bad.push(i); depth = 0; i += 1 }
    }
    return { bad, unclosed: depth === 1 }
  }
  // 先证明判据对合法输入放行 —— 否则它只是个永远判红的假门禁
  assert.deepEqual(scan('/* ok */\n.a { color: red; }').bad, [])
  assert.equal(scan('/* ok */').unclosed, false)
  // 事故原样:注释已闭合,后面又多一个 */
  assert.equal(scan('/* ok */\n  多出来的尾巴 */').bad.length, 1, '孤立的 */ 没被抓到')
  // 另一半:开了没关,会把后面全吞掉
  assert.equal(scan('/* 开了没关\n.a { color: red; }').unclosed, true, '未闭合注释没被抓到')
})
