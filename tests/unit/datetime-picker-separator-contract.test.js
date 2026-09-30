'use strict'

/* 日期时刻选择器:两处不许再各写一份四滚轮面板(2026-08-27)
 *
 * 这条契约的第一版(同日早些时候)钉的是**分隔符文案** —— 两处 datetime 面板里,
 * 「日期」列和「时刻」列之间写着「至」,而「至」是区间连接词、这两列却是同一个时刻的
 * 两个部分,读起来是「9 月 1 日 **至** 14:30」。当时只把「至」改成「的」。
 *
 * 现在结构本身没了:两处都换成 `cy-datetime-range`,日期与时刻合成**一个** 3 列滚轮,
 * 中间根本不存在分隔符。于是本契约改钉更上游的一条 ——
 * **这两处不许再回到「自己拼四个滚轮」**,那正是分隔符问题的来源,
 * 也是「选结束时看不到开始选了什么」「没人显示这段有多长」的来源。
 *
 * ⚠️ 隔壁 `cy-time-range` 里的「至」是**对的**(那里左右两侧确实是区间两端),
 * 顺手改掉会误伤,所以一并钉住。
 */

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const CALLERS = [
  ['pages/publish/components/reward-selector/index.wxml', 'pages/publish/components/reward-selector/index.json'],
  ['subpackageMember/couponInfo/couponInfo.wxml', 'subpackageMember/couponInfo/couponInfo.json'],
]

test('两处有效期选择都走 cy-datetime-range,不再自己拼滚轮', () => {
  for (const [wxmlPath, jsonPath] of CALLERS) {
    const wxml = read(wxmlPath)
    assert.match(wxml, /<cy-datetime-range/, wxmlPath + ' 应使用 cy-datetime-range')
    assert.equal(wxml.includes('<picker-view'), false,
      wxmlPath + ' 又自己拼滚轮了 —— 四滚轮双面板正是「看不到另一头 / 不显示跨度 / 需要一个连接词」的来源')
    assert.match(read(jsonPath), /"cy-datetime-range"/, jsonPath + ' 没注册组件,页面会渲染成空节点')
  }
})

test('组件里日期与时刻是同一个 picker-view 的两列,中间没有连接词可插', () => {
  const wxml = read('components/cy/datetime-range/index.wxml')
  // 一个 picker-view、三列(日期 / 时 / 分)
  assert.equal((wxml.match(/<picker-view[ >]/g) || []).length, 1,
    '拆成两个 picker-view 就又需要在中间放一个词,而没有哪个词是对的')
  assert.equal((wxml.match(/<picker-view-column>/g) || []).length, 3)
})

test('cy-time-range 的两端各自标注「开始」「结束」,不靠中间放词来说明', () => {
  const wxml = read('pages/merchant/components/cy/time-range/index.wxml')
  // 2026-08-29 对齐现码:该组件已委托给 cy-date-sheet,两端用 ctr__unit 各自标注,
  // 中间不再有分隔词 —— 这正是本文件想要的结果(没有哪个词是对的,那就不放词)。
  // 原断言写的是更早形态的 ctr__sep">至< + ctr__label,现码里两者都不存在。
  assert.match(wxml, /ctr__unit">开始</,
    '区间起点必须自己标注「开始」,不能靠中间的连接词让人猜')
  assert.match(wxml, /ctr__unit">结束</,
    '区间终点必须自己标注「结束」')
  assert.doesNotMatch(wxml, /ctr__sep/,
    '两端已各自标注,中间不该再出现分隔词槽位')
})

test('负控:把调用方改回自己拼滚轮,契约必须判红', () => {
  const broken = read(CALLERS[0][0]).replace(
    /<cy-datetime-range[\s\S]*?\/>/,
    '<picker-view value="{{startDateIndex}}"><picker-view-column /></picker-view>')
  assert.equal(broken.includes('<cy-datetime-range'), false, '负控必须真的改动了输入')
  assert.equal(broken.includes('<picker-view'), true, '坏版本里确实回到了裸滚轮 —— 上面那条断言会因此判红')
})
