'use strict'

const { currentPlayerRoamMemory } = require('../../../utils/roam-player-memory.js')
const { readNonNegative } = require('../../../utils/roam-history-metrics.js')
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js')
const { buildReplaySchedule, buildRouteGeometry, replayFrame } = require('./route-replay.js')
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function nonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function nonNegativeInteger(value) {
  const number = nonNegativeNumber(value)
  return number !== null && Number.isInteger(number) ? number : null
}

// ★ 与 subpackageRoam/session 页面版同源的合法性校验,必须一起搬 —— 不能只搬渲染。
// 它区分的是两种**不同**的错误态:
//   · 存储读不出来 / 记录结构坏了 → 「漫游记录读不出来」(记录还在,可重试)
//   · ts 找不到对应记录          → 「找不到这次漫游」(本地只留最近 50 条,可能被清理了)
// 少了它,坏数据(比如 pois 里混进非法坐标)会被当成 ready 渲染出一张错的卡,
// 或者被当成「找不到」—— 而真相是「读到了但是坏的」,那是给用户一句错的解释。
function isValidCoordinate(value, max) {
  const primitive = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
  if (!primitive) return false
  const number = Number(value)
  return Number.isFinite(number) && Math.abs(number) <= max
}

function isValidPoint(point) {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return false
  if (point.lat == null && point.lng == null) return true
  return isValidCoordinate(point.lat, 90) && isValidCoordinate(point.lng, 180)
}

function isValidSession(raw) {
  const timestamp = raw && raw.ts
  const timestampPrimitive = typeof timestamp === 'number'
    || (typeof timestamp === 'string' && timestamp.trim() !== '')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || !timestampPrimitive || !Number.isFinite(Number(timestamp))) return false
  return ['pois', 'track'].every((key) => {
    const points = raw[key]
    if (points == null) return true
    if (!Array.isArray(points)) return false
    for (let i = 0; i < points.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(points, i) || !isValidPoint(points[i])) return false
    }
    return true
  })
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    ts: { type: String, value: '' },
    // 第二轮拍板 17:朋友分享来的足迹快照(已由分享者裁剪)。给了它就不读本机存储,也不再出分享按钮。
    snapshot: { type: Object, value: null },
  },
  data: {
    state: 'loading',
    session: { pois: [] },
    routeSegs: [],
    routePoiDots: [],
    replaySegs: [],
    replayProgress: 0,
    replayState: 'idle',
  },
  observers: {
    ts() { this._load() },
    snapshot() { this._load() },
  },
  lifetimes: {
    attached() { this._load() },
    detached() { this._clearReplayTimer() },
  },
  methods: {
    _load() {
      this._clearReplayTimer()
      this.setData({ state: 'loading' })
      if (this.data.snapshot) {
        this._render(this.data.snapshot)
        return
      }
      let stored
      try {
        const sessionState = currentPlayerRoamMemory(getApp(), wx).readSessionState()
        if (!sessionState.ok) throw new Error('漫游记录存储损坏')
        stored = sessionState.sessions
      } catch (_) {
        this.setData({ state: 'error', session: { pois: [] } })
        return
      }
      const sessions = stored == null || stored === '' ? [] : stored
      if (!Array.isArray(sessions)) {
        this.setData({ state: 'error', session: { pois: [] } })
        return
      }
      const target = String(this.data.ts || '')
      const raw = sessions.find((item) => item && typeof item === 'object' && String(item.ts) === target)
      if (!raw) {
        this.setData({ state: 'empty', session: { pois: [] } })
        return
      }
      this._render(raw)
    },
    _render(raw) {
      // 坏数据 ≠ 没这条记录:前者说「读不出来,记录还在」,后者说「可能被清理了」。
      if (!isValidSession(raw)) {
        this.setData({ state: 'error', session: { pois: [] } })
        return
      }
      const session = this._normalize(raw)
      const route = buildRouteGeometry(session)
      this.setData({
        state: 'ready',
        session,
        routeSegs: route.segs,
        routePoiDots: route.poiDots,
        replaySegs: route.segs,
        replayProgress: route.segs.length ? 100 : 0,
        replayState: 'idle',
      })
    },
    _normalize(raw) {
      const timestamp = Number(raw.ts)
      const date = new Date(Number.isFinite(timestamp) ? timestamp : NaN)
      const validDate = !Number.isNaN(date.getTime())
      // distance 兼容老记录的 "0.2" 字符串(见 utils/roam-history-metrics.js);
      // 0 仍是 0。UI-04(2026-09-18):读不出来的统计位显示 0,不再显示横杠
      // (时长仍按文本处理,读不出来保留「—」)。
      const distance = readNonNegative(raw.distance)
      const shops = nonNegativeInteger(raw.shops)
      const explorePct = nonNegativeNumber(raw.explorePct)
      const formattedDuration = this._formatDuration(raw.durSec)
      return {
        ...raw,
        dateFull: validDate ? `${date.getMonth() + 1}月${date.getDate()}日 周${WEEK[date.getDay()]}` : '日期不可用',
        time: typeof raw.time === 'string' && raw.time.trim() ? raw.time.trim() : (formattedDuration || '—'),
        distance,
        distanceText: distance === null ? '0' : String(distance),
        shops,
        shopsText: shops === null ? '0' : String(shops),
        explorePct: explorePct !== null && explorePct <= 100 ? explorePct : null,
        explorePctText: explorePct !== null && explorePct <= 100 ? String(explorePct) : '0',
        pois: (Array.isArray(raw.pois) ? raw.pois : [])
          .filter((poi) => poi && typeof poi === 'object' && !Array.isArray(poi))
          .map((poi) => ({
            ...poi,
            iconName: poi.cat === 'merchant' ? 'poi-shop' : (poi.cat === 'park' ? 'poi-park' : 'poi-landmark'),
          })),
      }
    },
    _formatDuration(seconds) {
      const value = nonNegativeInteger(seconds)
      if (value === null) return ''
      return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    },
    retry() { this._load() },
    _clearReplayTimer() {
      if (this._replayTimer) clearTimeout(this._replayTimer)
      this._replayTimer = null
    },
    _setReplayFrame(count) {
      const frame = replayFrame(this.data.routeSegs, count)
      this.setData({
        replaySegs: frame.visible,
        replayProgress: frame.progress,
        replayState: frame.done ? 'done' : 'playing',
      })
      return frame
    },
    startReplay() {
      this._clearReplayTimer()
      if (!this.data.routeSegs.length) return
      if (this.data.reducedMotion) {
        this._setReplayFrame(this.data.routeSegs.length)
        return
      }
      const schedule = buildReplaySchedule(this.data.routeSegs.length)
      let frameIndex = 0
      const step = () => {
        const frame = this._setReplayFrame(schedule.counts[frameIndex])
        frameIndex += 1
        if (!frame.done) this._replayTimer = setTimeout(step, schedule.intervalMs)
        else this._replayTimer = null
      }
      this.setData({ replaySegs: [], replayProgress: 0, replayState: 'playing' }, step)
    },
    skipReplay() {
      this._clearReplayTimer()
      if (this.data.routeSegs.length) this._setReplayFrame(this.data.routeSegs.length)
    },
    back() { this.triggerEvent('back') },
    close() { this.triggerEvent('close') },
    share() { this.triggerEvent('share', { session: this.data.session }) },
  },
})
