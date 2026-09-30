function formatElapsed(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(safeSeconds / 60)
  const remain = safeSeconds % 60
  return String(minutes).padStart(2, '0') + ':' + String(remain).padStart(2, '0')
}

function buildPlayHeader(input) {
  const data = input || {}
  const total = Math.max(0, Number(data.total) || 0)
  const current = Math.max(0, Math.min(total, Number(data.current) || 0))
  const isPercent = data.progressKind === 'percent'
  return {
    eyebrow: [data.section, data.modeLabel].filter(Boolean).join(' · '),
    title: data.title || '城市探索',
    actionLabel: data.actionLabel || '',
    progressText: isPercent ? current + '%' : current + ' / ' + total,
    progressPct: total ? Math.round((current / total) * 100) : 0,
  }
}

function buildPlayHud(input) {
  const data = input || {}
  const isExplore = data.mode === 'explore'
  const total = Math.max(0, Number(data.totalCount) || 0)
  const completed = Math.min(total, Math.max(0, Number(data.completedCount) || 0))

  return {
    state: data.paused ? 'paused' : 'active',
    actionLabel: data.paused ? '继续' : '暂停',
    endHoldPct: Math.max(0, Math.min(100, Number(data.endHoldPct) || 0)),
    left: isExplore
      ? { label: '已走', value: (Number(data.distanceKm) || 0).toFixed(2), unit: 'km' }
      : { label: '已完成', value: String(completed), unit: '/' + total },
    right: {
      label: '用时',
      value: formatElapsed(data.elapsedSeconds),
      unit: '',
    },
  }
}

function buildPlayRoute(nodes, mode) {
  const points = (nodes || []).map((node) => ({
    latitude: Number(node && (node.latitude != null ? node.latitude : node.lat)),
    longitude: Number(node && (node.longitude != null ? node.longitude : node.lng)),
  })).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
  if (points.length < 2) return []
  // 自由探索没有解锁顺序,所以地图上不连线(2026-09-09 裁决)。原来它画一条虚线把所有点
  // 串起来,那条线在说「先走这个再走那个」—— 恰恰是这个模式没有的东西。
  // 走过的轨迹是另一回事(gameProgressSegment),不受这里影响。
  if (mode === 'free' || mode === 2) return []
  return [{
    points,
    color: ROUTE_COLORS[0],
    width: 6,
    borderColor: ROUTE_BORDER_COLOR,
    borderWidth: 2,
    dottedLine: false,
    arrowLine: true,
  }]
}

function createSessionClock(now) {
  const nowMs = typeof now === 'function' ? now : Date.now
  let accumulatedMs = 0
  let startedAt = null

  function elapsedMs() {
    return accumulatedMs + (startedAt === null ? 0 : Math.max(0, nowMs() - startedAt))
  }

  return {
    start() {
      accumulatedMs = 0
      startedAt = nowMs()
    },
    pause() {
      if (startedAt === null) return
      accumulatedMs = elapsedMs()
      startedAt = null
    },
    resume() {
      if (startedAt !== null) return
      startedAt = nowMs()
    },
    /** R9-21:把时钟拨回「暂停」到某个已走用时(离页快照的恢复入口)。
     *  不是 start(会把累计清零),调用后 isPaused() 为真,resume() 从该用时继续。 */
    restorePaused(elapsedSeconds) {
      accumulatedMs = Math.max(0, Math.floor(Number(elapsedSeconds) || 0)) * 1000
      startedAt = null
    },
    elapsedSeconds() {
      return Math.floor(elapsedMs() / 1000)
    },
    isPaused() {
      return startedAt === null
    },
  }
}

module.exports = { buildPlayHeader, buildPlayHud, buildPlayRoute, createSessionClock, formatElapsed }
const { ROUTE_COLORS, ROUTE_BORDER_COLOR } = require('./play-visual-tokens.js')
