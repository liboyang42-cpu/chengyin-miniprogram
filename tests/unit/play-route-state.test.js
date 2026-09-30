const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeRouteState,
  applyRouteStateToNodes,
  resolveNextRouteNode,
  orderedJourneyNodes,
  buildVisibleRoutePath,
  createRouteActionStore,
  isRouteConflict,
} = require('../../pages/play/utils/play-route-state.js')

const nodes = [
  { nodeId: 10, sortId: 4, name: '起点', lat: 31.20, lng: 121.40 },
  { nodeId: 20, sortId: 1, name: '未选支线', lat: 31.21, lng: 121.41 },
  { nodeId: 30, sortId: 9, name: '当前地点', lat: 31.22, lng: 121.42 },
  { nodeId: 40, sortId: 2, name: '以后才开放', lat: 31.23, lng: 121.43 },
]

function branchState() {
  return normalizeRouteState({
    routeMode: 'BRANCH_GRAPH',
    sessionId: 'route-session-1',
    status: 'ACTIVE',
    currentNodeId: 30,
    recommendedNodeId: 30,
    version: 7,
    nodeStates: {
      10: 'COMPLETED',
      20: 'HIDDEN',
      30: 'PLAYABLE',
      40: 'DISCOVERED_LOCKED',
    },
    decisionLog: [
      { fromNodeId: 10, outcomeCode: 'ART', edgeId: 'edge-art', toNodeId: 30, reason: 'OUTCOME', at: 1720000001000, completedAt: 1 },
    ],
  })
}

test('LINEAR 保持按 sortId 选择第一未完成节点', () => {
  const state = normalizeRouteState(null)
  const rows = applyRouteStateToNodes(nodes, state)

  assert.equal(state.routeMode, 'LINEAR')
  assert.equal(rows.length, 4)
  assert.equal(resolveNextRouteNode(rows, state).nodeId, 20)
})

test('BRANCH_GRAPH 只认服务端当前节点，不能被更小 sortId 覆盖', () => {
  const state = branchState()
  const rows = applyRouteStateToNodes(nodes, state)

  assert.deepEqual(rows.map((node) => node.nodeId), [10, 30, 40])
  assert.equal(resolveNextRouteNode(rows, state).nodeId, 30)
  assert.equal(rows.find((node) => node.nodeId === 40).locked, true)
  assert.equal(rows.find((node) => node.nodeId === 30).playable, true)
})

test('BRANCH_GRAPH 缺失或非法节点状态时 fail closed，不回退本地排序', () => {
  const state = normalizeRouteState({
    routeMode: 'BRANCH_GRAPH',
    currentNodeId: 20,
    recommendedNodeId: 20,
    version: 2,
    nodeStates: { 20: 'UNKNOWN' },
  })

  assert.deepEqual(applyRouteStateToNodes(nodes, state), [])
  assert.equal(resolveNextRouteNode(nodes, state), null)
})

test('节点完成回执已确认但新 routeState 尚未读回时，不把旧 currentNode 再推荐一次', () => {
  const state = branchState()
  const rows = applyRouteStateToNodes(nodes, state).map((node) => node.nodeId === 30
    ? { ...node, done: true, routeNodeState: 'COMPLETED', playable: false }
    : node)

  assert.equal(resolveNextRouteNode(rows, state), null)
  assert.deepEqual(buildVisibleRoutePath(rows, state).map((node) => node.nodeId), [10, 30])
})

test('手记和进行中路线按 decisionLog 的真实选择排序且不泄露未选支线', () => {
  const state = branchState()
  const rows = applyRouteStateToNodes(nodes, state)
  const journal = orderedJourneyNodes(rows, state)
  const path = buildVisibleRoutePath(rows, state)

  assert.deepEqual(journal.map((node) => node.nodeId), [10, 30, 40])
  assert.equal(journal[0].doneAt, 1720000001000)
  assert.deepEqual(path.map((node) => node.nodeId), [10, 30])
  assert.ok(!journal.some((node) => node.nodeId === 20))
  assert.ok(!path.some((node) => node.nodeId === 20))
})

test('完成动作超时重试复用 routeActionId，并且上下文无法携带客户端目标', () => {
  let serial = 0
  const store = createRouteActionStore(() => `route-action-${++serial}`)
  const state = branchState()

  const first = store.context('answer', 30, state)
  const retry = store.context('answer', 30, state)
  assert.deepEqual(first, {
    routeActionId: 'route-action-1',
    expectedRouteVersion: 7,
  })
  assert.deepEqual(retry, first)
  assert.deepEqual(Object.keys(first).sort(), ['expectedRouteVersion', 'routeActionId'])
  assert.equal('targetNodeId' in first, false)
  assert.equal('outcomeCode' in first, false)

  store.resolve('answer', 30)
  assert.equal(store.context('answer', 30, state).routeActionId, 'route-action-2')
})

test('版本冲突识别同时兼容 HTTP envelope 与 AjaxResult code/message', () => {
  assert.equal(isRouteConflict({ code: 'fail', upstreamCode: 409 }), true)
  assert.equal(isRouteConflict({ code: 'ROUTE_VERSION_CONFLICT', msg: '路线版本冲突' }), true)
  assert.equal(isRouteConflict({ code: 500, msg: '路线状态已更新，请刷新' }), true)
  assert.equal(isRouteConflict({ code: 500, msg: '普通服务异常' }), false)
})
