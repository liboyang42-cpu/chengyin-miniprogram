// 选择器统一契约(2026-08-25)
//
// 收口前全仓有四套「选一个值」的落地方式:
//   ① <picker range=...>          28 处 —— 系统底部滚轮,对 ≤7 项枚举太重
//   ② <picker mode="date/time">   14 处 —— 系统层,字体/圆角/深浅色全不受设计系统控制
//   ③ cy-date-sheet + 自绘 picker-view
//   ④ cy-sheet + 自绘 picker-view
// 同一个动作四种长相。①② 已分别迁到 cy-dropdown 与 cy-date-field。
//
// 这条门禁挡的是「烂回去」:没有 CI 强制的统一,一定会在下一个需求里被绕开。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'dist', 'scripts', 'tests', 'docs', 'artifacts'])

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else if (e.name.endsWith('.wxml')) acc.push(full)
  }
  return acc
}

// <picker-view> 是允许的:它是 cy-date-sheet / cy-date-field 面板【内部】的滚轮本体。
// 禁的是 <picker>(带空格或 > 收尾),那是系统弹层。
const NATIVE_PICKER = /<picker(?=[\s>])/

function offenders(files) {
  const hits = []
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    if (NATIVE_PICKER.test(src)) hits.push(path.relative(ROOT, file))
  }
  return hits
}

test('全仓不得再出现原生 <picker>:枚举走 cy-dropdown,日期/时间走 cy-date-field', () => {
  const hits = offenders(walk(ROOT))
  assert.deepEqual(hits, [],
    '这些文件还在用系统 picker,视觉不受设计系统控制:\n  ' + hits.join('\n  '))
})

test('两个替代组件都在,且各自声明了适用判据', () => {
  const dropdown = fs.readFileSync(path.join(ROOT, 'components/cy/dropdown/index.js'), 'utf8')
  const dateField = fs.readFileSync(path.join(ROOT, 'components/cy/date-field/index.js'), 'utf8')
  assert.match(dropdown, /cy-dropdown/, 'cy-dropdown 组件缺失')
  assert.match(dateField, /cy-date-field/, 'cy-date-field 组件缺失')
  // 判据必须写在代码里,否则下一个人不知道该选哪个
  assert.match(dropdown, /cy-date-sheet/, 'cy-dropdown 必须写明与底部面板的分工判据')
  assert.match(dateField, /YYYY-MM-DD/, 'cy-date-field 必须写明与原生 picker 值格式一致')
})

test('negative control:任何一处写回 <picker mode="date"> 必须判红', () => {
  const tmp = path.join(ROOT, 'tests/unit/__picker_negative_control__.wxml')
  fs.writeFileSync(tmp, '<view><picker mode="date" value="{{x}}"><view>选日期</view></picker></view>')
  try {
    assert.deepEqual(offenders([tmp]).length, 1, '检查器认不出系统 picker,这条门禁是恒真的')
  } finally {
    fs.unlinkSync(tmp)
  }
})

test('negative control:<picker-view> 是面板内部滚轮,不许被误伤', () => {
  const tmp = path.join(ROOT, 'tests/unit/__pickerview_negative_control__.wxml')
  fs.writeFileSync(tmp, '<picker-view value="{{i}}"><picker-view-column><view>1</view></picker-view-column></picker-view>')
  try {
    assert.deepEqual(offenders([tmp]), [], 'picker-view 被误判成系统 picker,会把所有滚轮面板一起判红')
  } finally {
    fs.unlinkSync(tmp)
  }
})
