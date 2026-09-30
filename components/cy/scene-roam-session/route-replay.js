'use strict'

const { limitTrack, normalizeTrack } = require('../../../utils/roam-track-simplify.js')

const WIDTH = 670
const HEIGHT = 520
const PADDING = 60
const REPLAY_FRAME_MS = 120
const REPLAY_MAX_FRAMES = 24

function buildRouteGeometry(session) {
  const track = limitTrack(session && session.track)
  if (track.length < 2) return { segs: [], poiDots: [] }

  const kx = Math.cos(track[0].lat * Math.PI / 180)
  const project = (point) => ({ x: point.lng * kx, y: -point.lat })
  const trackPoints = track.map(project)
  const poiPoints = normalizeTrack(session && session.pois).map(project)
  const all = trackPoints.concat(poiPoints)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  all.forEach((point) => {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  })
  const scale = Math.min(
    (WIDTH - PADDING * 2) / Math.max(1e-9, maxX - minX),
    (HEIGHT - PADDING * 2) / Math.max(1e-9, maxY - minY),
  )
  const offsetX = (WIDTH - (maxX - minX) * scale) / 2 - minX * scale
  const offsetY = (HEIGHT - (maxY - minY) * scale) / 2 - minY * scale
  const x = (point) => point.x * scale + offsetX
  const y = (point) => point.y * scale + offsetY
  const segs = []
  for (let index = 1; index < trackPoints.length; index += 1) {
    const fromX = x(trackPoints[index - 1])
    const fromY = y(trackPoints[index - 1])
    const toX = x(trackPoints[index])
    const toY = y(trackPoints[index])
    const length = Math.hypot(toX - fromX, toY - fromY)
    if (length < 2) continue
    segs.push({
      i: index,
      x: Math.round(fromX),
      y: Math.round(fromY),
      len: Math.round(length) + 2,
      deg: Math.round(Math.atan2(toY - fromY, toX - fromX) * 180 / Math.PI),
    })
  }
  const poiDots = poiPoints.map((point, index) => ({
    i: index,
    x: Math.round(x(point)),
    y: Math.round(y(point)),
    tone: index % 4,
  }))
  return { segs, poiDots }
}

function replayFrame(segs, requestedCount) {
  const source = Array.isArray(segs) ? segs : []
  const count = Math.max(0, Math.min(source.length, Math.floor(Number(requestedCount) || 0)))
  return {
    visible: source.slice(0, count),
    progress: source.length ? Math.round(count / source.length * 100) : 0,
    done: source.length > 0 && count >= source.length,
  }
}

function buildReplaySchedule(segmentCount) {
  const total = Math.max(0, Math.floor(Number(segmentCount) || 0))
  if (!total) return { counts: [], intervalMs: REPLAY_FRAME_MS, totalDurationMs: 0 }
  const frameCount = Math.min(total, REPLAY_MAX_FRAMES)
  const step = Math.ceil(total / frameCount)
  const counts = []
  for (let count = step; count < total; count += step) counts.push(count)
  counts.push(total)
  return {
    counts,
    intervalMs: REPLAY_FRAME_MS,
    totalDurationMs: Math.max(0, counts.length - 1) * REPLAY_FRAME_MS,
  }
}

module.exports = { buildReplaySchedule, buildRouteGeometry, replayFrame }
