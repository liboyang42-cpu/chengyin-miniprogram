const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  PLAY_MAP_STATE_ORDER,
  getPlayMapState,
  getPlayRouteNodeState,
  getRoamPoiState,
  buildMapA11yLabel,
  buildRoamGoal,
} = require('../../utils/play-state-contract.js')
const { drawPlayStateMarker } = require('../../utils/play-marker-draw.js')

test('三模式共用一份十态黑白状态合同', () => {
  assert.deepEqual(PLAY_MAP_STATE_ORDER, [
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

  assert.deepEqual(
    PLAY_MAP_STATE_ORDER.map((key) => getPlayMapState(key).mapLabel),
    ['当前目标', '可行动', '已暂停', '已完成', '待核销', '非强制候选', '受限', '定位未开', '离线', '打卡失败'],
  )
  assert.equal(getPlayMapState('done').key, 'completed')
  assert.equal(getPlayMapState('locked').key, 'restricted')
  assert.equal(getPlayMapState('available').key, 'actionable')
  assert.equal(getPlayMapState('recommended').key, 'candidate')
  assert.equal(getPlayMapState('candidate', true).key, 'target')
})

test('主题游玩只把实际前往点标为当前目标', () => {
  const first = { nodeId: 1, done: false }
  const chosen = { nodeId: 2, done: false }
  const finished = { nodeId: 3, done: true }

  assert.equal(getPlayRouteNodeState(first, 2, 2), 'candidate')
  assert.equal(getPlayRouteNodeState(chosen, 2, 2), 'target')
  assert.equal(getPlayRouteNodeState(finished, 2, 2), 'completed')
  assert.equal(getPlayRouteNodeState(first, 1, 1), 'target')
  assert.equal(getPlayRouteNodeState(chosen, 1, 1), 'restricted')
})

test('节点暂停优先于目标和路线顺序，玩家不能把它误判为可玩', () => {
  const paused = { nodeId: 2, done: false, paused: true }
  assert.equal(getPlayRouteNodeState(paused, 2, 2), 'paused')
  assert.equal(getPlayRouteNodeState(paused, 1, 2), 'paused')
  assert.equal(getPlayMapState('paused').readerLabel, '已暂停，当前节点暂不可进入')
})

test('地图读屏摘要按统一状态顺序说明点位', () => {
  const summary = buildMapA11yLabel([
    { nodeId: 1, state: 'done' },
    { nodeId: 2, state: 'available' },
    { nodeId: 3, state: 'locked' },
    { nodeId: 4, state: 'candidate' },
  ], 4)

  assert.equal(summary, '探索地图：当前目标 1处；可行动 1处；已完成 1处；受限 1处')
  assert.equal(buildMapA11yLabel([], null), '探索地图：暂无可用地点')
})

test('自由漫游把失败、定位、离线与下一步映射到同一状态合同', () => {
  const failed = buildRoamGoal({
    visitActive: true,
    checkinError: '服务端没有接受这次打卡',
    checkinRetryable: true,
    gpsEnabled: true,
  })
  assert.equal(failed.stateKey, 'checkin-failed')
  assert.equal(failed.act, 'retry-checkin')

  const unknown = buildRoamGoal({
    visitActive: true,
    checkinError: '结果待核对',
    checkinRetryable: false,
    gpsEnabled: true,
  })
  assert.equal(unknown.stateKey, 'checkin-failed')
  assert.equal(unknown.act, '')

  assert.equal(buildRoamGoal({ gpsEnabled: false, locationError: true }).stateKey, 'location-off')
  assert.equal(buildRoamGoal({ gpsEnabled: true, offline: true }).stateKey, 'offline')
  assert.equal(buildRoamGoal({ gpsEnabled: true, poiEmpty: true }).act, 'discover')
  assert.equal(buildRoamGoal({ gpsEnabled: true, nearbyCount: 2 }).stateKey, 'actionable')
  assert.equal(buildRoamGoal({ gpsEnabled: true }).stateKey, 'target')
})

test('自由漫游真实 POI marker 由探访与点亮状态统一映射', () => {
  const candidate = { id: 1, state: 'base' }
  const actionable = { id: 2, state: 'seen' }
  const completed = { id: 3, state: 'done' }
  const pending = { id: 4, state: 'pendingRedeem' }
  const visit = { active: true, poi: { id: 2 }, checkinErr: '' }

  assert.equal(getRoamPoiState(candidate, visit), 'candidate')
  assert.equal(getRoamPoiState(actionable, visit), 'target')
  assert.equal(getRoamPoiState(completed, visit), 'completed')
  assert.equal(getRoamPoiState(pending, visit), 'redeem-pending')
  assert.equal(getRoamPoiState(actionable, { ...visit, checkinErr: '打卡未记录' }), 'checkin-failed')
  assert.equal(getRoamPoiState(actionable, { active: false }), 'actionable')
})

test('十态 marker 共用的黑白画法都能落到 Canvas 合同', () => {
  const calls = []
  const ctx = {
    beginPath() { calls.push('beginPath') },
    arc() { calls.push('arc') },
    fill() { calls.push('fill') },
    stroke() { calls.push('stroke') },
    clearRect() { calls.push('clearRect') },
    moveTo() {},
    lineTo() {},
    closePath() {},
    fillRect() {},
    setLineDash() {},
  }

  PLAY_MAP_STATE_ORDER.forEach((state) => drawPlayStateMarker(ctx, 108, state))
  assert.equal(calls.filter((call) => call === 'clearRect').length, PLAY_MAP_STATE_ORDER.length)
  assert.ok(calls.includes('fill'))
  assert.ok(calls.includes('stroke'))
})
