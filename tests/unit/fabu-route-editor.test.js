'use strict'

const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const PAGE = '../../pages/publish/fabu/index.js'
const STORY = '../../pages/publish/utils/publish/pro-editor-story.js'

let sent = []
let pageConfig = null

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (request) => { sent.push(request) },
  tips: () => {},
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  getUserID: () => 101,
  getUserInfo: () => null,
  getToken: () => '',
  chooseImage: () => {},
})
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  showModal: (options) => options.success && options.success({ confirm: true }),
  navigateTo: () => {},
  redirectTo: () => {},
  createMapContext: () => ({ getCenterLocation: () => {} }),
  pageScrollTo: () => {},
  nextTick: (fn) => fn(),
}
global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  sent = []
  pageConfig = null
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

function makePage() {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page._routeGraph = JSON.parse(JSON.stringify(pageConfig._routeGraph))
  page._routeMappingSourceNodeId = ''
  page._routeMappingReturnToNodeEditor = false
  Object.defineProperties(page.data, {
    routeGraph: {
      enumerable: true,
      get() { return page._routeGraph },
      set(value) { page._routeGraph = value },
    },
    routeMappingSourceNodeId: {
      enumerable: true,
      get() { return page._routeMappingSourceNodeId },
      set(value) { page._routeMappingSourceNodeId = value },
    },
    routeMappingReturnToNodeEditor: {
      enumerable: true,
      get() { return page._routeMappingReturnToNodeEditor },
      set(value) { page._routeMappingReturnToNodeEditor = value },
    },
  })
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach((key) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      for (let i = 0; i < parts.length - 1; i += 1) target = target[parts[i]]
      target[parts[parts.length - 1]] = patch[key]
    })
    if (callback) callback()
  }
  return page
}

function nodes() {
  return [{
    _localId: 'chapter_a',
    name: '第一章',
    description: '剧情',
    nodes: [
      { _localId: 'node_a', name: '起点', longitude: 121.1, latitude: 31.1, nodeTime: 10 },
      { _localId: 'node_b', name: '历史地点', longitude: 121.2, latitude: 31.2, nodeTime: 10 },
      { _localId: 'node_c', name: '艺术地点', longitude: 121.3, latitude: 31.3, nodeTime: 10 },
    ],
  }]
}

function withPreferenceTemplate() {
  const chapters = nodes()
  chapters[0].nodes[0].templateId = 88
  chapters[0].nodes[0].templateInfo = {
    title: '旧城门选择',
    validationMethod: 6,
    preferenceJson: JSON.stringify({
      results: {
        HISTORY: { title: '寻找历史' },
        ART: { title: '寻找艺术' },
      },
    }),
  }
  return chapters
}

function graphTopology(graph) {
  return {
    startNodeId: graph.startNodeId,
    terminalNodeIds: (graph.terminalNodeIds || []).slice().sort(),
    edges: (graph.edges || []).map((edge) => [
      edge.id, edge.fromNodeId, edge.trigger && edge.trigger.outcomeCode, edge.toNodeId,
    ]).sort(),
    fallbacks: (graph.fallbacks || []).map((item) => [item.fromNodeId, item.toNodeId]).sort(),
  }
}

test('创作者可在节点内把玩法结果对应到下一站，未单独选择的结果继续原故事流', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.popChapterNodes = true

  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })

  assert.equal(page.data.routeMappingShow, true)
  assert.equal(page.data.popChapterNodes, false)
  assert.equal(page.data.routeMappingSourceLabel, '起点')
  assert.equal(page.data.routeMappingTemplateLabel, '旧城门选择')
  assert.deepEqual(page.data.routeMappingRows.map((row) => [row.label, row.targetLabel]), [
    ['寻找艺术', '继续故事流'],
    ['寻找历史', '继续故事流'],
  ])

  page.onRouteMappingTargetPick({
    currentTarget: { dataset: { rowindex: 0 } },
    detail: { value: 2 },
  })
  page.finishNodeRouteMapping()

  assert.equal(page.data.formData.routeMode, 'BRANCH_GRAPH')
  assert.equal(page.data.routeGraph.startNodeId, 'node_a')
  assert.deepEqual(page.data.routeGraph.terminalNodeIds, ['node_c'])
  assert.deepEqual(page.data.routeGraph.edges
    .filter((edge) => edge.fromNodeId === 'node_a')
    .map((edge) => [edge.trigger.outcomeCode, edge.toNodeId]), [
      ['ART', 'node_c'],
      ['HISTORY', 'node_b'],
    ])
  assert.deepEqual(page.data.routeGraph.fallbacks, [{ fromNodeId: 'node_a', toNodeId: 'node_b' }])
  assert.equal(page.data.routeNodeMappingSummary.node_a, '下一站 2 条')
  assert.equal(JSON.parse(page.data.formData.routeGraphJson).startNodeId, 'node_a')
  assert.equal(page.data.routeMappingShow, false)
  assert.equal(page.data.popChapterNodes, true)
})

test('已保存节点用本地故事块 key 打开时仍对应数据库路线 id', () => {
  const page = makePage()
  const chapters = withPreferenceTemplate()
  chapters[0].nodes.forEach((node, index) => { node.id = 1001 + index })
  page.data.formData.chapters = chapters
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1,
    startNodeId: '1001',
    terminalNodeIds: ['1003'],
    variables: {},
    edges: [
      { id: 'art', fromNodeId: '1001', toNodeId: '1003', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'ART' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'history', fromNodeId: '1001', toNodeId: '1002', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'HISTORY' }, conditions: [], effects: [], priority: 1, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [{ fromNodeId: '1001', toNodeId: '1002' }],
    nodeRequirements: [],
  }

  page.refreshRouteGraph()
  assert.equal(page.data.routeNodeMappingSummary.node_a, '下一站 2 条')

  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })
  assert.equal(page.data.routeMappingShow, true)
  assert.equal(page.data.routeMappingSourceNodeId, '1001')
  assert.deepEqual(page.data.routeMappingRows.map((row) => row.targetLabel), ['艺术地点', '历史地点'])
})

test('节点内刚换的新模板会立即刷新下一站结果，不读取旧节点快照', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.popChapterNodes = true
  page.data.editTargetNodeLid = 'node_a'
  page.data.nodesForm = Object.assign({}, page.data.formData.chapters[0].nodes[0], {
    templateId: 99,
    templateInfo: {
      title: '刚选择的新模板',
      validationMethod: 6,
      preferenceJson: JSON.stringify({
        results: { NIGHT: { title: '寻找夜色' } },
      }),
    },
  })

  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })

  assert.equal(page.data.routeMappingTemplateLabel, '刚选择的新模板')
  assert.deepEqual(page.data.routeMappingRows.map((row) => row.label), ['寻找夜色'])
})

test('缺失的其他结果兜底始终回原故事下一节点，不跟随第一条支线', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1,
    startNodeId: 'node_a',
    terminalNodeIds: ['node_c'],
    variables: {},
    edges: [
      { id: 'art', fromNodeId: 'node_a', toNodeId: 'node_c', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'ART' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'history', fromNodeId: 'node_a', toNodeId: 'node_c', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'HISTORY' }, conditions: [], effects: [], priority: 1, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [],
    nodeRequirements: [],
  }

  page.refreshRouteGraph()

  assert.deepEqual(page.data.routeGraph.fallbacks, [{ fromNodeId: 'node_a', toNodeId: 'node_b' }])
  assert.deepEqual(JSON.parse(page.data.formData.routeGraphJson).fallbacks,
    [{ fromNodeId: 'node_a', toNodeId: 'node_b' }])
})

test('只有一条显式结果边时，其他模板结果仍回原故事下一节点', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1,
    startNodeId: 'node_a',
    terminalNodeIds: ['node_c'],
    variables: {},
    edges: [{
      id: 'art', fromNodeId: 'node_a', toNodeId: 'node_c',
      trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'ART' },
      conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1,
    }],
    fallbacks: [],
    nodeRequirements: [],
  }

  page.refreshRouteGraph()

  assert.deepEqual(page.data.routeGraph.fallbacks, [{ fromNodeId: 'node_a', toNodeId: 'node_b' }])
})

test('节点重排后“继续故事流”跟随新的相邻节点，显式支线目标保持不变', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1,
    startNodeId: 'node_a',
    terminalNodeIds: ['node_c'],
    variables: {},
    edges: [
      { id: 'art', fromNodeId: 'node_a', toNodeId: 'node_c', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'ART' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'history', fromNodeId: 'node_a', toNodeId: 'node_b', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'HISTORY' }, conditions: [], effects: [], priority: 1, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [{ fromNodeId: 'node_a', toNodeId: 'node_b' }],
    nodeRequirements: [],
  }

  page._reorderNode('chapter_a', 'node_c', -1)

  const art = page.data.routeGraph.edges.find((edge) => edge.id === 'art')
  const history = page.data.routeGraph.edges.find((edge) => edge.id === 'history')
  assert.equal(art.toNodeId, 'node_c')
  assert.equal(history.toNodeId, 'node_c')
  assert.deepEqual(page.data.routeGraph.fallbacks, [{ fromNodeId: 'node_a', toNodeId: 'node_c' }])
})

test('撤销节点重排会同时恢复节点顺序与下一站图', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1, startNodeId: 'node_a', terminalNodeIds: ['node_c'], variables: {},
    edges: [
      { id: 'history', fromNodeId: 'node_a', toNodeId: 'node_b', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'HISTORY' }, conditions: [], effects: [], priority: 1, weight: 1, once: true, maxVisits: 1 },
      { id: 'next', fromNodeId: 'node_b', toNodeId: 'node_c', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [{ fromNodeId: 'node_a', toNodeId: 'node_b' }], nodeRequirements: [],
  }
  const graphBefore = graphTopology(page.data.routeGraph)

  page._reorderNode('chapter_a', 'node_c', -1)
  page.undo()

  assert.deepEqual(page.data.formData.chapters[0].nodes.map((node) => node._localId),
    ['node_a', 'node_b', 'node_c'])
  assert.deepEqual(graphTopology(page.data.routeGraph), graphBefore)
})

test('普通节点删除会清理悬空路线，5 秒撤销会恢复原图', () => {
  const page = makePage()
  page.data.formData.chapters = nodes()
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.editTargetChapterLid = 'chapter_a'
  page.data.editTargetNodeLid = 'node_b'
  page.data.routeGraph = {
    schemaVersion: 1, startNodeId: 'node_a', terminalNodeIds: ['node_c'], variables: {},
    edges: [
      { id: 'ab', fromNodeId: 'node_a', toNodeId: 'node_b', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'bc', fromNodeId: 'node_b', toNodeId: 'node_c', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [{ fromNodeId: 'node_a', toNodeId: 'node_b' }], nodeRequirements: [],
  }
  const graphBefore = graphTopology(page.data.routeGraph)

  page.deleteNode()

  assert.equal(page.data.routeGraph.edges.some((edge) => edge.fromNodeId === 'node_b' || edge.toNodeId === 'node_b'), false)
  assert.equal(page.data.routeGraph.fallbacks.some((item) => item.fromNodeId === 'node_b' || item.toNodeId === 'node_b'), false)
  page.undoPendingRemoval()
  assert.deepEqual(graphTopology(page.data.routeGraph), graphBefore)
})

test('已保存节点移到待编排区再撤销会保留 DB id，路线仍可校验', () => {
  const page = makePage()
  page.data.formData.chapters = nodes()
  page.data.formData.chapters[0].nodes.forEach((node, index) => { node.id = 1001 + index })
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.editTargetChapterLid = 'chapter_a'
  page.data.editTargetNodeLid = 'node_b'
  page.data.routeGraph = {
    schemaVersion: 1, startNodeId: '1001', terminalNodeIds: ['1003'], variables: {},
    edges: [
      { id: 'ab', fromNodeId: '1001', toNodeId: '1002', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'bc', fromNodeId: '1002', toNodeId: '1003', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [], nodeRequirements: [],
  }

  page.deleteNode()
  page.undoPendingRemoval()

  const restored = page.data.formData.chapters[0].nodes
    .find((node) => node._localId === 'node_b')
  assert.equal(restored.id, 1002)
  assert.equal(page.validateRouteGraph({ draft: false }), true)
})

test('故事流节点真删同样清理悬空路线，撤销后恢复原图', () => {
  const page = makePage()
  page.data.formData.chapters = nodes()
  page.data.formData.productType = 1
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1, startNodeId: 'node_a', terminalNodeIds: ['node_c'], variables: {},
    edges: [
      { id: 'ab', fromNodeId: 'node_a', toNodeId: 'node_b', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'bc', fromNodeId: 'node_b', toNodeId: 'node_c', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [{ fromNodeId: 'node_a', toNodeId: 'node_b' }], nodeRequirements: [],
  }
  const graphBefore = graphTopology(page.data.routeGraph)
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } })
  const block = page.data.formData.chapters[0].blocks.find((item) => item.nodeKey === 'node_b')

  page._removeStoryNodeNow(block.key)

  assert.equal(page.data.routeGraph.edges.some((edge) => edge.fromNodeId === 'node_b' || edge.toNodeId === 'node_b'), false)
  page.undoPendingRemoval()
  assert.deepEqual(graphTopology(page.data.routeGraph), graphBefore)
})

test('5 秒内连续真删多个故事节点时一次撤销会完整恢复，不覆盖前一次删除', () => {
  const page = makePage()
  page.data.formData.chapters = nodes()
  page.data.formData.chapters[0].nodes.push({
    _localId: 'node_d', name: '终点', longitude: 121.4, latitude: 31.4, nodeTime: 10,
  })
  page.data.formData.productType = 1
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1, startNodeId: 'node_a', terminalNodeIds: ['node_d'], variables: {},
    edges: [
      { id: 'ab', fromNodeId: 'node_a', toNodeId: 'node_b', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'bc', fromNodeId: 'node_b', toNodeId: 'node_c', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'cd', fromNodeId: 'node_c', toNodeId: 'node_d', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [], nodeRequirements: [],
  }
  const graphBefore = graphTopology(page.data.routeGraph)
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } })

  let block = page.data.formData.chapters[0].blocks.find((item) => item.nodeKey === 'node_b')
  page._removeStoryNodeNow(block.key)
  block = page.data.formData.chapters[0].blocks.find((item) => item.nodeKey === 'node_c')
  page._removeStoryNodeNow(block.key)
  page.undoPendingRemoval()

  assert.deepEqual(page.data.formData.chapters[0].nodes.map((node) => node._localId),
    ['node_a', 'node_b', 'node_c', 'node_d'])
  assert.deepEqual(graphTopology(page.data.routeGraph), graphBefore)
})

test('故事真删后再移到待编排区，一次撤销会恢复两种删除', () => {
  const page = makePage()
  page.data.formData.chapters = nodes()
  page.data.formData.productType = 1
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = page._sequentialRouteGraph(page._routeNodes())
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } })

  const block = page.data.formData.chapters[0].blocks.find((item) => item.nodeKey === 'node_b')
  page._removeStoryNodeNow(block.key)
  page.data.storyEditor.show = false
  page.data.editTargetChapterLid = 'chapter_a'
  page.data.editTargetNodeLid = 'node_c'
  page.deleteNode()
  page.undoPendingRemoval()

  assert.deepEqual(page.data.formData.chapters[0].nodes.map((node) => node._localId),
    ['node_a', 'node_b', 'node_c'])
  assert.equal(page.data.pendingMaterials.some((item) => item._localId === 'node_c'), false)
})

test('故事节点撤销恢复路线后会同步恢复节点上的下一站摘要', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.formData.productType = 1
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1, startNodeId: 'node_a', terminalNodeIds: ['node_b', 'node_c'], variables: {},
    edges: [
      { id: 'history', fromNodeId: 'node_a', toNodeId: 'node_b', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'HISTORY' }, conditions: [], effects: [], priority: 1, weight: 1, once: true, maxVisits: 1 },
      { id: 'art', fromNodeId: 'node_a', toNodeId: 'node_c', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'ART' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [{ fromNodeId: 'node_a', toNodeId: 'node_b' }], nodeRequirements: [],
  }
  page.refreshRouteGraph()
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } })
  const block = page.data.formData.chapters[0].blocks.find((item) => item.nodeKey === 'node_a')

  page._removeStoryNodeNow(block.key)
  page.undoPendingRemoval()

  assert.equal(page.data.routeNodeMappingSummary.node_a, '下一站 2 条')
})

test('批量撤销中任一故事块恢复失败时页面保持删除后原状，可再次重试', () => {
  const page = makePage()
  page.data.formData.chapters = nodes()
  page.data.formData.chapters[0].nodes.push({
    _localId: 'node_d', name: '终点', longitude: 121.4, latitude: 31.4, nodeTime: 10,
  })
  page.data.formData.productType = 1
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } })
  let block = page.data.formData.chapters[0].blocks.find((item) => item.nodeKey === 'node_b')
  page._removeStoryNodeNow(block.key)
  block = page.data.formData.chapters[0].blocks.find((item) => item.nodeKey === 'node_c')
  page._removeStoryNodeNow(block.key)
  const afterDeletes = page.data.formData.chapters[0].nodes.map((node) => node._localId)
  const story = require(STORY)
  const applyStoryCommand = story.applyStoryCommand
  let calls = 0
  story.applyStoryCommand = function () {
    calls += 1
    if (calls === 2) throw new Error('恢复容量不足')
    return applyStoryCommand.apply(this, arguments)
  }

  try {
    page.undoPendingRemoval()
  } finally {
    story.applyStoryCommand = applyStoryCommand
  }

  assert.deepEqual(page.data.formData.chapters[0].nodes.map((node) => node._localId), afterDeletes)
  assert.ok(page._pendingUndoSnapshot)
})

test('删除被完成条件引用的节点会移除该不可达边，不留下高级规则悬空引用', () => {
  const page = makePage()
  page.data.formData.chapters = nodes()
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.editTargetChapterLid = 'chapter_a'
  page.data.editTargetNodeLid = 'node_b'
  page.data.routeGraph = {
    schemaVersion: 1, startNodeId: 'node_a', terminalNodeIds: ['node_c'], variables: {},
    edges: [{
      id: 'conditional', fromNodeId: 'node_a', toNodeId: 'node_c',
      trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' },
      conditions: [{ op: 'NODE_COMPLETED', nodeId: 'node_b' }], effects: [],
      priority: 0, weight: 1, once: true, maxVisits: 1,
    }],
    fallbacks: [{ fromNodeId: 'node_a', toNodeId: 'node_c' }], nodeRequirements: [],
  }

  page.deleteNode()

  assert.equal(page.data.routeGraph.edges.some((edge) => edge.id === 'conditional'), false)
  assert.equal(page.validateRouteGraph({ draft: false }), true)
})

test('删除唯一终点后由新的无出边节点接任终点', () => {
  const page = makePage()
  page.data.formData.chapters = nodes()
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.editTargetChapterLid = 'chapter_a'
  page.data.editTargetNodeLid = 'node_c'
  page.data.routeGraph = {
    schemaVersion: 1, startNodeId: 'node_a', terminalNodeIds: ['node_c'], variables: {},
    edges: [
      { id: 'ab', fromNodeId: 'node_a', toNodeId: 'node_b', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'bc', fromNodeId: 'node_b', toNodeId: 'node_c', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [], nodeRequirements: [],
  }

  page.deleteNode()

  assert.deepEqual(page.data.routeGraph.terminalNodeIds, ['node_b'])
  assert.equal(page.validateRouteGraph({ draft: false }), true)
})

test('删除节点会结束节点详情的路线事务，之后取消不会复活旧路线', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.popChapterNodes = true
  page.data.popChapterNodesAction = 1
  page.data.editTargetChapterLid = 'chapter_a'
  page.data.editTargetNodeLid = 'node_a'
  page.data.nodesForm = Object.assign({}, page.data.formData.chapters[0].nodes[0])
  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })
  page.finishNodeRouteMapping()
  assert.ok(page._nodeRouteGraphBeforeEdit)

  page.deleteNode()
  const afterDelete = graphTopology(page.data.routeGraph)
  page.cancelPopChapter()

  assert.equal(page._nodeRouteGraphBeforeEdit, null)
  assert.deepEqual(graphTopology(page.data.routeGraph), afterDelete)
})

test('修改下一站只改结果和目标，保留既有高级条件与执行规则', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1,
    startNodeId: 'node_a',
    terminalNodeIds: ['node_c'],
    variables: { score: 0 },
    edges: [{
      id: 'art', fromNodeId: 'node_a', toNodeId: 'node_c',
      trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'ART' },
      conditions: [{ var: 'score', op: 'GTE', value: 2 }],
      effects: [{ op: 'INC', var: 'score', value: 1 }],
      priority: 9, weight: 3, once: false, maxVisits: 4, allowLoop: true,
    }],
    fallbacks: [],
    nodeRequirements: [],
  }

  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })
  page.onRouteMappingTargetPick({
    currentTarget: { dataset: { rowindex: 0 } },
    detail: { value: 1 },
  })
  page.finishNodeRouteMapping()

  const edge = page.data.routeGraph.edges.find((item) => item.id === 'art')
  assert.deepEqual(edge.conditions, [{ var: 'score', op: 'GTE', value: 2 }])
  assert.deepEqual(edge.effects, [{ op: 'INC', var: 'score', value: 1 }])
  assert.deepEqual({
    priority: edge.priority, weight: edge.weight, once: edge.once,
    maxVisits: edge.maxVisits, allowLoop: edge.allowLoop,
  }, { priority: 9, weight: 3, once: false, maxVisits: 4, allowLoop: true })
})

test('编辑普通节点的下一站不会把既有终点串回故事顺序', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1,
    startNodeId: 'node_a',
    terminalNodeIds: ['node_b', 'node_c'],
    variables: {},
    edges: [
      { id: 'art', fromNodeId: 'node_a', toNodeId: 'node_c', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'ART' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'history', fromNodeId: 'node_a', toNodeId: 'node_b', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'HISTORY' }, conditions: [], effects: [], priority: 1, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [{ fromNodeId: 'node_a', toNodeId: 'node_b' }],
    nodeRequirements: [],
  }

  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })
  page.finishNodeRouteMapping()

  assert.equal(page.data.routeGraph.edges.some((edge) => edge.fromNodeId === 'node_b'), false)
  assert.deepEqual(page.data.routeGraph.terminalNodeIds.sort(), ['node_b', 'node_c'])
})

test('节点详情取消会撤销本次下一站草稿，节点完成则保留映射', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.popChapterNodes = true
  page.data.popChapterNodesAction = 1
  page.data.editTargetChapterLid = 'chapter_a'
  page.data.editTargetNodeLid = 'node_a'
  page.data.nodesForm = Object.assign({}, page.data.formData.chapters[0].nodes[0])
  const before = JSON.stringify(page.data.routeGraph)

  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })
  page.onRouteMappingTargetPick({ currentTarget: { dataset: { rowindex: 0 } }, detail: { value: 2 } })
  page.finishNodeRouteMapping()
  page.cancelPopChapter()

  assert.equal(JSON.stringify(page.data.routeGraph), before)
  assert.equal(page.data.formData.routeMode, 'LINEAR')

  page.data.popChapterNodes = true
  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })
  page.onRouteMappingTargetPick({ currentTarget: { dataset: { rowindex: 0 } }, detail: { value: 2 } })
  page.finishNodeRouteMapping()
  page.confrimNode()

  assert.equal(page.data.formData.routeMode, 'BRANCH_GRAPH')
  assert.equal(page.data.routeGraph.edges.find((edge) => edge.trigger.outcomeCode === 'ART').toNodeId, 'node_c')
})

test('普通完成节点可改去其他地点，越界选择不会写入主题外节点', () => {
  const page = makePage()
  page.data.formData.chapters = nodes()

  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })
  assert.deepEqual(page.data.routeMappingRows.map((row) => row.label), ['完成节点'])

  page.onRouteMappingTargetPick({
    currentTarget: { dataset: { rowindex: 0 } },
    detail: { value: 99 },
  })
  assert.equal(page.data.routeMappingRows[0].toNodeId, '')

  page.onRouteMappingTargetPick({
    currentTarget: { dataset: { rowindex: 0 } },
    detail: { value: 2 },
  })
  page.finishNodeRouteMapping()

  assert.equal(page.data.routeGraph.edges.find((edge) => edge.fromNodeId === 'node_a').toNodeId, 'node_c')
  assert.equal(page.data.routeNodeMappingSummary.node_a, '下一站 1 条')
})

test('取消下一站编辑不改路线，并通过物理返回回到节点详情', () => {
  const page = makePage()
  page.data.formData.chapters = withPreferenceTemplate()
  page.data.popChapterNodes = true
  const before = JSON.stringify(page.data.routeGraph)

  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })
  page.onNativeBackGuard()

  assert.equal(JSON.stringify(page.data.routeGraph), before)
  assert.equal(page.data.routeMappingShow, false)
  assert.equal(page.data.popChapterNodes, true)
})

test('模板结果快照缺失时不打开空弹层', () => {
  const page = makePage()
  const chapters = nodes()
  chapters[0].nodes[0].templateId = 88
  chapters[0].nodes[0].templateInfo = {}
  page.data.formData.chapters = chapters

  page.openNodeRouteMapping({ currentTarget: { dataset: { nodeid: 'node_a' } } })

  assert.equal(page.data.routeMappingShow, false)
})

test('模板结果变化会让旧映射校验失败，避免静默走错路线', () => {
  const page = makePage()
  const chapters = withPreferenceTemplate()
  chapters[0].nodes[0].templateInfo.preferenceJson = JSON.stringify({
    results: { HISTORY: { title: '寻找历史' } },
  })
  page.data.formData.chapters = chapters
  page.data.formData.routeMode = 'BRANCH_GRAPH'
  page.data.routeGraph = {
    schemaVersion: 1,
    startNodeId: 'node_a',
    terminalNodeIds: ['node_c'],
    variables: {},
    edges: [{
      id: 'old-art',
      fromNodeId: 'node_a',
      toNodeId: 'node_c',
      trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'ART' },
      conditions: [],
      effects: [],
      priority: 0,
      weight: 1,
      once: true,
      maxVisits: 1,
    }],
    fallbacks: [{ fromNodeId: 'node_a', toNodeId: 'node_b' }],
    nodeRequirements: [],
  }

  assert.equal(page.validateRouteGraph({ draft: false }), false)
  assert.equal(page.validateRouteGraph({ draft: true }), true)
  assert.equal(page.data.routeNodeMappingSummary.node_a, undefined)
})

test('路线错误定位回故事流，不指向已经删除的全局路线编辑器', () => {
  const page = makePage()
  assert.equal(page._anchorForErrorKey('routeGraph'), 'routeSection')
})

test('发布载荷携带主题路线字段，并用显式 NodeKey 绑定首次创建的节点', () => {
  const page = makePage()
  page.data.formData = Object.assign({}, page.data.formData, {
    productType: 1,
    name: '分支路线',
    description: '测试',
    startDate: '2026-09-01',
    endDate: '2026-09-02',
    chapters: nodes(),
    tickets: [],
    collaboratorIds: [],
    routeMode: 'BRANCH_GRAPH',
    configVersion: '',
  })
  page.data.routeGraph = {
    schemaVersion: 1,
    startNodeId: 'node_a',
    terminalNodeIds: ['node_c'],
    variables: {},
    edges: [{
      id: 'left',
      fromNodeId: 'node_a',
      toNodeId: 'node_b',
      trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' },
      conditions: [],
      effects: [],
      priority: 10,
      weight: 1,
      once: true,
      maxVisits: 1,
    }],
    fallbacks: [],
    nodeRequirements: [],
  }
  page._doSubmit()

  const request = sent.find((item) => item.url === '/api/topic/create')
  assert.ok(request)
  const body = JSON.parse(request.data)
  assert.equal(body.routeMode, 'BRANCH_GRAPH')
  const submittedGraph = JSON.parse(body.routeGraphJson)
  assert.equal(submittedGraph.startNodeId, undefined)
  assert.equal(submittedGraph.startNodeKey, 'node_a')
  assert.deepEqual(submittedGraph.terminalNodeKeys, ['node_c'])
  assert.equal(submittedGraph.edges[0].fromNodeKey, 'node_a')
  assert.equal(body.chapters[0].nodes[0].clientNodeKey, 'node_a')
  assert.equal(body.chapters[0].nodes[0]._localId, undefined)
})
