/* 列表渲染性能契约(2026-08-22)
 *
 * 小程序长列表最便宜也最要命的一条:wx:for 缺 wx:key。
 * 缺了之后每次往列表尾部追加数据,框架无法复用节点 ⇒ **整列表重建**,
 * 而不是只插新的那几条。数据少时完全看不出来,分页翻到第 N 页时集中爆发。
 *
 * ⚠️ 这条比引入虚拟化(recycle-view)重要得多也便宜得多:
 * 实测本仓 450 处 wx:for,分页粒度 10-20 条,大分页(50/100/200)都是 pageNum:1 的一次性加载 ——
 * 没有任何列表会无界增长到几千节点,所以虚拟化当前不是瓶颈,wx:key 才是。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'dist'])

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else if (e.name.endsWith('.wxml')) acc.push(full)
  }
  return acc
}

/** 注释用等宽空格抹掉,保住行号(见 a11y lint 里踩过的同一个坑) */
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))

function scanMissingKeys(src, rel) {
  const s = stripComments(src)
  const out = []
  for (const m of s.matchAll(/<[a-z][a-z0-9-]*\b[^>]*\swx:for=[^>]*>/g)) {
    if (/\swx:key=/.test(m[0])) continue
    out.push({ file: rel, line: s.slice(0, m.index).split('\n').length })
  }
  return out
}

test('全仓 wx:for 必须都带 wx:key(缺了会让每次追加整列表重建)', () => {
  const missing = []
  for (const abs of walk(ROOT)) {
    missing.push(...scanMissingKeys(fs.readFileSync(abs, 'utf8'), path.relative(ROOT, abs)))
  }
  assert.deepEqual(
    missing.map((m) => `${m.file}:${m.line}`), [],
    `这些 wx:for 缺 wx:key,分页翻到第 N 页时会集中爆发:\n  ${missing.map((m) => m.file + ':' + m.line).join('\n  ')}`,
  )
})

test('负控:检查器确实能抓到缺 key,也不会误伤带 key 的', () => {
  assert.equal(scanMissingKeys('<view wx:for="{{list}}"></view>', 'x').length, 1, '缺 key 必须被抓到')
  assert.equal(scanMissingKeys('<view wx:for="{{list}}" wx:key="id"></view>', 'x').length, 0, '带 key 不该误报')
  assert.equal(scanMissingKeys('<view wx:for="{{l}}" wx:key="*this"></view>', 'x').length, 0, '*this 也是合法 key')
  assert.equal(scanMissingKeys('<!-- <view wx:for="{{l}}"></view> -->', 'x').length, 0, '注释里的不算')
})

test('负控:wx:key 的检测不能被属性名前缀骗过(如 data-wx:for)', () => {
  // 只认真正的 wx:for 属性(前面必须是空白),不认名字里含 wx:for 的其它属性
  assert.equal(scanMissingKeys('<view data-x="wx:for"></view>', 'x').length, 0,
    '属性值里出现 wx:for 字样不该被当成循环')
})
