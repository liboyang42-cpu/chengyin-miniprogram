'use strict'

const { distM } = require('./roam-geo.js')
const DEFAULT_EPSILON_METERS = 8
const DEFAULT_MAX_POINTS = 180

function coordinate(value, limit) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return null
  const number = Number(value)
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null
}

function normalizeTrack(points) {
  return (Array.isArray(points) ? points : []).reduce((result, point) => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) return result
    const lat = coordinate(point.lat, 90), lng = coordinate(point.lng, 180)
    if (lat !== null && lng !== null) result.push({ lat, lng })
    return result
  }, [])
}

// 点到有限线段的距离；折返点投影在线段外，必须量到最近端点。
function perpendicularMeters(point, a, b) {
  const scale = 111320 * Math.cos(a.lat * Math.PI / 180)
  const dx = (b.lng - a.lng) * scale, dy = (b.lat - a.lat) * 111320
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-18) return distM(a, point)
  const px = (point.lng - a.lng) * scale, py = (point.lat - a.lat) * 111320
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared))
  return Math.hypot(px - t * dx, py - t * dy)
}

/** 首尾保留，优先保留偏差最大的转折；达到点数预算后仍按几何重要性取舍，不能二次按序号抽点。 */
function simplifyTrack(points, options) {
  const source = normalizeTrack(points)
  if (source.length <= 2) return source
  const epsilon = Number(options && options.epsilonMeters)
  const threshold = Number.isFinite(epsilon) && epsilon >= 0 ? epsilon : DEFAULT_EPSILON_METERS
  const requestedMax = Number(options && options.maxPoints)
  const maxPoints = Number.isFinite(requestedMax) && requestedMax >= 2 ? Math.floor(requestedMax) : DEFAULT_MAX_POINTS
  const keep = new Set([0, source.length - 1])
  const candidates = []
  function addSegment(start, end) {
    let index = -1, distance = threshold
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularMeters(source[i], source[start], source[end])
      if (d > distance) { distance = d; index = i }
    }
    if (index >= 0) candidates.push({ start, end, index, distance })
  }
  addSegment(0, source.length - 1)
  // ponytail: 最多180次扫描候选段；更长轨迹有性能证据时再换优先队列。
  while (candidates.length && keep.size < maxPoints) {
    let best = 0
    for (let i = 1; i < candidates.length; i++) if (candidates[i].distance > candidates[best].distance) best = i
    const segment = candidates.splice(best, 1)[0]
    keep.add(segment.index)
    addSegment(segment.start, segment.index)
    addSegment(segment.index, segment.end)
  }
  return Array.from(keep).sort((a, b) => a - b).map(index => source[index])
}

function limitTrack(points) {
  const track = normalizeTrack(points)
  return track.length > DEFAULT_MAX_POINTS ? simplifyTrack(track) : track
}

module.exports = { simplifyTrack, limitTrack, normalizeTrack, DEFAULT_EPSILON_METERS, DEFAULT_MAX_POINTS }
