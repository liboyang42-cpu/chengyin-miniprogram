'use strict'

/* utils/timerange.js 的纯函数契约。
 *
 * 为什么值得写:时段的判断原来**各写各的** —— topic/merchantapply、publish/activity、
 * publish/fabu、couponInfo 走 time-picker-options 的 isEndAfterStart,
 * 而 merchant/game-node 与 play/celebrate 干脆没有任何校验;
 * play/celebrate 旁边写着「120—210 分钟」,全仓没有一处算过这个时长。
 *
 * ⚠️ 本文件只测 time-picker-options **没有**的那部分(字符串互转 / 跨天跨度 / 时长上下限)。
 * 滚轮选项与 isEndAfterStart 属于那一支,不在这里重复实现,也不在这里重复测。 */

const assert = require('node:assert/strict')
const test = require('node:test')
const tr = require('../../utils/timerange.js')
const opts = require('../../utils/time-picker-options.js')

test('toMinutes:非法一律 -1,不能退回 0 —— 0 是合法的 00:00', () => {
  assert.equal(tr.toMinutes('00:00'), 0)
  assert.equal(tr.toMinutes('09:30'), 570)
  assert.equal(tr.toMinutes('23:59'), 1439)
  assert.equal(tr.toMinutes('9:30'), 570, '单位数小时也认')
  assert.equal(tr.toMinutes(''), -1)
  assert.equal(tr.toMinutes('24:00'), -1, '24 点不是合法钟点')
  assert.equal(tr.toMinutes('12:60'), -1)
  assert.equal(tr.toMinutes('12-30'), -1)
  assert.notEqual(tr.toMinutes('00:00'), tr.toMinutes(''),
    '合法的午夜与非法输入必须能区分,否则调用方无法判断')
})

test('fromMinutes:补零,跨过一天取模', () => {
  assert.equal(tr.fromMinutes(0), '00:00')
  assert.equal(tr.fromMinutes(570), '09:30')
  assert.equal(tr.fromMinutes(1439), '23:59')
  assert.equal(tr.fromMinutes(1560), '02:00', '26:00 要显示成次日 02:00')
  assert.equal(tr.fromMinutes(-1), '')
})

test('spanMinutes:不跨天时结束不晚于开始就是非法', () => {
  assert.equal(tr.spanMinutes('09:00', '17:30'), 510)
  assert.equal(tr.spanMinutes('09:00', '09:00'), 0, '同一刻是 0 分钟,不是非法')
  assert.equal(tr.spanMinutes('17:00', '09:00'), -1, '倒过来且不许跨天 = 非法')
  assert.equal(tr.spanMinutes('', '09:00'), -1)
})

test('spanMinutes:允许跨天时倒过来算次日(isEndAfterStart 明确不管这个场景)', () => {
  assert.equal(tr.spanMinutes('22:00', '02:00', true), 240)
  assert.equal(tr.spanMinutes('23:30', '00:30', true), 60)
  assert.equal(tr.spanMinutes('09:00', '17:00', true), 480, '正常顺序不受影响')
  assert.equal(tr.spanMinutes('09:00', '09:00', true), 0,
    '同一刻仍是 0,不能被解释成整整 24 小时')
})

test('与 time-picker-options 的 isEndAfterStart 在同一天场景下结论一致', () => {
  const same = (s, e) => {
    const [sh, sm] = s.split(':').map(Number)
    const [eh, em] = e.split(':').map(Number)
    const legacy = opts.isEndAfterStart({ hour: sh, minute: sm }, { hour: eh, minute: em })
    const mine = tr.spanMinutes(s, e) > 0
    assert.equal(mine, legacy, s + '→' + e + ' 两支给出的结论必须一致')
  }
  same('09:00', '17:00')
  same('17:00', '09:00')
  same('09:00', '09:00')
  same('00:00', '23:59')
})

test('formatSpan:整点省掉分,不足一小时只说分', () => {
  assert.equal(tr.formatSpan(90), '1 小时 30 分')
  assert.equal(tr.formatSpan(120), '2 小时')
  assert.equal(tr.formatSpan(45), '45 分钟')
  assert.equal(tr.formatSpan(0), '')
  assert.equal(tr.formatSpan(-1), '')
})

test('validate:四类失败各给一个能区分的 reason', () => {
  assert.deepEqual(tr.validate('09:00', '17:00'), { ok: true, minutes: 480, reason: '' })
  assert.deepEqual(tr.validate('17:00', '09:00'), { ok: false, minutes: -1, reason: 'not-after' })
  assert.deepEqual(tr.validate('09:00', '09:00'), { ok: false, minutes: 0, reason: 'not-after' })
  assert.deepEqual(tr.validate('', '09:00'), { ok: false, minutes: -1, reason: 'invalid' })
  // play/celebrate 那条「120—210 分钟」终于有人算了
  assert.deepEqual(tr.validate('19:00', '20:00', { minMinutes: 120, maxMinutes: 210 }),
    { ok: false, minutes: 60, reason: 'too-short' })
  assert.deepEqual(tr.validate('19:00', '23:00', { minMinutes: 120, maxMinutes: 210 }),
    { ok: false, minutes: 240, reason: 'too-long' })
  assert.deepEqual(tr.validate('19:00', '21:30', { minMinutes: 120, maxMinutes: 210 }),
    { ok: true, minutes: 150, reason: '' })
})

test('validate 越界时把真实分钟数一起返回:调用方要能说出「现在是 60 分钟」', () => {
  const r = tr.validate('19:00', '20:00', { minMinutes: 120 })
  assert.equal(r.minutes, 60, '只说「太短」不说短多少,用户不知道该往哪调')
})

test('validate 不修改输入:越界只判定,不夹到合法值', () => {
  const r = tr.validate('19:00', '23:00', { maxMinutes: 210 })
  assert.equal(r.ok, false)
  assert.equal(r.minutes, 240, '真实值原样返回,不是被夹过的 210')
})

test('步进映射来自 time-picker-options,且返回数字不是补零字符串', () => {
  assert.deepEqual(opts.minuteOptions(15), [0, 15, 30, 45])
  assert.equal(opts.minuteOptions(5).length, 12)
  assert.equal(opts.minuteOptions(0).length, 60, 'step=0 会死循环,必须退回 1')
  assert.equal(opts.minuteOptions(-5).length, 60)
  assert.equal(opts.minuteOptions(90).length, 60, '大于 60 无意义,退回 1')
  // ⚠️ 该文件明确警告过:选项必须是数字,调用方会拿去做算术。补零只在展示层。
  assert.equal(typeof opts.minuteOptions(15)[1], 'number')
  assert.equal(opts.MINUTES.length, 60, '既有 5 个调用方仍用 60 档,一行没动')
})

test('minuteIndex 取最近一格,minuteAt 反查得回去', () => {
  assert.equal(opts.minuteIndex(30, 15), 2)
  assert.equal(opts.minuteIndex(7, 5), 1, '07 更靠近 05')
  assert.equal(opts.minuteIndex(8, 5), 2, '08 更靠近 10')
  assert.equal(opts.minuteAt(1, 5), 5)
  assert.equal(opts.minuteAt(99, 5), 0, '越界回 0,不能是 undefined —— 下游算术会变 NaN')
})

test('toIndex/fromIndex 往返:吸附后必须能反查成新的真值', () => {
  assert.deepEqual(tr.toIndex('09:30', 5), [9, 6])
  assert.equal(tr.fromIndex([9, 6], 5), '09:30')
  // step=5 而值是 09:07 → 吸附到 09:05;调用方必须用 fromIndex 把它当作新真值,
  // 否则滚轮显示 05 而内部还记着 07,落下去的不是用户看到的那个时间
  assert.deepEqual(tr.toIndex('09:07', 5), [9, 1])
  assert.equal(tr.fromIndex(tr.toIndex('09:07', 5), 5), '09:05')
  assert.deepEqual(tr.toIndex('', 5), [0, 0])
  assert.equal(tr.fromIndex([], 5), '00:00')
})

test('负控:把 spanMinutes 的「不晚于即非法」写成取绝对值,倒序时间会被悄悄放行', () => {
  const broken = (s, e) => Math.abs(tr.toMinutes(e) - tr.toMinutes(s))
  assert.equal(tr.spanMinutes('17:00', '09:00'), -1)
  assert.equal(broken('17:00', '09:00'), 480)
  assert.notEqual(broken('17:00', '09:00'), tr.spanMinutes('17:00', '09:00'),
    '负控必须真的算出不同的值,否则这条断言什么也没证明')
})

test('负控:minuteIndex 若改成向下取整而非取最近,08 分会被吸到 05', () => {
  const broken = (minute, step) => Math.floor((Number(minute) || 0) / step)
  assert.equal(opts.minuteIndex(8, 5), 2, '正确答案:08 更靠近 10')
  assert.equal(broken(8, 5), 1)
  assert.notEqual(broken(8, 5), opts.minuteIndex(8, 5),
    '负控必须真的算出不同的值,否则这条断言什么也没证明')
})
