const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const WXML = 'pages/activity/list/index.wxml'
const WXSS = 'pages/activity/list/index.wxss'

/**
 * 城市事件卡片无封面兜底(2026-08-04)。
 *
 * `official_event.cover_img` 是 `DEFAULT NULL`(migration_official_event.sql:16),
 * 封面走 background-image,没有 URL 时那块 75% 高的区域会是一片纯色空白 ——
 * 而模板页/发布广场早有「封面暂不可用」范式。这条门禁锁住两页一致。
 */

test('无封面时渲染「封面暂不可用」兜底,而不是一片空白', () => {
  const wxml = read(WXML)
  const cover = wxml.match(/<view class="oe-cover"[\s\S]*?<\/view>\s*<\/view>/)
  assert.ok(cover, 'oe-cover 结构未找到,兜底断言的锚点失效')
  const block = cover[0]

  assert.match(block, /wx:if="\{\{!item\._coverStyle\}\}"/, '兜底必须挂在「没有封面样式」这个条件上')
  assert.match(block, /class="cover-error"/, '必须复用既有 .cover-error 范式,不另造一套')
  assert.match(block, /封面暂不可用/, '兜底文案必须与模板页/发布广场一致')
  assert.match(block, /aria-label=/, '兜底块要有无障碍标签')
})

test('兜底层铺满封面区:父级靠 padding-top 撑比例,兜底必须 absolute inset:0', () => {
  const wxss = read(WXSS)
  assert.match(wxss, /\.oe-cover\{[^}]*position:relative/, '.oe-cover 必须是定位上下文')
  assert.match(wxss, /\.oe-cover \.cover-error\{[^}]*position:absolute/, '兜底层必须绝对定位')
  assert.match(wxss, /\.oe-cover \.cover-error\{[^}]*inset:0/, '兜底层必须铺满,否则高度为 0 看不见')
})

test('负控:兜底块被删掉时必须判红', () => {
  const wxml = read(WXML)
  const mutated = wxml.replace(/<view wx:if="\{\{!item\._coverStyle\}\}"[\s\S]*?<\/view>\s*/, '')
  assert.notEqual(mutated, wxml, '变异锚点失效')
  // ⚠️ 别拿「封面暂不可用」当断言锚点:本文件的说明注释里也有这五个字,
  //    删掉整个兜底块之后它照样匹配得到 ⇒ 负控会假绿(第一版就栽在这)。
  //    锚定只存在于真实结构里的东西。
  assert.throws(() => assert.match(mutated, /class="cover-error"/), assert.AssertionError)
  assert.throws(() => assert.match(mutated, /wx:if="\{\{!item\._coverStyle\}\}"/), assert.AssertionError)
})

test('负控:兜底层丢掉 absolute 铺满时必须判红(高度会塌成 0)', () => {
  const wxss = read(WXSS)
  const mutated = wxss.replace(/(\.oe-cover \.cover-error\{)position:absolute;inset:0;/, '$1')
  assert.notEqual(mutated, wxss, '变异锚点失效')
  assert.throws(
    () => assert.match(mutated, /\.oe-cover \.cover-error\{[^}]*position:absolute/),
    assert.AssertionError,
  )
})

test('文案与既有范式同源:模板页仍是「封面暂不可用」', () => {
  // 若哪天有人改了模板页的措辞,这条会提醒两处一起改,别让两页各说各话
  assert.match(read('pages/template/index.wxml'), /封面暂不可用/)
})

// ── 生产者侧 ──────────────────────────────────────────────
// ⚠️ 上面全是 wxml/wxss 文本断言,只护住了「消费者」。触发兜底的条件是
// `_coverStyle` 为空,而它由 index.js 的 _decorate 产出 —— 只要有人把那行改成
// 「无封面时给个默认渐变」,兜底立刻变成永不进入的死代码,而上面 5 条全绿。
// 房规范式(mytemplate-cover-fallback / publish-square-cover-fallback)都驱动页面 .js,
// 这里照做:把 _decorate 抠出来真跑一遍。

/** 从 index.js 里取出 _decorate 并在最小桩环境下执行 */
function runDecorate(activity) {
  const src = read('pages/activity/list/index.js')
  const m = src.match(/_decorate\(e\)\s*\{[\s\S]*?\n  \},/)
  assert.ok(m, '_decorate 未找到,生产者断言的锚点失效')
  const body = m[0].replace(/^_decorate\(e\)\s*\{/, '').replace(/\},$/, '')
  // _decorate 依赖两个模块级 helper,给出与真实实现同形的桩:它们的返回值不影响
  // _coverStyle 这条链路,这里只要不炸即可。officialChannel 走真模块(缺口字段由 F21 契约钉)。
  const fn = new Function('e', 'activityStatusMeta', 'timeText', 'officialChannel', body + '\nreturn e;')
  return fn(activity, () => ({ text: '', variant: '', live: false }), () => '',
    require('../../utils/merchant-official-channel.js'))
}

test('生产者:无封面时 _coverStyle 必须为空,兜底才可能被触发', () => {
  assert.equal(runDecorate({ id: 1, title: 'x' })._coverStyle, '', '缺 coverImg 字段时应为空')
  assert.equal(runDecorate({ id: 1, title: 'x', coverImg: '' })._coverStyle, '', '空串封面应为空')
  assert.equal(runDecorate({ id: 1, title: 'x', coverImg: null })._coverStyle, '', 'null 封面应为空')
})

test('生产者:有封面时 _coverStyle 非空,兜底不得抢占正常封面', () => {
  const style = runDecorate({ id: 1, title: 'x', coverImg: 'https://cdn/a b(1).jpg' })._coverStyle
  assert.match(style, /^background-image:url\('/, '有封面时必须产出 background-image')
  assert.doesNotMatch(style, /'\)\.jpg/, "路径里的单引号需转义,别打断整条 style")
})

test('负控:生产者改成「无封面也给个默认样式」时必须判红(否则兜底成死代码)', () => {
  const src = read('pages/activity/list/index.js')
  const mutated = src.replace(
    /e\._coverStyle = e\.coverImg \? ([^;]+) : '';/,
    "e._coverStyle = e.coverImg ? $1 : 'background-image:linear-gradient(#000,#111)';",
  )
  assert.notEqual(mutated, src, '变异锚点失效')
  // 用变异后的源码跑同一条断言,必须红
  const m = mutated.match(/_decorate\(e\)\s*\{[\s\S]*?\n  \},/)
  const body = m[0].replace(/^_decorate\(e\)\s*\{/, '').replace(/\},$/, '')
  const fn = new Function('e', 'activityStatusMeta', 'timeText', 'officialChannel', body + '\nreturn e;')
  const out = fn({ id: 1, title: 'x' }, () => ({ text: '', variant: '', live: false }), () => '',
    require('../../utils/merchant-official-channel.js'))
  assert.throws(() => assert.equal(out._coverStyle, ''), assert.AssertionError)
})
