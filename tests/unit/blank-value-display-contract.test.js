// DS 空值硬规(方案 §3.4 / §11.2-1 / §11.4 P0 追加):
// 绑定值为空 ⇒ 渲 '—' 或占位文案,禁止渲出裸 ¥、空白行、空冒号行。
//
// 本文件管其中最机械、最可判的一条:金额位。全仓不得再出现 `¥{{expr}}` 这种
// 「¥ 是死字符、数值来自绑定」的写法 —— expr 为空时屏幕上只剩一个孤零零的 ¥。
// 正确写法是 `{{money.amount(expr)}}`,由 utils/wxs/money.wxs 决定空值渲 '—'。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['node_modules', 'tests', '.git', 'miniprogram_npm'])

function allWxml(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) allWxml(p, out)
    else if (e.name.endsWith('.wxml')) out.push(p)
  }
  return out
}

const BARE = /¥\{\{/

test('全仓 wxml 不得出现裸 ¥{{...}}(空值会渲成孤零零一个 ¥)', () => {
  const bad = []
  for (const p of allWxml()) {
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (BARE.test(line)) bad.push(`${path.relative(ROOT, p)}:${i + 1}`)
    })
  }
  assert.deepEqual(bad, [], `这些位置的 ¥ 是死字符,数值为空时只剩 ¥:\n  ${bad.join('\n  ')}`)
})

test('money.amount:空值渲 —,0 是合法金额不能被吃掉', () => {
  // wxs 不是 CommonJS,这里按同一份源码求值,保证断言的就是线上那份逻辑
  const src = fs.readFileSync(path.join(ROOT, 'utils/wxs/money.wxs'), 'utf8')
  const sandbox = { module: { exports: {} } }
  new Function('module', src)(sandbox.module)
  const { amount } = sandbox.module.exports

  assert.equal(amount(undefined), '—')
  assert.equal(amount(null), '—')
  assert.equal(amount(''), '—')
  // 0 / '0' / '0.00' 都是真实金额,必须照渲
  assert.equal(amount(0), '¥0')
  assert.equal(amount('0'), '¥0')
  assert.equal(amount('0.00'), '¥0.00')
  assert.equal(amount('12.50'), '¥12.50')
})

test('引用 money.amount 的 wxml 都真的 import 了这个 wxs 模块', () => {
  const missing = []
  for (const p of allWxml()) {
    const s = fs.readFileSync(p, 'utf8')
    if (!s.includes('money.amount(')) continue
    if (!/<wxs\s+src="[^"]*utils\/wxs\/money\.wxs"\s+module="money"\s*\/>/.test(s)) {
      missing.push(path.relative(ROOT, p))
    }
  }
  assert.deepEqual(missing, [], `用了 money.amount 却没 import:\n  ${missing.join('\n  ')}`)
})

test('money.wxs 的相对路径在每个引用方都能真解析到文件', () => {
  const broken = []
  for (const p of allWxml()) {
    const s = fs.readFileSync(p, 'utf8')
    const m = s.match(/<wxs\s+src="([^"]*utils\/wxs\/money\.wxs)"/)
    if (!m) continue
    if (!fs.existsSync(path.resolve(path.dirname(p), m[1]))) {
      broken.push(`${path.relative(ROOT, p)} -> ${m[1]}`)
    }
  }
  assert.deepEqual(broken, [], `wxs 相对路径解析不到:\n  ${broken.join('\n  ')}`)
})
