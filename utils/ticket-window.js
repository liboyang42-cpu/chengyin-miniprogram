'use strict'

// CU-C-32 票种「场次是否还可售」的唯一一份判据(2026-09-25 裁决:场次开始即停售)。
//
// 走查实证:9 月 23 日仍能在活动详情的报名日期里选到 9 月 22 日的 ¥69 票并进结算。
// 根因不是数据脏 —— 是票的 startTime(场次开始时间)不参与可售判定:旧口径只拿 endTime
// 当「报名截止」用,于是「开场后、散场前」这一档照常在售。裁决把它反过来:
// 场次一到开始时间就不再是「还能报的场次」。
//
// 判据(与后端 CmsRegistrationServiceImpl 建单闸同尺,时区按 Asia/Shanghai):
//   · startTime 可解析 ⇒ 由它说话:now >= startTime ⇒ 场次已开始('started'),不可售;
//     若 endTime 也已过则另判 'ended',文案更准。未到开始 ⇒ 可售('')。
//   · startTime 缺失/不可解析 ⇒ 退到 endTime 这唯一已知边界:now > endTime ⇒ 'ended'。
//   · 两个都缺 ⇒ 不判('')。解析不出来 ≠ 过期,拿它拦会误伤正常票,
//     与「库存未知不判售罄」同一条兜底方向(见 normalizeTicket 的既有注释)。
//
// ⚠️ 比较按 utils/datetime.js 的 toTimestamp 锚定中国时区 —— 这是 B 类(过期判断)用法,
// 自己写 new Date(str.replace(/-/g,'/')) 会让非 UTC+8 的机器整体偏 8 小时。

const { toTimestamp } = require('./datetime.js')

/** '' | 'started'(场次已开始,已过报名时点) | 'ended'(场次已结束)。 */
function ticketWindowState(ticket, now) {
  if (!ticket) return ''
  const at = now === undefined || now === null ? Date.now() : now
  const start = toTimestamp(ticket.startTime)
  if (!Number.isNaN(start)) {
    if (at < start) return ''
    const end = toTimestamp(ticket.endTime)
    return !Number.isNaN(end) && at > end ? 'ended' : 'started'
  }
  const end = toTimestamp(ticket.endTime)
  if (!Number.isNaN(end)) return at > end ? 'ended' : ''
  return ''
}

function ticketWindowPassed(ticket, now) {
  return ticketWindowState(ticket, now) !== ''
}

/** 置灰/拦截时要告诉用户的那句话;可售时返回空串(调用方据此整句不出)。 */
function ticketWindowText(ticket, now) {
  const state = ticketWindowState(ticket, now)
  if (state === 'ended') return '场次已结束'
  if (state === 'started') return '场次已开始'
  return ''
}

/** 场次开始时间升序排;无/不可解析的开始时间沉底。同日多场靠时间区分,先排才看得出来。 */
function sortBySessionStart(tickets) {
  const list = Array.isArray(tickets) ? tickets.slice() : []
  return list.sort((a, b) => {
    const sa = a ? toTimestamp(a.startTime) : NaN
    const sb = b ? toTimestamp(b.startTime) : NaN
    const na = Number.isNaN(sa)
    const nb = Number.isNaN(sb)
    if (na && nb) return 0
    if (na) return 1
    if (nb) return -1
    return sa - sb
  })
}

module.exports = { ticketWindowPassed, ticketWindowText, ticketWindowState, sortBySessionStart }
