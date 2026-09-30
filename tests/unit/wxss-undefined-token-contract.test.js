/* 未定义的 `var(--cy-*)` 会让**整条声明静默作废** —— 不是回落成默认值,是那一行根本不生效。
 *
 * 2026-09-16 实证:编辑页封面卡照原型重写时,我顺手写了四个并不存在的 token
 * (--cy-color-surface-card / --cy-radius-card / --cy-color-surface-sunken / --cy-radius-field)。
 * UI-GATE-0、js-scope、ds-gate 全绿,真机上那张卡**没有白底、没有圆角**,
 * 名字输入框看着像掉在页面背景上 —— 只有截图比对才看得出来。
 *
 * 带兜底的 `var(--x, 默认值)` 不算:那是有意的可选变量。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')

function wxssFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'miniprogram_npm' || name === '.git') continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) wxssFiles(full, out)
    else if (name.endsWith('.wxss')) out.push(full)
  }
  return out
}

/** 全局 token:style/*.wxss 与 app.wxss 里定义的那些 */
function globalTokens() {
  const names = new Set()
  const roots = [path.join(ROOT, 'style'), ROOT]
  for (const dir of roots) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.wxss')) continue
      const src = fs.readFileSync(path.join(dir, name), 'utf8')
      for (const m of src.matchAll(/(--cy-[a-zA-Z0-9-]+)\s*:/g)) names.add(m[1])
    }
  }
  return names
}

function scanUndefined(files, defined) {
  const hits = []
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    // 同一文件里自己定义的也算数(组件常在 :host / .root 上先声明再用)
    const local = new Set([...src.matchAll(/(--cy-[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]))
    for (const m of src.matchAll(/var\(\s*(--cy-[a-zA-Z0-9-]+)\s*(,|\))/g)) {
      if (m[2] === ',') continue                    // 带兜底,是有意的可选变量
      if (defined.has(m[1]) || local.has(m[1])) continue
      hits.push(path.relative(ROOT, file) + ':' + (src.slice(0, m.index).split('\n').length) + ' ' + m[1])
    }
  }
  return hits.sort()
}

/* 既有的一处:组件把它当「调用方可覆盖的钩子」用,没有兜底值。
   不是本轮引入,单独记账,别让它把新账一起放行。 */
const KNOWN = ['components/cy/tabs/index.wxss:3 --cy-tabs-accent']

const FILES = wxssFiles(ROOT)
const DEFINED = globalTokens()

test('扫描分母正常:token 与 wxss 都要读得到', () => {
  assert.ok(DEFINED.size > 300, '只读到 ' + DEFINED.size + ' 个 token,tokens.wxss 多半没读着')
  assert.ok(FILES.length > 100, '只扫到 ' + FILES.length + ' 个 wxss')
})

test('★不许用不存在的 --cy-* token —— 整条声明会静默作废', () => {
  assert.deepEqual(scanUndefined(FILES, DEFINED), KNOWN,
    '写之前先在 style/tokens.wxss 里搜一下这个名字真不真')
})

test('负控:注入一个编造的 token 必须判红', () => {
  const tmp = path.join(require('node:os').tmpdir(), 'wxss-undefined-token-negative.wxss')
  fs.writeFileSync(tmp, '.a { background: var(--cy-color-surface-card); }\n')
  try {
    assert.equal(scanUndefined([tmp], DEFINED).length, 1, '负控构造失败:编造的 token 没被判出来')
  } finally { fs.unlinkSync(tmp) }
})

test('负控:带兜底的 var() 不算违规 —— 那是有意的可选变量', () => {
  const tmp = path.join(require('node:os').tmpdir(), 'wxss-undefined-token-fallback.wxss')
  fs.writeFileSync(tmp, '.a { padding-top: var(--pk-top, 120rpx); background: var(--cy-nope, #fff); }\n')
  try {
    assert.deepEqual(scanUndefined([tmp], DEFINED), [], '带兜底的被误判了,门禁会天天报假警')
  } finally { fs.unlinkSync(tmp) }
})
