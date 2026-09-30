#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// `uploading` 是可见进度态,不是空白 loading 分支 —— 但**不能靠词边界**把它排掉:
// 本仓状态名以驼峰为主(isLoading / loadError / hasFailed / loadFailed),加了 \b 之后
// 这些全部不再命中。2026-09-22 实测:同一组探针(3 驼峰 + 1 裸 loading),
// 词边界版只抓到 1/4,子串版 4/4。所以保留子串匹配,只精准剔除 uploading 这一个词。
const STATE_CONDITION = /loading|empty|error|failed|forbidden|permission|not[\s._-]*found|missing/i
const NOT_A_STATE_WORD = /uploading/gi
const ERROR_FIELD = /^(?:errors?(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])?|[A-Za-z_$][\w$]*(?:Error|ErrorText|ErrorMsg|LoadError|LoadErr|SubmitError|StaleError)[A-Za-z0-9_$]*(?:\.[A-Za-z_$][\w$]*)*)$/i

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function maskComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
}

function parseAttributes(raw) {
  const attrs = new Map()
  const nameMatch = /^<\s*[\w:-]+/.exec(raw)
  const body = nameMatch ? raw.slice(nameMatch[0].length, raw.length - 1) : ''
  for (const match of body.matchAll(/([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
    attrs.set(match[1], match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : ''))
  }
  return attrs
}

function parseWxml(source) {
  const masked = maskComments(source)
  const root = { tag: '#root', attrs: new Map(), children: [], texts: [], parent: null, start: 0 }
  const stack = [root]
  let cursor = 0

  while (cursor < masked.length) {
    const open = masked.indexOf('<', cursor)
    if (open < 0) {
      stack[stack.length - 1].texts.push({ text: masked.slice(cursor), start: cursor })
      break
    }
    if (open > cursor) stack[stack.length - 1].texts.push({ text: masked.slice(cursor, open), start: cursor })
    let quote = ''
    let close = open + 1
    for (; close < masked.length; close += 1) {
      const char = masked[close]
      if (quote) {
        if (char === quote) quote = ''
      } else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
    }
    if (close >= masked.length) break
    const raw = masked.slice(open, close + 1)
    const closing = /^<\s*\//.test(raw)
    const tagMatch = /^<\s*\/?\s*([\w:-]+)/.exec(raw)
    if (!tagMatch) {
      cursor = close + 1
      continue
    }
    const tag = tagMatch[1]
    if (closing) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack.length = index
          break
        }
      }
    } else {
      const parent = stack[stack.length - 1]
      const node = { tag, attrs: parseAttributes(raw), children: [], texts: [], parent, start: open, raw }
      parent.children.push(node)
      if (!/\/\s*>$/.test(raw)) stack.push(node)
    }
    cursor = close + 1
  }
  return root
}

function isAlwaysHidden(node) {
  const hidden = node.attrs.get('hidden')
  if (node.attrs.has('hidden') && (hidden === '' || /^(?:true|\{\{\s*true\s*\}\})$/.test(hidden))) return true
  const style = node.attrs.get('style') || ''
  return /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)
}

/**
 * 类名是否表示「CSS 画出来的可视元素」(骨架/进度圈/图标/兜底块)。
 *
 * 判据按**类名分段**匹配,不做无边界子串:本仓骨架类名大量用缩写(av__sk / cc__sk /
 * pt__sk / upload__spin),无边界写法虽然能覆盖它们,却顺带放过任意含这些字母的名字。
 * 2026-09-22 复核 12 条被豁免的分支,全部属于这一类真误报(CSS 画的骨架/进度圈/封面兜底)。
 */
const VISUAL_WORDS = new Set([
  'sk', 'spin', 'spinner', 'skeleton', 'glyph', 'icon', 'loading', 'progress',
  'fallback', 'shape', 'placeholder',
])
const VISUAL_STATE_WORDS = new Set([...VISUAL_WORDS, 'verified', 'online', 'dot', 'badge'])
function classHasVisualWord(className, words) {
  return String(className || '')
    .split(/\s+/)
    .some((one) => one.split(/[-_]+/).some((part) => words.has(part.toLowerCase())))
}

function hasVisibleContent(node) {
  if (node.texts.some(({ text }) => text.replace(/\s+/g, '') !== '')) return true
  for (const child of node.children) {
    if (isAlwaysHidden(child)) continue
    if (/^(?:image|icon|cy-icon|button|navigator|progress|canvas|map|include|template|cy-empty|cy-error|cy-inline-error|cy-state-shell|cy-skeleton)$/i.test(child.tag)) return true
    const className = child.attrs.get('class') || ''
    if (classHasVisualWord(className, VISUAL_WORDS)) return true
    if (hasVisibleContent(child)) return true
  }
  return false
}

function nodeProvidesVisibleContent(node) {
  if (isAlwaysHidden(node)) return false
  if (node.tag.includes('-')) return true
  if (/^(?:image|icon|button|navigator|progress|canvas|map|include|template)$/i.test(node.tag)) return true
  return classHasVisualWord(node.attrs.get('class') || '', VISUAL_STATE_WORDS)
}

function stateCondition(node, seen = new Set()) {
  if (!node || seen.has(node)) return false
  seen.add(node)
  const condition = node.attrs.get('wx:if') || node.attrs.get('wx:elif') || ''
  if (STATE_CONDITION.test(String(condition).replace(NOT_A_STATE_WORD, ''))) return true
  if (!node.attrs.has('wx:else') || !node.parent) return false
  const siblings = node.parent.children
  const index = siblings.indexOf(node)
  return index > 0 && stateCondition(siblings[index - 1], seen)
}

// 元素自身就是恢复入口的形状:整条错误文案本身可点即重试
// (`<view bindtap="start">{{error}} · 点击重试</view>`)。原判据只认
// 「alert 容器 + 里面另有一个可点子元素」,把这种更紧凑、语义也更直白的写法判红了。
// 2026-09-04 主包瘦身把 advanced-game 从 components/ 挪进 pages/ 才暴露 ——
// 这道门按目录判范围,组件在 components/ 下时压根没被扫。
function isSelfRecovery(node) {
  const clickable = Array.from(node.attrs.keys())
    .some((name) => /^(?:bind|catch):?(?:tap|confirm)$/.test(name))
  if (!clickable) return false
  // 只认文案里真的写明了出路的,别把任意可点元素都放行
  return node.texts.some((t) => /重试|再试|重新|刷新|重连/.test(t.text))
}

function hasRecoveryAlert(node) {
  if (isSelfRecovery(node)) return true
  let current = node
  while (current && current.tag !== '#root') {
    if (current.attrs.get('aria-role') === 'alert') {
      const pending = [current]
      while (pending.length) {
        const item = pending.pop()
        if (item !== current && (
          /^(?:button|navigator)$/i.test(item.tag)
          || Array.from(item.attrs.keys()).some((name) => /^(?:bind|catch):?(?:tap|confirm)$/.test(name))
          || item.attrs.has('open-type')
        )) return true
        pending.push(...item.children)
      }
    }
    current = current.parent
  }
  return false
}

function directlyRendersError(expression) {
  const withoutStrings = expression.replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, '')
  if (withoutStrings.includes('?')) return false
  const candidates = withoutStrings.split(/\|\||&&|\+|,|\s+/).map((value) => value.trim()).filter(Boolean)
  return candidates.some((value) => ERROR_FIELD.test(value.replace(/^\(+|\)+$/g, '')))
}

function analyzeWxml(source, file = '(memory)') {
  const root = parseWxml(source)
  const issues = []
  const visit = (node) => {
    if (node.tag !== '#root' && stateCondition(node) && !nodeProvidesVisibleContent(node) && !hasVisibleContent(node)) {
      const condition = node.attrs.get('wx:if') || node.attrs.get('wx:elif') || 'wx:else'
      issues.push({
        rule: 'BLANK_STATE_BRANCH',
        file,
        line: lineNumber(source, node.start),
        evidence: `${node.tag}:${condition.replace(/\s+/g, ' ').trim()}`,
      })
    }
    for (const segment of node.texts) {
      for (const match of segment.text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
        if (directlyRendersError(match[1]) && !hasRecoveryAlert(node)) {
          issues.push({
            rule: 'RAW_ERROR_TEXT',
            file,
            line: lineNumber(source, segment.start + match.index),
            evidence: match[1].replace(/\s+/g, ' ').trim(),
          })
        }
      }
    }
    node.children.forEach(visit)
  }
  visit(root)
  return issues
}

function issueSignature(issue) {
  return `${issue.rule}:${issue.evidence}`
}

function newIssues(current, previous) {
  const previousCounts = new Map()
  previous.forEach((issue) => {
    const signature = issueSignature(issue)
    previousCounts.set(signature, (previousCounts.get(signature) || 0) + 1)
  })
  return current.filter((issue) => {
    const signature = issueSignature(issue)
    const count = previousCounts.get(signature) || 0
    if (!count) return true
    previousCounts.set(signature, count - 1)
    return false
  })
}

function walkWxml(root, files = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) walkWxml(absolute, files)
    else if (entry.isFile() && entry.name.endsWith('.wxml')) files.push(absolute)
  }
  return files
}

function scanRoot(root) {
  return walkWxml(root).flatMap((file) => analyzeWxml(
    fs.readFileSync(file, 'utf8'),
    path.relative(root, file).split(path.sep).join('/'),
  ))
}

function selftest() {
  const iconButton = '<view wx:if="{{!loading}}"><cy-icon name="close-sm" /></view>'
  assert.deepEqual(analyzeWxml(iconButton), [])
  assert.equal(analyzeWxml(iconButton.replace('<cy-icon name="close-sm" />', '')).length, 1)
  const broken = '<block wx:if="{{state === \'error\'}}"></block><view>{{submitError}}</view>'
  assert.deepEqual(analyzeWxml(broken).map((issue) => issue.rule).sort(), ['BLANK_STATE_BRANCH', 'RAW_ERROR_TEXT'])
  const good = '<cy-error wx:if="{{state === \'error\'}}" sub="{{submitError}}" retry="重试" bind:retry="reload" />'
  assert.deepEqual(analyzeWxml(good), [])
  const alert = '<view wx:if="{{error}}" aria-role="alert">{{error}}<button bindtap="retry">重试</button></view>'
  assert.deepEqual(analyzeWxml(alert), [])
  // 元素自身即恢复入口
  const selfRetry = '<view wx:if="{{error}}" bindtap="start">{{error}} · 点击重试</view>'
  assert.deepEqual(analyzeWxml(selfRetry), [])
  // 负控:可点但文案没写出路 ⇒ 仍判红,别把任意可点元素都放行
  const clickNoWay = '<view wx:if="{{error}}" bindtap="start">{{error}}</view>'
  assert.deepEqual(analyzeWxml(clickNoWay).map((i) => i.rule), ['RAW_ERROR_TEXT'])
  const visualState = '<view wx:if="{{loading}}"><view class="card__sk"></view></view><view wx:if="{{item.uploading}}" class="upload__remove"></view>'
  assert.deepEqual(analyzeWxml(visualState), [])
  const fallbackState = '<image wx:if="{{hero && !heroFailed}}" /><view wx:else class="hero-img--fallback"></view>'
  assert.deepEqual(analyzeWxml(fallbackState), [])
  // ★负控:驼峰状态名的空白分支必须照样判红。
  //   本仓状态名以驼峰为主,一旦给 STATE_CONDITION 加 \b 词边界,isLoading / loadError /
  //   hasFailed 全部不再命中 —— 门禁会静默失明(2026-09-22 实测 1/4)。上面那条 uploading
  //   豁免只能靠精准剔除词,不能靠词边界;这条就是钉住那个区别的。
  const camelBlank = '<view wx:if="{{isLoading}}"></view><view wx:if="{{loadError}}"></view>'
    + '<view wx:if="{{hasFailed}}"></view><view wx:if="{{loading}}"></view>'
  assert.deepEqual(analyzeWxml(camelBlank).map((i) => i.rule),
    ['BLANK_STATE_BRANCH', 'BLANK_STATE_BRANCH', 'BLANK_STATE_BRANCH', 'BLANK_STATE_BRANCH'])
  // ★负控:视觉类名白名单必须按**分段**匹配,不能用无边界子串。
  //   无边界写法下 class="shapeshifter-panel" 会因为含 "shape" 被当成可视元素放行,
  //   任意名字只要带上这几个字母就能给空白分支开后门。
  const fakeVisual = '<view wx:if="{{error}}"><view class="shapeshifter-panel"></view></view>'
    + '<view wx:if="{{error}}"><view class="mybox"></view></view>'
  assert.deepEqual(analyzeWxml(fakeVisual).map((i) => i.rule),
    ['BLANK_STATE_BRANCH', 'BLANK_STATE_BRANCH'])
  console.log('状态可见性门禁自证通过:空白错误分支与裸错误文案会红，组件化/带恢复动作 alert 会绿')
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest()
  else {
    const rootIndex = process.argv.indexOf('--root')
    const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : path.resolve(__dirname, '..'))
    const issues = scanRoot(root)
    issues.forEach((issue) => console.error(`${issue.rule}:${issue.file}:${issue.line} ${issue.evidence}`))
    if (issues.length) process.exit(1)
    console.log('状态可见性门禁通过:无裸错误文案或空白状态分支')
  }
}

module.exports = { analyzeWxml, newIssues, scanRoot }
