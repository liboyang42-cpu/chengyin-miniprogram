// ── 写操作回执词典 ────────────────────────────────────────────────
// 玩法里每个写操作(到店/照片/答题/抽取/轮次)都落在这六个态里。
// 分散在各页各自造词是「看起来完成、实际没到」的温床:同一个网络超时,
// 一处说「失败请重试」(诱发重复写入)、一处说「已记录」(直接说谎)。
// holdsLock=true 的态必须保持业务锁,只能由权威回读释放。
const PLAY_RECEIPT_STATE_ORDER = Object.freeze([
  'ready', 'submitting', 'confirmed', 'unknown', 'failed',
])

const PLAY_RECEIPT_STATES = Object.freeze({
  ready: Object.freeze({
    key: 'ready', label: '', readerLabel: '可以提交', holdsLock: false, canRetry: true,
  }),
  submitting: Object.freeze({
    key: 'submitting', label: '正在提交…', readerLabel: '正在提交，请勿重复操作',
    holdsLock: true, canRetry: false,
  }),
  confirmed: Object.freeze({
    key: 'confirmed', label: '已确认', readerLabel: '本次操作已确认完成',
    holdsLock: false, canRetry: false,
  }),
  // ⚠️ 文案里绝不能出现「成功」「失败」「已记录」——结果就是不知道。
  unknown: Object.freeze({
    key: 'unknown', label: '结果待确认 · 请勿重复提交',
    readerLabel: '结果待确认。系统正在核对，请勿重复提交。',
    holdsLock: true, canRetry: false,
  }),
  failed: Object.freeze({
    key: 'failed', label: '没有提交成功', readerLabel: '没有提交成功，可以修改后重试',
    holdsLock: false, canRetry: true,
  }),
})

function getPlayReceiptState(key) {
  return PLAY_RECEIPT_STATES[String(key || '')] || PLAY_RECEIPT_STATES.ready
}

const PLAY_MAP_STATE_ORDER = Object.freeze([
  'target',
  'actionable',
  'paused',
  'completed',
  'redeem-pending',
  'candidate',
  'restricted',
  'location-off',
  'offline',
  'checkin-failed',
])

const PLAY_MAP_STATES = Object.freeze({
  target: Object.freeze({
    key: 'target',
    mapLabel: '当前目标',
    cardLabel: '当前目标',
    readerLabel: '当前目标，正在前往',
    markerKey: 'target',
  }),
  actionable: Object.freeze({
    key: 'actionable',
    mapLabel: '可行动',
    cardLabel: '可前往',
    readerLabel: '可行动，可直接选择或前往',
    markerKey: 'actionable',
  }),
  paused: Object.freeze({
    key: 'paused',
    mapLabel: '已暂停',
    cardLabel: '本站暂停',
    readerLabel: '已暂停，当前节点暂不可进入',
    markerKey: 'paused',
  }),
  completed: Object.freeze({
    key: 'completed',
    mapLabel: '已完成',
    cardLabel: '已完成',
    readerLabel: '已完成，本次会话已点亮',
    markerKey: 'completed',
  }),
  /* CU-M-54:有券据点「已打卡待核销」是独立一档。本地把打卡成功当完成(无条件 completed),
     重进只看服务端 found(核销前仍 passed→candidate),同一站先亮后灭,详情却还能出码。
     它不等于 completed:券还没到手,说「已完成」就是误报(用户会以为券到了)。 */
  'redeem-pending': Object.freeze({
    key: 'redeem-pending',
    mapLabel: '待核销',
    cardLabel: '待核销',
    readerLabel: '已打卡待核销，出示核销码给商家后才会领到券',
    markerKey: 'redeem-pending',
  }),
  candidate: Object.freeze({
    key: 'candidate',
    mapLabel: '非强制候选',
    cardLabel: '可选地点',
    readerLabel: '非强制候选，可选但不必前往',
    markerKey: 'candidate',
  }),
  restricted: Object.freeze({
    key: 'restricted',
    mapLabel: '受限',
    cardLabel: '暂未解锁',
    readerLabel: '受限，需先完成上一站',
    markerKey: 'restricted',
  }),
  'location-off': Object.freeze({
    key: 'location-off',
    mapLabel: '定位未开',
    cardLabel: '定位未开',
    readerLabel: '定位未开，开启定位后才能开始相关行动',
    markerKey: '',
  }),
  offline: Object.freeze({
    key: 'offline',
    mapLabel: '离线',
    cardLabel: '据点未更新',
    readerLabel: '离线，据点或网络未更新，本地进度已保留',
    markerKey: '',
  }),
  'checkin-failed': Object.freeze({
    key: 'checkin-failed',
    mapLabel: '打卡失败',
    cardLabel: '打卡未记录',
    readerLabel: '打卡失败，本次打卡没有被记录',
    markerKey: '',
  }),
})

const LEGACY_STATE_ALIASES = Object.freeze({
  available: 'actionable',
  recommended: 'candidate',
  done: 'completed',
  locked: 'restricted',
})

function getPlayMapState(stateKey, isTarget) {
  if (isTarget) return PLAY_MAP_STATES.target
  const key = LEGACY_STATE_ALIASES[stateKey] || stateKey
  return PLAY_MAP_STATES[key] || PLAY_MAP_STATES.actionable
}

function getPlayRouteNodeState(node, mode, targetNodeId) {
  if (node && node.done) return 'completed'
  if (node && node.paused) return 'paused'
  const isTarget = targetNodeId != null && node && String(node.nodeId) === String(targetNodeId)
  if (Number(mode) === 1) return isTarget ? 'target' : 'restricted'
  return isTarget ? 'target' : 'candidate'
}

function getRoamPoiState(poi, visit) {
  const activeVisit = visit || {}
  const isTarget = !!(
    activeVisit.active
    && activeVisit.poi
    && poi
    && String(activeVisit.poi.id) === String(poi.id)
  )
  if (isTarget && activeVisit.checkinErr) return 'checkin-failed'
  if (isTarget) return 'target'
  if (poi && poi.state === 'done') return 'completed'
  // 到店打卡成功但券要商家扫码才发:按服务端 roam_poi_reward_log.status=0 回填(见 RoamPoi.pendingRedeem)。
  if (poi && poi.state === 'pendingRedeem') return 'redeem-pending'
  if (poi && poi.state === 'seen') return 'actionable'
  return 'candidate'
}

function buildMapA11yLabel(nodes, targetId) {
  const counts = {}
  ;(nodes || []).forEach((node) => {
    const isTarget = targetId != null && String(node && node.nodeId) === String(targetId)
    const state = getPlayMapState(node && node.state, isTarget)
    counts[state.key] = (counts[state.key] || 0) + 1
  })
  const summary = PLAY_MAP_STATE_ORDER
    .filter((key) => counts[key])
    .map((key) => PLAY_MAP_STATES[key].mapLabel + ' ' + counts[key] + '处')
  return summary.length ? '探索地图：' + summary.join('；') : '探索地图：暂无可用地点'
}

function buildRoamGoal(input) {
  const data = input || {}
  if (data.visitActive && data.checkinError) {
    const retryable = data.checkinRetryable === true
    return {
      stateKey: 'checkin-failed',
      icon: 'warning',
      text: retryable ? '打卡没记上 · 点击重试' : '打卡结果待核对 · 暂勿重复提交',
      act: retryable ? 'retry-checkin' : '',
      readerLabel: retryable
        ? '打卡失败。本次打卡没有被记录，点击重试。'
        : '打卡结果待核对。系统正在确认，请暂时不要重复提交。',
    }
  }
  if (data.visitActive) {
    const name = data.poiName ? ' · ' + data.poiName : ''
    return {
      stateKey: 'target',
      icon: 'poi-shop',
      text: '正在探店' + name,
      act: '',
      readerLabel: '当前目标，正在探店' + (data.poiName ? '，' + data.poiName : '。'),
    }
  }
  if (!data.gpsEnabled) {
    const retry = !!data.locationError
    return {
      stateKey: 'location-off',
      icon: retry ? 'warning' : 'gps',
      text: retry ? '定位未开启 · 点击重试' : '开启定位 · 开始点亮',
      act: 'gps',
      readerLabel: retry ? '定位未开。定位没有成功开启，点击重试。' : '定位未开。开启定位后开始点亮街区。',
    }
  }
  if (data.offline) {
    return {
      stateKey: 'offline',
      icon: 'warning',
      text: '据点未更新 · 本地足迹已保留 · 点击重试',
      act: 'retry-poi',
      readerLabel: '离线。据点或网络未更新，本地足迹已保留，点击重试。',
    }
  }
  if (data.nearbyCount > 0) {
    return {
      stateKey: 'actionable',
      icon: 'poi-shop',
      text: '附近有 ' + data.nearbyCount + ' 个据点 · 去看看',
      act: 'nearby',
      readerLabel: '可行动。附近有 ' + data.nearbyCount + ' 个据点，可直接查看。',
    }
  }
  if (data.poiEmpty) {
    return {
      stateKey: 'actionable',
      icon: 'discover-shop',
      text: '该区域暂未开放 · 发现附近真实店',
      act: 'discover',
      readerLabel: '当前区域暂未开放漫游据点。可发现附近真实店铺。',
    }
  }
  return {
    stateKey: 'target',
    icon: 'walk',
    text: '继续走 · 点亮这片街区',
    act: '',
    readerLabel: '当前目标。继续行走，点亮这片街区。',
  }
}

module.exports = {
  PLAY_RECEIPT_STATE_ORDER,
  PLAY_RECEIPT_STATES,
  getPlayReceiptState,
  PLAY_MAP_STATE_ORDER,
  getPlayMapState,
  getPlayRouteNodeState,
  getRoamPoiState,
  buildMapA11yLabel,
  buildRoamGoal,
}
