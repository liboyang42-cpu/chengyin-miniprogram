'use strict'

/* 玩法壳的触感覆盖(2026-08-27)
 *
 * 8-26 那轮排查的结论:城瘾的点击反馈只做了「按下」和「请求中」,**缺的是第三段 ——
 * 「做成了」**。九个玩法壳里只有 `playkit-woodfish` 有 `motion.haptic`,其余八个
 * 从头到尾没有任何触觉反馈。
 *
 * ⚠️ 这条门禁钉的不是「每个壳都要震」,而是**每个壳都要在自己那个「做成了」的动作上震一次**:
 *   · 不可撤销的动作(作答 / 放弃 / 收下签)→ medium;
 *   · 开关与收集类(播放暂停 / 点已收集的贴纸 / 提交命名 / 订阅)→ light;
 *   · `playkit-steps` 落在**步数达标**那一刻,不是「刷新」按钮 ——
 *     刷新只是去取数,取回来还没达标就震一下是骗人。
 *
 * ⚠️ 触感必须走 `motion.haptic({ reducedMotion })`,不许直接调 `wx.vibrateShort`:
 *   前者在「减少动态效果」下会整条静音并返回 false,后者不会 ——
 *   而对触觉敏感的用户来说,关掉动效却照震,比不给反馈更糟。
 */

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
// 2026-09-09 玩法壳整族搬进 pages/play 分包(主包只服务 play 的东西不该占主包预算)
const DIR = path.join(ROOT, 'pages/play/components')

/* ⚠️ 只扫 `playkit-*`,**不含分发器 `pages/play/components/playkit`**:
   它只负责按 kind 把事件转给对应的壳,自己没有任何用户动作,不该有触感。 */
function shells() {
  return fs.readdirSync(DIR)
    .filter((name) => name.startsWith('playkit-'))
    .sort()
}
const read = (name) => fs.readFileSync(path.join(DIR, name, 'index.js'), 'utf8')

test('每个玩法壳都有一次触感,且都走 motion.haptic', () => {
  const list = shells()
  assert.ok(list.length >= 9, '玩法壳只扫到 ' + list.length + ' 个,扫描器可能坏了')
  // 相册只有浏览和关闭，没有完成动作；不能为通过门禁伪造完成触感。
  const missing = list.filter((name) => name !== 'playkit-album' && !/motion\.haptic\(/.test(read(name)))
  assert.deepEqual(missing, [],
    '这些壳没有任何触觉反馈 —— 玩法做完了却没有「做成了」的手感:\n  ' + missing.join('\n  '))
})

test('★不许绕过 motion.haptic 直接调 wx.vibrateShort —— 那会在减动效下照震', () => {
  const offenders = shells().filter((name) => /wx\.vibrateShort/.test(read(name)))
  assert.deepEqual(offenders, [],
    'motion.haptic 会在 reducedMotion 时静音,裸 wx.vibrateShort 不会:\n  ' + offenders.join('\n  '))
})

test('★每次触感都必须把 reducedMotion 传进去 —— 不传等于永远不静音', () => {
  const bad = []
  for (const name of shells()) {
    const src = read(name)
    for (const m of src.matchAll(/motion\.haptic\(([^)]*)\)/g)) {
      if (!/reducedMotion/.test(m[1])) bad.push(name + ' → motion.haptic(' + m[1].trim() + ')')
    }
  }
  assert.deepEqual(bad, [], '少传 reducedMotion 的调用:\n  ' + bad.join('\n  '))
})

test('壳要接 reduced-motion behavior,否则 this.data.reducedMotion 恒为 undefined', () => {
  const bad = shells().filter((name) => {
    const src = read(name)
    if (!/motion\.haptic\(/.test(src)) return false
    // 两种合法形态:老壳接 behavior;2026-09-22 起的新壳按现场感契约 §6.1 **不许**用
    // Behavior(node 测试环境没有这个全局),改 require motion-preference.readReducedMotion
    return !/behaviors:\s*\[[^\]]*reducedMotionBehavior/.test(src)
      && !/readReducedMotion/.test(src)
  })
  assert.deepEqual(bad, [],
    '传了减动效开关却没接 behavior 也没读 motion-preference,读到的永远是 undefined ——\n' +
    '  静音分支形同虚设,而且没有任何断言会告诉你:\n  ' + bad.join('\n  '))
})

test('★steps 的触感落在「达标」而不是「刷新」,且只在跨越那一刻震一次', () => {
  const src = read('playkit-steps')
  assert.doesNotMatch(src, /onRefresh\(\)\s*\{[^}]*motion\.haptic/,
    '刷新只是去取数,取回来还没达标就震一下是骗人')
  assert.match(src, /_reachedGoal !== undefined && !this\._reachedGoal && percent >= 100/,
    '必须是「从没达标 → 达标」这条**边**:首屏就已达标不该凭空震,已达标后再刷新也不该重复震')
})

test('★负控:随便去掉一个壳的触感,门禁必须判红', () => {
  const victim = shells().find((name) => /motion\.haptic\(/.test(read(name)))
  const broken = read(victim).replace(/motion\.haptic\([^)]*\);?/g, '')
  assert.notEqual(broken, read(victim), '负控必须真的改动了输入')
  assert.equal(/motion\.haptic\(/.test(broken), false,
    '坏版本里确实没有触感了 —— 上面第一条断言会因此判红')
})

test('★负控:把 motion.haptic 换成裸 wx.vibrateShort,门禁必须判红', () => {
  const victim = shells().find((name) => /motion\.haptic\(/.test(read(name)))
  const broken = read(victim).replace(/motion\.haptic\([^)]*\)/, "wx.vibrateShort({ type: 'light' })")
  assert.notEqual(broken, read(victim), '负控必须真的改动了输入')
  assert.match(broken, /wx\.vibrateShort/, '坏版本里确实绕过了 motion.haptic')
})

test('相册展示壳只报告翻页和关闭，不提交完成或触发奖励', () => {
  const src = read('playkit-album')
  assert.doesNotMatch(src, /motion\.haptic|sendRequest|session|submit|settle|claim/)
  assert.deepEqual([...src.matchAll(/triggerEvent\('([^']+)'/g)].map(m => m[1]), ['close'])
})
