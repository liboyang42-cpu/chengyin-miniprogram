#!/usr/bin/env node
/*
 * 组件 WXSS 选择器门禁。
 *
 * 微信组件 WXSS 不接受 tag-name、ID、attribute selector；一处违规就会令页面编译失败。
 * 只扫描 `component: true` 配置对应的 wxss，页面 WXSS 不受此规则约束。
 *
 * 用法：
 *   node scripts/component-wxss-selector-lint.js
 *   node scripts/component-wxss-selector-lint.js --selftest
 */
'use strict'

const fs = require('fs')
const path = require('path')

const NESTING_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'document', 'scope'])

function selectorLine(startLine, selector, offset) {
  return startLine + (selector.slice(0, offset).match(/\n/g) || []).length
}

function findUnsupportedComponentSelectors(src) {
  const hits = []
  const blockStack = []
  let line = 1
  let inComment = false
  let stringChar = null
  let segment = ''
  let segmentStartLine = 1

  const isSelectorContext = () => blockStack.length === 0 || blockStack[blockStack.length - 1] === 'selector'
  const report = (type, selector, offset) => hits.push({ type, selector: selector.trim(), line: selectorLine(segmentStartLine, selector, offset) })

  const inspectSelector = (selector) => {
    const attr = /\[[^\]]*\]/g
    let match
    while ((match = attr.exec(selector)) !== null) report('attribute', selector, match.index)

    const id = /(^|[^\w-])#[A-Za-z_][\w-]*/g
    while ((match = id.exec(selector)) !== null) report('id', selector, match.index + match[1].length)

    const tag = /(^|[\s>+~,(])([a-z][\w-]*)(?=$|[\s>+~.#:[,])/gi
    while ((match = tag.exec(selector)) !== null) report('tag', selector, match.index + match[1].length)
  }

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '\n') {
      line++
      if (!inComment) segment += '\n'
      continue
    }
    if (inComment) {
      if (c === '*' && next === '/') {
        inComment = false
        i++
      }
      continue
    }
    if (stringChar) {
      segment += c
      if (c === '\\' && next !== undefined) {
        segment += next
        i++
      } else if (c === stringChar) {
        stringChar = null
      }
      continue
    }
    if (c === '/' && next === '*') {
      inComment = true
      i++
      continue
    }
    if (c === '"' || c === "'") {
      stringChar = c
      segment += c
      continue
    }
    if (c === '{') {
      const prelude = segment.trim()
      if (isSelectorContext() && prelude && prelude.charAt(0) !== '@') inspectSelector(segment)
      const atRule = /^@([a-zA-Z-]+)/.exec(prelude)
      blockStack.push(atRule && NESTING_AT_RULES.has(atRule[1].toLowerCase()) ? 'selector' : 'declaration')
      segment = ''
      segmentStartLine = line
      continue
    }
    if (c === '}') {
      blockStack.pop()
      segment = ''
      segmentStartLine = line
      continue
    }
    if (c === ';') {
      segment = ''
      segmentStartLine = line
      continue
    }
    segment += c
  }
  return hits
}

function walk(dir, files) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'miniprogram_npm' || name === '.git') continue
    const file = path.join(dir, name)
    const stat = fs.statSync(file)
    if (stat.isDirectory()) walk(file, files)
    else if (name.endsWith('.json')) files.push(file)
  }
  return files
}

function lintComponentWxss(root) {
  const violations = []
  for (const configFile of walk(root, [])) {
    let config
    try {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    } catch (error) {
      continue
    }
    if (config.component !== true) continue
    const wxssFile = configFile.replace(/\.json$/, '.wxss')
    if (!fs.existsSync(wxssFile)) continue
    const source = fs.readFileSync(wxssFile, 'utf8')
    for (const hit of findUnsupportedComponentSelectors(source)) {
      violations.push(Object.assign({ file: path.relative(root, wxssFile) }, hit))
    }
  }
  return violations
}

function selftest() {
  const bad = [
    ['.tab image { width: 1rpx; }', 'tag'],
    ['#tab .icon { width: 1rpx; }', 'id'],
    ['.tab[data-state="on"] { width: 1rpx; }', 'attribute'],
    ['@media (min-width: 1px) { view { width: 1rpx; } }', 'tag']
  ]
  const good = [
    ':host { display: block; }',
    '.tabbar__icon { width: 1rpx; }',
    '.tabbar__icon::after { content: "#"; }',
    '@media (min-width: 1px) { .tabbar__icon { width: 1rpx; } }'
  ]
  let failed = false
  for (const [source, type] of bad) {
    if (!findUnsupportedComponentSelectors(source).some((hit) => hit.type === type)) {
      console.error(`SELFTEST FAIL(应拦 ${type}): ${source}`)
      failed = true
    }
  }
  for (const source of good) {
    if (findUnsupportedComponentSelectors(source).length) {
      console.error(`SELFTEST FAIL(误拦合法 class selector): ${source}`)
      failed = true
    }
  }
  if (failed) process.exit(1)
  console.log('组件 WXSS 选择器门禁:自证通过(能判红也能判绿)')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const root = path.resolve(__dirname, '..')
  const violations = lintComponentWxss(root)
  for (const hit of violations) {
    console.error(`FAIL(组件 WXSS ${hit.type} selector): ${hit.file}:${hit.line} —— WeChat 组件 WXSS 仅允许 class selector`)
  }
  if (violations.length) {
    console.error(`组件 WXSS 选择器门禁:未通过(${violations.length} 处)`)
    process.exit(1)
  }
  console.log('组件 WXSS 选择器门禁:通过')
}

if (require.main === module) main()

module.exports = { findUnsupportedComponentSelectors, lintComponentWxss }
