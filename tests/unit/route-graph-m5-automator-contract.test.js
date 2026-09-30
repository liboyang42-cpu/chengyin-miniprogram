'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const DRIVER_FILE = path.join(PROJECT_ROOT, 'tests', 'automator', 'route-graph-m5.js')
const fixture = require('../automator/fixtures/route-graph-m5-fixture.js')

test('M5 automator 只能经公开 UI 与 HTTP 边界验收，禁止页面状态和私有方法注入', () => {
  const source = fs.readFileSync(DRIVER_FILE, 'utf8')

  assert.doesNotMatch(source, /\.setData\s*\(/)
  assert.doesNotMatch(source, /\.callMethod\s*\(/)
  assert.doesNotMatch(source, /_applyRouteState/)
  assert.match(source, /\.tap\s*\(/)
  assert.match(source, /\.trigger\('change'/)
  assert.match(source, /\/api\/topic\/update/)
  assert.match(source, /\/api\/topic\/edit-detail/)
  assert.match(source, /\/api\/play\/answer/)
  const creatorFlow = source.slice(source.indexOf('async function verifyCreator'), source.indexOf('async function enterRunningRoute'))
  assert.match(source, /story-node-block__route/,
    '创作端必须等待 API 回填后的故事流节点摘要，不能依赖全局路线入口')
  assert.match(source, /下一站 2 条/,
    '创作端必须从节点可见摘要确认两个玩法结果已恢复')
  assert.match(creatorFlow, /waitForCreatorRouteRestored\(page\)[\s\S]*restored\.block\.tap\(\)/,
    '创作端必须先等待故事流节点恢复，再进入节点详情')
  assert.match(creatorFlow, /node-route-entry[\s\S]*route-mapping-row[\s\S]*trigger\('change'/,
    '创作端必须经公开节点摘要与 picker 完成结果到下一站的对应')
  assert.match(creatorFlow, /firstPicker\.trigger\('change', \{ value: 2 \}\)/,
    '创作端必须真的改变第一条结果对应，不能选择原目标后只回读原图')
  assert.match(creatorFlow, /secondPicker\.trigger\('change', \{ value: 1 \}\)/,
    '创作端必须保留两个不同目标，交换两条结果对应后再验收玩家分流')
  assert.match(creatorFlow, /outcomeCode === 'HISTORY'[\s\S]*toNodeId\) === '1003'/,
    '保存请求必须回读寻找历史的新目标')
  assert.match(creatorFlow, /outcomeCode === 'ART'[\s\S]*toNodeId\) === '1002'/,
    '保存请求必须回读寻找艺术的新目标')
  assert.match(creatorFlow, /重新进入后“寻找历史”仍对应艺术支线/,
    '重新进入必须从 API 恢复刚才修改的对应')
  assert.doesNotMatch(creatorFlow, /route-advanced-toggle|placeholder="权重"|runRouteSimulation/,
    '精简创作流程不能回退到高级图编辑器')
  const playerFlow = source.slice(source.indexOf('async function answerCurrentNode'), source.indexOf('async function main'))
  assert.equal((playerFlow.match(/enterRunningRoute\(/g) || []).length, 1,
    '通用玩家流程只能首次进入一次；节点推进必须在同一页面完成，不能逐步 reLaunch 掩盖解锁刷新缺陷')
  assert.match(playerFlow, /完成「\$\{expectedNodeName\}」后没有同页刷新 \/api\/play\/nodes/,
    '每次完成节点都必须观测 /nodes 权威刷新')
  assert.match(playerFlow, /finsheet/, '公开驱动必须看到最终完赛面板')
})

test('受控后端把创作端保存的节点结果对应作为重新进入页面的权威回读', () => {
  const backend = fixture.createRouteGraphM5Fixture()
  const original = backend.request({ method: 'POST', path: '/api/topic/edit-detail', body: { id: '88001' } })
  assert.equal(original.body.data.topic.routeMode, 'BRANCH_GRAPH')
  assert.equal(JSON.parse(original.body.data.topic.routeGraphJson).edges[0].toNodeId, '1002')

  const graph = fixture.savedBranchGraph()
  graph.edges[0].toNodeId = '1003'
  const saved = backend.request({
    method: 'POST',
    path: '/api/topic/update',
    body: { id: '88001', routeMode: 'BRANCH_GRAPH', routeGraphJson: JSON.stringify(graph) },
  })
  assert.equal(saved.body.code, 200)

  const restored = backend.request({ method: 'POST', path: '/api/topic/edit-detail', body: { id: '88001' } })
  assert.equal(restored.body.data.topic.routeMode, 'BRANCH_GRAPH')
  assert.deepEqual(JSON.parse(restored.body.data.topic.routeGraphJson), graph)
  assert.equal(backend.facts().topicUpdates.length, 1)
})

test('两名玩家状态隔离：历史与艺术选择分别解锁不同结局', () => {
  const backend = fixture.createRouteGraphM5Fixture()
  const playerA = { activityId: '99001' }
  const playerB = { activityId: '99002' }

  const swapped = fixture.savedBranchGraph()
  swapped.edges.find((edge) => edge.trigger.outcomeCode === 'HISTORY').toNodeId = '1003'
  swapped.edges.find((edge) => edge.trigger.outcomeCode === 'ART').toNodeId = '1002'
  const saved = backend.request({
    method: 'POST', path: '/api/topic/update',
    body: { id: '88001', routeMode: 'BRANCH_GRAPH', routeGraphJson: JSON.stringify(swapped) },
  })
  assert.equal(saved.body.code, 200)

  const a0 = backend.request({ method: 'GET', path: '/api/play/nodes', query: playerA })
  const b0 = backend.request({ method: 'GET', path: '/api/play/nodes', query: playerB })
  assert.equal(a0.body.data.routeState.recommendedNodeId, 1001)
  assert.equal(b0.body.data.routeState.recommendedNodeId, 1001)

  const a1 = backend.request({
    method: 'POST', path: '/api/play/answer',
    body: { ...playerA, nodeId: 1001, answer: 'A', routeActionId: 'a-start', expectedRouteVersion: 1 },
  })
  const b1 = backend.request({
    method: 'POST', path: '/api/play/answer',
    body: { ...playerB, nodeId: 1001, answer: 'B', routeActionId: 'b-start', expectedRouteVersion: 1 },
  })
  assert.equal(a1.body.data.routeState.recommendedNodeId, 1003)
  assert.equal(b1.body.data.routeState.recommendedNodeId, 1002)
  assert.equal(a1.body.data.routeState.nodeStates['1002'], 'HIDDEN')
  assert.equal(b1.body.data.routeState.nodeStates['1003'], 'HIDDEN')

  const a2 = backend.request({
    method: 'POST', path: '/api/play/answer',
    body: { ...playerA, nodeId: 1003, answer: 'A', routeActionId: 'a-branch', expectedRouteVersion: 2 },
  })
  const b2 = backend.request({
    method: 'POST', path: '/api/play/answer',
    body: { ...playerB, nodeId: 1002, answer: 'A', routeActionId: 'b-branch', expectedRouteVersion: 2 },
  })
  assert.equal(a2.body.data.routeState.recommendedNodeId, 1005)
  assert.equal(b2.body.data.routeState.recommendedNodeId, 1004)

  const a3 = backend.request({
    method: 'POST', path: '/api/play/answer',
    body: { ...playerA, nodeId: 1005, answer: 'A', routeActionId: 'a-finish', expectedRouteVersion: 3 },
  })
  const b3 = backend.request({
    method: 'POST', path: '/api/play/answer',
    body: { ...playerB, nodeId: 1004, answer: 'A', routeActionId: 'b-finish', expectedRouteVersion: 3 },
  })
  assert.equal(a3.body.data.routeState.status, 'COMPLETED')
  assert.equal(b3.body.data.routeState.status, 'COMPLETED')

  const aRecovered = backend.request({ method: 'GET', path: '/api/play/nodes', query: playerA })
  const bRecovered = backend.request({ method: 'GET', path: '/api/play/nodes', query: playerB })
  assert.deepEqual(aRecovered.body.data.routeState.decisionLog.map((row) => row.toNodeId), [1003, 1005, null])
  assert.deepEqual(bRecovered.body.data.routeState.decisionLog.map((row) => row.toNodeId), [1002, 1004, null])
  assert.deepEqual(aRecovered.body.data.nodes.map((node) => node.nodeId), [1001, 1003, 1005])
  assert.deepEqual(bRecovered.body.data.nodes.map((node) => node.nodeId), [1001, 1002, 1004])
})

test('负控：玩家不能越过当前 PLAYABLE 节点或复用错误版本', () => {
  const backend = fixture.createRouteGraphM5Fixture()
  const session = { activityId: '99001' }

  const hidden = backend.request({
    method: 'POST', path: '/api/play/answer',
    body: { ...session, nodeId: 1003, answer: 'A', routeActionId: 'bad-hidden', expectedRouteVersion: 1 },
  })
  assert.equal(hidden.body.code, 409)

  backend.request({
    method: 'POST', path: '/api/play/answer',
    body: { ...session, nodeId: 1001, answer: 'A', routeActionId: 'ok-start', expectedRouteVersion: 1 },
  })
  const stale = backend.request({
    method: 'POST', path: '/api/play/answer',
    body: { ...session, nodeId: 1002, answer: 'A', routeActionId: 'stale', expectedRouteVersion: 1 },
  })
  assert.equal(stale.body.code, 409)
})

test('受控 HTTP server 按真实 wx.request 的 query 与 JSON body 提供同一权威状态', async () => {
  const server = await fixture.startRouteGraphM5FixtureServer()
  try {
    const nodesResponse = await fetch(`${server.baseUrl}/api/play/nodes?activityId=99001`)
    const nodes = await nodesResponse.json()
    assert.equal(nodes.code, 200)
    assert.equal(nodes.data.routeState.recommendedNodeId, 1001)

    const graph = fixture.savedBranchGraph()
    graph.edges[0].weight = 7
    const updateResponse = await fetch(`${server.baseUrl}/api/topic/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '88001', routeMode: 'BRANCH_GRAPH', routeGraphJson: JSON.stringify(graph) }),
    })
    const update = await updateResponse.json()
    assert.equal(update.code, 200)

    const restoredResponse = await fetch(`${server.baseUrl}/api/topic/edit-detail`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'id=88001',
    })
    const restored = await restoredResponse.json()
    assert.equal(JSON.parse(restored.data.topic.routeGraphJson).edges[0].weight, 7)
  } finally {
    await server.close()
  }
})
