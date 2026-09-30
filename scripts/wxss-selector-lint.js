#!/usr/bin/env node
/*
 * WXSS 选择器门禁 —— 拦 WeChat WXSS 不支持的通配符 `*` 选择器。
 *
 * 背景:2026-07-17 #115 引入 `.form-btn > * { flex: 1; }`,wcsc 报
 *   `error at token '*'`;devtools 全量编译把所有页 wxss 塞进一次调用,
 *   一页报错 → 整批样式产出归零 → 全 app 白屏 + appLaunch 超时。
 *   但 ci/xcx-check.sh 只编 JS/JSON、不编 WXSS,故该致命错 CI 全绿合入。
 *
 * 为什么不直接用 wcsc:wcsc 是 macOS 专属二进制,CI 跑在 ubuntu-latest,
 *   无法调用。故用零依赖的静态选择器扫描,覆盖已确证的这一类编译阻断。
 *   (全保真需自托管 Mac runner 全量编译,会把 CI 绿绑死"Mac 醒着",不采用。)
 *
 * 判据:出现在「选择器上下文」的 `*`(通配符)即拒。选择器上下文 = 非注释、非字符串、
 *   圆括号外(parenDepth=0)、且当前不在普通声明块内 —— 即顶层,或嵌套 at-rule 体内
 *   (@media/@supports/@container/@layer/@document/@scope 的 `{}`)。排除 `*=` 属性操作符
 *   与 calc()/媒体特性括号里的乘号。⚠️ 关键:`@media(){ * {} }` 的 `*` 在花括号深度 1,
 *   旧版只看深度 0 会漏 → 全 app 白屏隐患,故按「块是不是 at-rule 体」识别,而非单纯数花括号。
 *
 * 用法:
 *   node scripts/wxss-selector-lint.js            # 扫全仓 .wxss,有违规 exit 1
 *   node scripts/wxss-selector-lint.js --selftest # 负控:自证能判红也能判绿
 */
'use strict'
const fs = require('fs')
const path = require('path')

// 体内含「嵌套样式规则」(即 `*` 出现在这里就是选择器)的 at-rule。其余 at-rule
// (@keyframes/@font-face/@page…)体内是声明或关键帧选择器,不视作通配符选择器位置。
const NESTING_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'document', 'scope'])

// 扫描单份 wxss 源,返回 [{line, col}] 违规位置(通配符 `*` 选择器)。
function findWildcardSelectors(src) {
  const hits = []
  let line = 1, col = 0
  let inBlockComment = false
  let stringChar = null       // 当前字符串引号(' 或 "),null=不在字符串
  let parenDepth = 0          // 圆括号深度:>0 时 `*` 是 calc/媒体特性里的乘号,不是选择器
  const blockStack = []       // 每层 `{}` 的上下文:'sel'=选择器位置(顶层/嵌套 at-rule 体) / 'decl'=声明块
  let seg = ''                // 自上个 { } ; 以来的 prelude 文本,用于判断 `{` 前是不是嵌套 at-rule
  const inSelectorCtx = () =>
    parenDepth === 0 && (blockStack.length === 0 || blockStack[blockStack.length - 1] === 'sel')
  for (let i = 0; i < src.length; i++) {
    const c = src[i], next = src[i + 1]
    if (c === '\n') { line++; col = 0; seg += ' '; continue }
    col++
    if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; col++ } continue }
    if (stringChar) {
      if (c === '\\') { i++; col++; continue }   // 转义:跳过下一字符(如 \" 不闭合字符串)
      if (c === stringChar) stringChar = null
      continue
    }
    if (c === '/' && next === '*') { inBlockComment = true; i++; col++; continue }
    if (c === '"' || c === "'") { stringChar = c; continue }
    if (c === '(') { parenDepth++; seg += c; continue }
    if (c === ')') { if (parenDepth > 0) parenDepth--; seg += c; continue }
    if (c === '{') {
      const s = seg.trim()
      let type = 'decl'
      if (s[0] === '@') {
        const m = /^@([a-zA-Z-]+)/.exec(s)
        if (m && NESTING_AT_RULES.has(m[1].toLowerCase())) type = 'sel'
      }
      blockStack.push(type)
      seg = ''
      continue
    }
    if (c === '}') { if (blockStack.length) blockStack.pop(); seg = ''; continue }
    if (c === ';') { seg = ''; continue }
    // 普通字符:选择器上下文里的 `*`(排除 `*=` 属性操作符)即通配符选择器。
    if (c === '*' && next !== '=' && inSelectorCtx()) hits.push({ line, col })
    seg += c
  }
  return hits
}

function walkWxss(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'miniprogram_npm') continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walkWxss(p, acc)
    else if (name.endsWith('.wxss')) acc.push(p)
  }
  return acc
}

function selftest() {
  const bad = [
    ['.form-btn > * { flex: 1; }', 1],
    ['* { margin: 0; }', 1],
    ['.a *{color:red}', 1],
    ['@media (max-width:500px){ * { box-sizing:border-box } }', 1], // 嵌套 at-rule 体内的 *(旧版漏)
    ['@supports (display:grid){ .a > * { flex:1 } }', 1],           // 同上
  ]
  const good = [
    ['.form-btn > .form-btn__item { flex: 1; }', 0],
    ['/* .a > * 只是注释 */\n.x { width: calc(100% * 2); }', 0], // 注释里的 * 和块内 calc 的 * 都不算
    ['.item[data-k="a*b"] { color: red; }', 0],                   // 字符串里的 *
    ['.item[data-x="a\\"b*c"] { color: red; }', 0],               // 转义引号内的 *(字符串不提前闭合)
    ['@media (min-width: calc(320px * 2)) { .a{color:red} }', 0], // at-rule prelude 括号里的乘号不是选择器
    ['view { color: #000; }', 0],
  ]
  let ok = true
  for (const [src, n] of bad) {
    const got = findWildcardSelectors(src).length
    if (got < 1) { console.error(`SELFTEST FAIL(该判红却没判): ${JSON.stringify(src)} → ${got}`); ok = false }
  }
  for (const [src, n] of good) {
    const got = findWildcardSelectors(src).length
    if (got !== n) { console.error(`SELFTEST FAIL(该判绿却误判): ${JSON.stringify(src)} → ${got}`); ok = false }
  }
  if (!ok) { console.error('WXSS 选择器门禁:自证失败(检查器已失灵)'); process.exit(1) }
  console.log('WXSS 选择器门禁:自证通过(能判红也能判绿)')
}

function main() {
  const root = path.resolve(__dirname, '..')   // chengyinhub-xcx/
  if (process.argv.includes('--selftest')) return selftest()
  const files = walkWxss(root, [])
  let violations = 0
  for (const f of files) {
    const hits = findWildcardSelectors(fs.readFileSync(f, 'utf8'))
    for (const h of hits) {
      console.error(`FAIL(WXSS 通配符选择器): ${path.relative(root, f)}(${h.line}:${h.col}) —— WeChat WXSS 不支持 \`*\`,会整包编译阻断`)
      violations++
    }
  }
  if (violations) { console.error(`WXSS 选择器门禁:未通过(${violations} 处通配符选择器)`); process.exit(1) }
  console.log(`WXSS 选择器门禁:通过(扫 ${files.length} 份 .wxss,无通配符选择器)`)
}

main()
