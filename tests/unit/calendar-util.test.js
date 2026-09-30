'use strict'

/* utils/calendar.js 的纯函数契约。
 *
 * 为什么值得写:跨月/跨年/闰年/首日偏移这四类错在真机上极难复现 —— 要么等到 2 月 29 号,
 * 要么等到某个月正好 1 号是周日。这里一次钉死。 */

const assert = require('node:assert/strict')
const test = require('node:test')
const cal = require('../../utils/calendar.js')

test('日期串按字典序比大小 === 按时间比大小(这是选字符串而不是 Date 的理由)', () => {
  assert.ok('2026-01-02' < '2026-01-10')
  assert.ok('2025-12-31' < '2026-01-01')
  // 负控:少补零就会破坏这条性质,所以 ymd 必须补零
  assert.equal(cal.ymd(2026, 1, 2), '2026-01-02')
  assert.ok(cal.ymd(2026, 1, 2) < cal.ymd(2026, 1, 10))
})

test('闰年二月由 Date 判定,不自己写 4/100/400', () => {
  assert.equal(cal.monthDays(2024, 2), 29)
  assert.equal(cal.monthDays(2026, 2), 28)
  assert.equal(cal.monthDays(2000, 2), 29, '整百年被 400 整除仍是闰年')
  assert.equal(cal.monthDays(1900, 2), 28, '整百年不被 400 整除不是闰年')
  assert.equal(cal.monthDays(2026, 12), 31)
})

test('首日偏移:默认周一起,周日起要显式传 0', () => {
  // 2026-09-01 是周二 → 周一起偏移 1 格,周日起偏移 2 格
  assert.equal(cal.firstDayOffset(2026, 9, 1), 1)
  assert.equal(cal.firstDayOffset(2026, 9, 0), 2)
  // 2026-02-01 是周日 → 周一起要空满 6 格,周日起 0 格。这是最容易差一天的一格
  assert.equal(cal.firstDayOffset(2026, 2, 1), 6)
  assert.equal(cal.firstDayOffset(2026, 2, 0), 0)
})

test('相隔天数跨月跨年跨闰日都不能差一天', () => {
  assert.equal(cal.daysBetween('2026-09-04', '2026-09-25'), 21, '参考图那个「21 nights」')
  assert.equal(cal.daysBetween('2026-08-31', '2026-09-01'), 1)
  assert.equal(cal.daysBetween('2025-12-31', '2026-01-01'), 1)
  assert.equal(cal.daysBetween('2024-02-28', '2024-03-01'), 2, '闰年二月要多算一天')
  assert.equal(cal.daysBetween('2026-02-28', '2026-03-01'), 1)
  assert.equal(cal.daysBetween('2026-09-25', '2026-09-04'), -21, '反向为负,不取绝对值')
})

test('月份平移跨年正确', () => {
  assert.deepEqual(cal.shiftMonth(2026, 12, 1), { year: 2027, month: 1 })
  assert.deepEqual(cal.shiftMonth(2026, 1, -1), { year: 2025, month: 12 })
  assert.deepEqual(cal.shiftMonth(2026, 8, 6), { year: 2027, month: 2 })
})

test('dayType 是枚举不是布尔组合:每个位置只有一个真相', () => {
  const sel = ['2026-09-04', '2026-09-25']
  assert.equal(cal.dayType('2026-09-04', sel, 'range'), 'start')
  assert.equal(cal.dayType('2026-09-25', sel, 'range'), 'end')
  assert.equal(cal.dayType('2026-09-10', sel, 'range'), 'middle')
  assert.equal(cal.dayType('2026-09-03', sel, 'range'), '')
  assert.equal(cal.dayType('2026-09-26', sel, 'range'), '')
  // 同一天收尾:端点重合要走独立枚举,否则 start/end 的圆角规则会互相打架
  assert.equal(cal.dayType('2026-09-04', ['2026-09-04', '2026-09-04'], 'range'), 'start-end')
  // 只有 start 时,后面的日子不能被当成 middle 提前点亮
  assert.equal(cal.dayType('2026-09-10', ['2026-09-04', null], 'range'), '')
  // 单选模式
  assert.equal(cal.dayType('2026-09-04', '2026-09-04', 'single'), 'selected')
  assert.equal(cal.dayType('2026-09-05', '2026-09-04', 'single'), '')
})

test('disabled 压过一切:不可选的日子不许显示成已选', () => {
  const off = { '2026-09-10': true }
  assert.equal(cal.dayType('2026-09-10', ['2026-09-04', '2026-09-25'], 'range', off), 'disabled')
})

test('buildMonth 只出结构:天数、偏移、标题、mark;不含选中态', () => {
  const m = cal.buildMonth(2026, 9, { marks: { '2026-09-04': '3 场' } })
  assert.equal(m.days.length, 30)
  assert.equal(m.offset, 1)
  assert.equal(m.title, '2026 年 9 月', '标题恒带年份')
  assert.equal(m.days[0].date, '2026-09-01')
  assert.equal(m.days[3].mark, '3 场')
  assert.equal(m.days[0].mark, '')
  // 结构里刻意没有 type:那是渲染层(index.wxs)按 [start,end] 现算的,
  // 否则每点一次日期都要把六个月约 180 格重新 setData 过桥
  assert.equal('type' in m.days[0], false, 'buildMonth 不许把选中态烤进结构里')
})

test('buildMonth:标题恒带年份,不因是不是当年而两副面孔', () => {
  // 一次铺 12 个月时「12 月」紧挨「2027 年 1 月」,省掉年份的那一半反而要读者自己推断
  assert.equal(cal.buildMonth(2027, 1, {}).title, '2027 年 1 月')
  assert.equal(cal.buildMonth(2026, 12, {}).title, '2026 年 12 月')
})

test('buildMonths 连续跨年,月份不重不漏', () => {
  const ms = cal.buildMonths('2026-11-15', 4, {})
  assert.deepEqual(ms.map((m) => m.key), ['2026-11', '2026-12', '2027-01', '2027-02'])
  assert.equal(ms[0].days.length, 30)
  assert.equal(ms[3].days.length, 28)
})

test('buildMonths 拒绝非法入参,返回空而不是抛', () => {
  assert.deepEqual(cal.buildMonths('', 3, {}), [])
  assert.deepEqual(cal.buildMonths('2026-09-01', 0, {}), [])
  assert.deepEqual(cal.buildMonths('2026/09/01', 3, {}), [], '斜杠格式不认,避免时区解析')
})

test('pickRange 状态机:四条路径各走一遍', () => {
  // 空 → 落 start
  assert.deepEqual(cal.pickRange(null, '2026-09-04'), { value: ['2026-09-04', null], done: false })
  // 有 start,点在后面 → 收尾
  assert.deepEqual(cal.pickRange(['2026-09-04', null], '2026-09-25'), {
    value: ['2026-09-04', '2026-09-25'], done: true,
  })
  // 有 start,点在前面 → 用户在改开始,重开而不是倒着收尾
  assert.deepEqual(cal.pickRange(['2026-09-10', null], '2026-09-04'), {
    value: ['2026-09-04', null], done: false,
  })
  // 已选满 → 重开
  assert.deepEqual(cal.pickRange(['2026-09-04', '2026-09-25'], '2026-09-11'), {
    value: ['2026-09-11', null], done: false,
  })
})

test('pickRange 同一天:默认不允许,allowSameDay 才收成 start-end', () => {
  assert.deepEqual(cal.pickRange(['2026-09-04', null], '2026-09-04'), {
    value: ['2026-09-04', null], done: false,
  })
  assert.deepEqual(cal.pickRange(['2026-09-04', null], '2026-09-04', true), {
    value: ['2026-09-04', '2026-09-04'], done: true,
  })
})

test('负控:把首日偏移写成不取模,2 月那格立刻算错', () => {
  const broken = (year, month, fdw) =>
    new Date(Date.UTC(year, month - 1, 1)).getUTCDay() - (fdw === 0 ? 0 : 1)
  // 2026-02-01 是周日:正确答案 6,漏掉 +7 取模会得到 -1
  assert.equal(cal.firstDayOffset(2026, 2, 1), 6)
  assert.equal(broken(2026, 2, 1), -1)
  assert.notEqual(broken(2026, 2, 1), cal.firstDayOffset(2026, 2, 1),
    '负控本身必须真的算出不同的值,否则这条断言什么也没证明')
})

test('addDays 跨月跨年跨闰日,负数往回走', () => {
  assert.equal(cal.addDays('2026-08-31', 1), '2026-09-01')
  assert.equal(cal.addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(cal.addDays('2024-02-28', 1), '2024-02-29')
  assert.equal(cal.addDays('2026-02-28', 1), '2026-03-01')
  assert.equal(cal.addDays('2026-01-01', -1), '2025-12-31')
})

test('quickRange:三个芯片各算一遍,含边界那两天', () => {
  // 2026-08-26 是周三 → 最近周末 = 8/29(六)~8/30(日)
  assert.equal(cal.weekday('2026-08-26'), 3)
  assert.deepEqual(cal.quickRange('weekend', '2026-08-26'), ['2026-08-29', '2026-08-30'])
  // 周六当天 → 就是本周末,不推到下周
  assert.deepEqual(cal.quickRange('weekend', '2026-08-29'), ['2026-08-29', '2026-08-30'])
  // 周日 → 周末只剩今天,不能倒回昨天(那是已经过去的日子)
  assert.deepEqual(cal.quickRange('weekend', '2026-08-30'), ['2026-08-30', '2026-08-30'])

  assert.deepEqual(cal.quickRange('next7', '2026-08-26'), ['2026-08-26', '2026-09-01'])

  // 本月:1 号早已过去 → 从今天起,不给一个点了没反应的芯片
  assert.deepEqual(cal.quickRange('month', '2026-08-26'), ['2026-08-26', '2026-08-31'])
  // 正好是 1 号 → 整月
  assert.deepEqual(cal.quickRange('month', '2026-09-01'), ['2026-09-01', '2026-09-30'])

  assert.equal(cal.quickRange('不存在的芯片', '2026-08-26'), null)
})

test('quickRange 尊重 min:算出来早于下界的一律抬上来', () => {
  assert.deepEqual(cal.quickRange('next7', '2026-08-26', '2026-09-01'),
    ['2026-09-01', '2026-09-07'], '整段一起后移,不是只裁开头')
  assert.deepEqual(cal.quickRange('weekend', '2026-08-26', '2026-09-05'),
    ['2026-09-05', '2026-09-05'], '下界晚于本周末时两端一起抬到下界')
})

test('quickRange month:min 越过本月末 → null,不给 start > end 的倒置区间', () => {
  // 旧实现只抬 start 不管 end,这组入参会返回 ['2026-09-05', '2026-08-31']
  assert.equal(cal.quickRange('month', '2026-08-26', '2026-09-05'), null)
  // min 仍在本月内:照常抬 start,end 不动
  assert.deepEqual(cal.quickRange('month', '2026-08-10', '2026-08-20'),
    ['2026-08-20', '2026-08-31'])
})


/* —— WXS 与 utils 的一致性 ——
 *
 * index.wxs 的 dayClass 是 utils 的 dayType 的第二份实现(WXS 不能 require 普通 JS 模块,
 * 只能各写一份)。两份实现漂移 = 界面显示的状态和逻辑判断的状态不是一回事,
 * 而且只会在特定日期组合下暴露。这条契约把它们逐日比对钉死。 */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadWxs() {
  const src = fs.readFileSync(
    path.join(__dirname, '../../pages/topic/components/cy/calendar/index.wxs'), 'utf8')
  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(src, sandbox)
  return sandbox.module.exports
}

test('WXS 的 dayClass 与 utils 的 dayType 逐日等价,不许漂移', () => {
  const wxs = loadWxs()
  const cases = [
    { sel: ['2026-09-04', '2026-09-25'], mode: 'range' },
    { sel: ['2026-09-04', '2026-09-04'], mode: 'range' },
    { sel: ['2026-09-04', null], mode: 'range' },
    { sel: [null, null], mode: 'range' },
    { sel: '2026-09-10', mode: 'single' },
  ]
  const disabled = { '2026-09-15': true }
  const min = '2026-09-02'
  const max = '2026-09-28'
  let checked = 0
  for (const c of cases) {
    for (let d = 1; d <= 30; d++) {
      const date = cal.ymd(2026, 9, d)
      const start = c.mode === 'range' ? c.sel[0] : c.sel
      const end = c.mode === 'range' ? c.sel[1] : ''
      const fromWxs = wxs.dayClass(date, start, end, c.mode, min, max, disabled)
      const outOfBound = date < min || date > max || disabled[date]
      const fromUtils = outOfBound
        ? 'disabled'
        : cal.dayType(date, c.sel, c.mode)
      assert.equal(fromWxs, fromUtils ? 'cyc__day--' + fromUtils : '',
        date + ' 在 ' + JSON.stringify(c.sel) + ' 下两份实现给出的状态不一致')
      checked++
    }
  }
  assert.equal(checked, 150, '比对覆盖面异常,契约可能没真跑')
})

test('负控:把 WXS 的 start/end 判定顺序调换,契约必须判红', () => {
  const wxs = loadWxs()
  // 真实实现里 start 先于 end 判定;起止同一天时先命中 start-end。
  // 构造一个「先判 end」的坏实现,同一天必然给出不同答案。
  const broken = (date, start, end) => {
    if (end && date === end) return 'cyc__day--end'
    if (start && end && start === end && date === start) return 'cyc__day--start-end'
    return ''
  }
  const same = '2026-09-04'
  assert.equal(wxs.dayClass(same, same, same, 'range', '', '', {}), 'cyc__day--start-end')
  assert.equal(broken(same, same, same), 'cyc__day--end')
  assert.notEqual(broken(same, same, same), wxs.dayClass(same, same, same, 'range', '', '', {}),
    '负控必须真的算出不同的值,否则这条断言什么也没证明')
})

test('WXS 首日偏移只作用于每月第一格', () => {
  const wxs = loadWxs()
  assert.equal(wxs.dayStyle(0, 3), 'margin-left:' + (300 / 7) + '%')
  assert.equal(wxs.dayStyle(1, 3), '', '只有 index 0 才推')
  assert.equal(wxs.dayStyle(0, 0), '', '偏移为 0 时不写空样式')
})
