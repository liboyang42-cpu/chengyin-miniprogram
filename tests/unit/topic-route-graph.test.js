const { test } = require('node:test');
const assert = require('node:assert/strict');

const routeGraph = require('../../pages/publish/utils/publish/topic-route-graph.js');

const NODES = [
  { id: 11, name: '起点' },
  { id: 12, name: '历史地点' },
  { id: 13, name: '艺术地点' },
  { id: 14, name: '汇合地点' },
  { id: 15, name: '终点' },
];

function twoBranchGraph() {
  return {
    schemaVersion: 1,
    startNodeId: '11',
    terminalNodeIds: ['15'],
    variables: { weather: 'sunny' },
    edges: [
      { id: 'history', fromNodeId: '11', toNodeId: '12', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'HISTORY' }, conditions: [], effects: [], priority: 10, weight: 1, once: true, maxVisits: 1 },
      { id: 'art', fromNodeId: '11', toNodeId: '13', trigger: { type: 'PREFERENCE_RESULT', outcomeCode: 'ART' }, conditions: [], effects: [], priority: 10, weight: 1, once: true, maxVisits: 1 },
      { id: 'history-merge', fromNodeId: '12', toNodeId: '14', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'art-merge', fromNodeId: '13', toNodeId: '14', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
      { id: 'finish', fromNodeId: '14', toNodeId: '15', trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' }, conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1 },
    ],
    fallbacks: [{ fromNodeId: '11', toNodeId: '12' }],
  };
}

test('normalize 把空配置收成 schema v1，旧主题仍是 LINEAR', () => {
  assert.deepEqual(routeGraph.normalizeTopicRoute({}), {
    routeMode: 'LINEAR',
    configVersion: '',
    graph: routeGraph.emptyGraph(),
    error: '',
  });
  assert.equal(routeGraph.serialize(routeGraph.emptyGraph()), JSON.stringify(routeGraph.emptyGraph()));
});

test('两分一合图通过校验，并生成可点击定位的图形投影', () => {
  const graph = twoBranchGraph();
  const result = routeGraph.validate(graph, NODES);
  assert.equal(result.valid, true, JSON.stringify(result.errors));

  const preview = routeGraph.buildPreview(graph, NODES, { currentNodeId: '12', completedNodeIds: ['11'] });
  assert.deepEqual(preview.nodes.map((node) => [node.id, node.state]), [
    ['11', 'COMPLETED'], ['12', 'CURRENT'], ['13', 'AVAILABLE'], ['14', 'AVAILABLE'], ['15', 'TERMINAL'],
  ]);
  assert.deepEqual(preview.edges[0], {
    id: 'history', fromNodeId: '11', fromLabel: '起点', toNodeId: '12', toLabel: '历史地点',
    label: 'PREFERENCE_RESULT · HISTORY', fallback: false, error: false,
  });
});

test('源节点提供玩法结果快照时，路线只能引用已声明的 outcomeCode', () => {
  const nodes = NODES.map((node) => Object.assign({}, node));
  nodes[0].outcomes = [
    { triggerType: 'PREFERENCE_RESULT', code: 'HISTORY', label: '历史线' },
    { triggerType: 'PREFERENCE_RESULT', code: 'ART', label: '艺术线' },
  ];
  const graph = twoBranchGraph();
  assert.equal(routeGraph.validate(graph, nodes).valid, true);

  graph.edges[0].trigger.outcomeCode = 'UNKNOWN';
  const issue = routeGraph.validate(graph, nodes).errors.find((error) => error.code === 'UNKNOWN_OUTCOME');
  assert.deepEqual(
    { edgeId: issue.edgeId, nodeId: issue.nodeId, field: issue.field },
    { edgeId: 'history', nodeId: '11', field: 'trigger.outcomeCode' },
  );
});

test('悬空目标、不可达节点、无终点路径、无 fallback 和非法环都能定位到字段', () => {
  const dangling = twoBranchGraph();
  dangling.edges[0].toNodeId = '999';
  assert.ok(routeGraph.validate(dangling, NODES).errors.some((error) => error.field === 'toNodeId' && error.edgeId === 'history'));

  const unreachable = twoBranchGraph();
  unreachable.edges = unreachable.edges.filter((edge) => edge.id !== 'art');
  assert.ok(routeGraph.validate(unreachable, NODES).errors.some((error) => error.code === 'UNREACHABLE_NODE' && error.nodeId === '13'));

  const noTerminalPath = twoBranchGraph();
  noTerminalPath.edges = noTerminalPath.edges.filter((edge) => edge.id !== 'art-merge');
  assert.ok(routeGraph.validate(noTerminalPath, NODES).errors.some((error) => error.code === 'NO_TERMINAL_PATH' && error.nodeId === '13'));

  const noFallback = twoBranchGraph();
  noFallback.fallbacks = [];
  assert.ok(routeGraph.validate(noFallback, NODES).errors.some((error) => error.code === 'MISSING_FALLBACK' && error.nodeId === '11'));

  const loop = twoBranchGraph();
  loop.edges.push({ id: 'loop', fromNodeId: '14', toNodeId: '11', trigger: { type: 'CHOICE', outcomeCode: 'RETRY' }, conditions: [], effects: [], priority: 0, weight: 1, once: false, maxVisits: 0 });
  assert.ok(routeGraph.validate(loop, NODES).errors.some((error) => error.code === 'ILLEGAL_CYCLE' && error.edgeId === 'loop'));
});

test('非法 weight/maxVisits 不会在 normalize 阶段被悄悄改成默认值', () => {
  const graph = twoBranchGraph();
  graph.edges[0].weight = 0;
  graph.edges[1].maxVisits = -1;
  const errors = routeGraph.validate(graph, NODES).errors;
  assert.ok(errors.some((error) => error.code === 'INVALID_WEIGHT' && error.edgeId === 'history'));
  assert.ok(errors.some((error) => error.code === 'INVALID_MAX_VISITS' && error.edgeId === 'art'));
});

test('旧 condition/effect 字段只在解析层兼容，序列化固定输出 var/op 合同', () => {
  const graph = twoBranchGraph();
  graph.edges[0].conditions = [{ variable: 'score', operator: 'GTE', value: 3 }];
  graph.edges[0].effects = [
    { type: 'INC', name: 'score', value: 1 },
    { type: 'ADD_TAG', tag: 'history' },
  ];
  const normalized = routeGraph.normalizeGraph(graph).graph;
  assert.deepEqual(normalized.edges[0].conditions, [{ var: 'score', op: 'GTE', value: 3 }]);
  assert.deepEqual(normalized.edges[0].effects, [
    { op: 'INC', var: 'score', value: 1 },
    { op: 'ADD_TAG', value: 'history' },
  ]);
  const serialized = JSON.parse(routeGraph.serialize(graph));
  assert.equal(serialized.edges[0].conditions[0].variable, undefined);
  assert.equal(serialized.edges[0].conditions[0].operator, undefined);
  assert.equal(serialized.edges[0].effects[0].type, undefined);
});

test('多条件按 canonical 顺序序列化，发布校验精确定位未声明变量、空标签和主题外节点', () => {
  const graph = twoBranchGraph();
  graph.variables.weather = 0;
  graph.edges[0].conditions = [
    { variable: 'weather', operator: 'EQ', value: 1 },
    { type: 'HAS_TAG', tag: 'vip' },
    { type: 'NODE_COMPLETED', nodeId: '14' },
  ];

  const serialized = JSON.parse(routeGraph.serialize(graph));
  assert.deepEqual(serialized.edges[0].conditions, [
    { var: 'weather', op: 'EQ', value: 1 },
    { op: 'HAS_TAG', value: 'vip' },
    { op: 'NODE_COMPLETED', nodeId: '14' },
  ]);
  assert.equal(routeGraph.validate(serialized, NODES).valid, true);

  graph.edges[0].conditions = [
    { op: 'GTE', var: 'score', value: 10 },
    { op: 'HAS_TAG', value: '' },
    { op: 'NODE_COMPLETED', nodeId: 'other-topic-node' },
  ];
  const errors = routeGraph.validate(graph, NODES).errors;
  assert.ok(errors.some((error) => error.code === 'UNDECLARED_CONDITION_VAR'
    && error.edgeId === 'history' && error.field === 'conditions[0].var'));
  assert.ok(errors.some((error) => error.code === 'MISSING_CONDITION_VALUE'
    && error.edgeId === 'history' && error.field === 'conditions[1].value'));
  assert.ok(errors.some((error) => error.code === 'DANGLING_CONDITION_NODE'
    && error.edgeId === 'history' && error.field === 'conditions[2].nodeId'));
});

test('比较条件值必须是数值，并精确定位到对应条件值', () => {
  const graph = twoBranchGraph();
  graph.edges[0].conditions = [
    { op: 'EQ', var: 'weather', value: '' },
    { op: 'LTE', var: 'weather', value: 'not-a-number' },
  ];
  const errors = routeGraph.validate(graph, NODES).errors;
  assert.ok(errors.some((error) => error.code === 'INVALID_CONDITION_VALUE'
    && error.field === 'conditions[0].value'));
  assert.ok(errors.some((error) => error.code === 'INVALID_CONDITION_VALUE'
    && error.field === 'conditions[1].value'));
});

test('六种比较、HAS_TAG 与 NODE_COMPLETED 在同一条边按 AND 语义执行', () => {
  const graph = twoBranchGraph();
  graph.variables = { score: 10 };
  graph.edges[0].conditions = [
    { op: 'EQ', var: 'score', value: 10 },
    { op: 'NE', var: 'score', value: 9 },
    { op: 'GT', var: 'score', value: 9 },
    { op: 'GTE', var: 'score', value: 10 },
    { op: 'LT', var: 'score', value: 11 },
    { op: 'LTE', var: 'score', value: 10 },
    { op: 'HAS_TAG', value: 'vip' },
    { op: 'NODE_COMPLETED', nodeId: '14' },
  ];
  const outcome = { type: 'PREFERENCE_RESULT', outcomeCode: 'HISTORY' };
  const allowed = routeGraph.previewNext(graph, {
    currentNodeId: '11', variables: { score: 10 }, tags: ['vip'], completedNodeIds: ['14'], visits: {}
  }, outcome, 'all-conditions');
  assert.equal(allowed.selectedEdgeId, 'history');

  const denied = routeGraph.previewNext(graph, {
    currentNodeId: '11', variables: { score: 10 }, tags: [], completedNodeIds: ['14'], visits: {}
  }, outcome, 'missing-tag');
  assert.equal(denied.selectedEdgeId, '');
  assert.equal(denied.fallback, true);
});

test('现实门禁 canonical 保留，首次创建改写 nodeKey，子图复制只携带并重映射所选节点', () => {
  const graph = twoBranchGraph();
  graph.nodeRequirements = [
    {
      nodeId: '12', allowedTicketIds: [7], allowedPurchaseKinds: [1, 2],
      requiredRoleCodes: ['NAVIGATOR'], requireOpen: true,
      maxDistanceMeters: 800, requireReachable: true,
    },
    { nodeId: '13', requireOpen: false },
  ];
  const normalized = routeGraph.normalizeGraph(graph).graph;
  assert.deepEqual(normalized.nodeRequirements, graph.nodeRequirements);
  assert.deepEqual(JSON.parse(routeGraph.serialize(graph)).nodeRequirements, [
    {
      nodeId: 12, allowedTicketIds: [7], allowedPurchaseKinds: [1, 2],
      requiredRoleCodes: ['NAVIGATOR'], requireOpen: true,
      maxDistanceMeters: 800, requireReachable: true,
    },
    { nodeId: 13, requireOpen: false },
  ]);

  const created = JSON.parse(routeGraph.serializeWithNodeKeys(graph));
  assert.equal(created.nodeRequirements[0].nodeId, undefined);
  assert.equal(created.nodeRequirements[0].nodeKey, '12');

  const copied = routeGraph.cloneSubgraph(graph, ['11', '12', '14'], (kind, oldId) => kind + '_copy_' + oldId);
  assert.deepEqual(copied.nodeRequirements, [{
    nodeId: 'node_copy_12', allowedPurchaseKinds: [1, 2],
    requiredRoleCodes: ['NAVIGATOR'], requireOpen: true,
    maxDistanceMeters: 800, requireReachable: true,
  }]);
  assert.equal(copied.omittedTicketRestrictionCount, 1);
});

test('现实门禁逐项校验节点唯一性、所属关系、数组、布尔与距离，并精确定位 requirement', () => {
  const graph = twoBranchGraph();
  graph.nodeRequirements = [
    { nodeId: '12', allowedTicketIds: [7], requireOpen: true },
    { nodeId: '12', allowedPurchaseKinds: [] },
    { nodeId: 'other-topic-node', requiredRoleCodes: ['TYPO'] },
    { nodeId: '14', allowedTicketIds: [8], allowedPurchaseKinds: [4], requiredRoleCodes: 'NAVIGATOR', requireReachable: 'yes', maxDistanceMeters: 1000001 },
  ];
  const errors = routeGraph.validate(graph, NODES, { allowedTicketIds: [7] }).errors;
  assert.ok(errors.some((error) => error.code === 'DUPLICATE_NODE_REQUIREMENT'
    && error.field === 'nodeRequirements[1].nodeId'));
  assert.ok(errors.some((error) => error.code === 'INVALID_REQUIREMENT_ARRAY'
    && error.field === 'nodeRequirements[1].allowedPurchaseKinds'));
  assert.ok(errors.some((error) => error.code === 'DANGLING_REQUIREMENT_NODE'
    && error.field === 'nodeRequirements[2].nodeId'));
  assert.ok(errors.some((error) => error.code === 'INVALID_REQUIREMENT_VALUE'
    && error.field === 'nodeRequirements[2].requiredRoleCodes[0]'));
  assert.ok(errors.some((error) => error.code === 'UNKNOWN_REQUIREMENT_TICKET'
    && error.field === 'nodeRequirements[3].allowedTicketIds[0]'));
  assert.ok(errors.some((error) => error.code === 'INVALID_REQUIREMENT_VALUE'
    && error.field === 'nodeRequirements[3].allowedPurchaseKinds[0]'));
  assert.ok(errors.some((error) => error.code === 'INVALID_REQUIREMENT_ARRAY'
    && error.field === 'nodeRequirements[3].requiredRoleCodes'));
  assert.ok(errors.some((error) => error.code === 'INVALID_REQUIREMENT_BOOLEAN'
    && error.field === 'nodeRequirements[3].requireReachable'));
  assert.ok(errors.some((error) => error.code === 'INVALID_REQUIREMENT_DISTANCE'
    && error.field === 'nodeRequirements[3].maxDistanceMeters'));

  const boundaries = twoBranchGraph();
  boundaries.nodeRequirements = [{ nodeId: '12', maxDistanceMeters: 1 }, { nodeId: '13', maxDistanceMeters: 1000000 }];
  assert.equal(routeGraph.validate(boundaries, NODES).errors.some((error) => error.code === 'INVALID_REQUIREMENT_DISTANCE'), false);
  boundaries.nodeRequirements[0].maxDistanceMeters = 0;
  assert.ok(routeGraph.validate(boundaries, NODES).errors.some((error) => error.field === 'nodeRequirements[0].maxDistanceMeters'));

  boundaries.nodeRequirements = [{ nodeId: '12', allowedTicketIds: ['7'] }];
  assert.ok(routeGraph.validate(boundaries, NODES, { allowedTicketIds: [7] }).errors.some((error) => (
    error.code === 'INVALID_REQUIREMENT_VALUE' && error.field === 'nodeRequirements[0].allowedTicketIds[0]'
  )));
});

test('任何指向现实受限节点的来源都必须有显式 fallback，包括只有一条候选边', () => {
  const graph = twoBranchGraph();
  graph.edges = [{
    id: 'guarded', fromNodeId: '11', toNodeId: '15',
    trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' },
    conditions: [], effects: [], priority: 0, weight: 1, once: true, maxVisits: 1,
  }];
  graph.fallbacks = [];
  graph.nodeRequirements = [{ nodeId: '15', requireReachable: true }];
  assert.ok(routeGraph.validate(graph, [NODES[0], NODES[4]]).errors.some((error) => (
    error.code === 'MISSING_REQUIREMENT_FALLBACK' && error.field === 'nodeRequirements[0]'
  )));

  graph.terminalNodeIds = ['13', '15'];
  graph.fallbacks = [{ fromNodeId: '11', toNodeId: '13' }];
  assert.equal(routeGraph.validate(graph, [NODES[0], NODES[2], NODES[4]]).errors.some((error) => (
    error.code === 'MISSING_REQUIREMENT_FALLBACK'
  )), false);
});

test('新建主题图显式改写 clientNodeKey，NODE_COMPLETED 条件也不能残留临时 nodeId', () => {
  const graph = twoBranchGraph();
  graph.edges[0].conditions = [{ op: 'NODE_COMPLETED', nodeId: '14' }];
  const payload = JSON.parse(routeGraph.serializeWithNodeKeys(graph));
  assert.equal(payload.startNodeId, undefined);
  assert.equal(payload.startNodeKey, '11');
  assert.deepEqual(payload.terminalNodeKeys, ['15']);
  assert.equal(payload.edges[0].fromNodeId, undefined);
  assert.equal(payload.edges[0].fromNodeKey, '11');
  assert.deepEqual(payload.edges[0].conditions, [{ op: 'NODE_COMPLETED', nodeKey: '14' }]);
});

test('循环必须同时显式 allowLoop 与 maxVisits，普通边不会因 maxVisits 默认值误获循环权限', () => {
  const graph = twoBranchGraph();
  graph.edges.push({ id: 'loop', fromNodeId: '14', toNodeId: '11', trigger: { type: 'CHOICE', outcomeCode: 'RETRY' }, conditions: [], effects: [], priority: 0, weight: 1, once: false, maxVisits: 2 });
  assert.ok(routeGraph.validate(graph, NODES).errors.some((error) => error.code === 'ILLEGAL_CYCLE'));
  graph.edges.forEach((edge) => { edge.allowLoop = true; });
  assert.equal(routeGraph.validate(graph, NODES).errors.some((error) => error.code === 'ILLEGAL_CYCLE'), false);
});

test('确定性预览先过滤条件和最高优先级，再按 seed/weight 选择且不改输入', () => {
  const graph = twoBranchGraph();
  graph.edges = [
    { id: 'closed', fromNodeId: '11', toNodeId: '12', trigger: { type: 'CHOICE', outcomeCode: 'ANY' }, conditions: [{ variable: 'open', operator: 'EQ', value: true }], effects: [], priority: 20, weight: 99, once: false, maxVisits: 2 },
    { id: 'art', fromNodeId: '11', toNodeId: '13', trigger: { type: 'CHOICE', outcomeCode: 'ANY' }, conditions: [], effects: [], priority: 10, weight: 1, once: false, maxVisits: 2 },
    { id: 'history', fromNodeId: '11', toNodeId: '12', trigger: { type: 'CHOICE', outcomeCode: 'ANY' }, conditions: [], effects: [], priority: 10, weight: 3, once: false, maxVisits: 2 },
  ];
  graph.fallbacks = [{ fromNodeId: '11', toNodeId: '15' }];
  const before = JSON.stringify(graph);
  const first = routeGraph.previewNext(graph, { currentNodeId: '11', variables: { open: false }, visits: {} }, { type: 'CHOICE', outcomeCode: 'ANY' }, 'tour-42');
  const second = routeGraph.previewNext(graph, { currentNodeId: '11', variables: { open: false }, visits: {} }, { type: 'CHOICE', outcomeCode: 'ANY' }, 'tour-42');
  assert.equal(first.selectedEdgeId, second.selectedEdgeId);
  assert.deepEqual(first.candidateEdgeIds.sort(), ['art', 'history']);
  assert.equal(first.reason, '最高优先级 10 内按权重确定性选择');
  assert.equal(JSON.stringify(graph), before, '预览不能消耗随机数或修改表单真源');
});

test('maxVisits 用尽时走显式 fallback；无 fallback 返回可解释死路', () => {
  const graph = twoBranchGraph();
  graph.edges = [{ id: 'only', fromNodeId: '11', toNodeId: '12', trigger: { type: 'CHOICE', outcomeCode: 'HISTORY' }, conditions: [], effects: [], priority: 0, weight: 1, once: false, maxVisits: 1 }];
  graph.fallbacks = [{ fromNodeId: '11', toNodeId: '15' }];
  const result = routeGraph.previewNext(graph, { currentNodeId: '11', variables: {}, visits: { only: 1 } }, { type: 'CHOICE', outcomeCode: 'HISTORY' }, 'seed');
  assert.equal(result.toNodeId, '15');
  assert.equal(result.fallback, true);

  graph.fallbacks = [];
  const dead = routeGraph.previewNext(graph, { currentNodeId: '11', variables: {}, visits: { only: 1 } }, { type: 'CHOICE', outcomeCode: 'HISTORY' }, 'seed');
  assert.equal(dead.toNodeId, '');
  assert.equal(dead.reason, '没有符合条件的路线边，且未配置 fallback');
});

test('复制子图会重写内部节点与边 ID，不把原主题地点 ID 带过去', () => {
  const graph = twoBranchGraph();
  graph.edges[0].conditions = [{ op: 'NODE_COMPLETED', nodeId: '14' }];
  const copied = routeGraph.cloneSubgraph(graph, ['11', '12', '14'], (kind, oldId) => kind + '_copy_' + oldId);
  assert.deepEqual(copied.nodeIdMap, { '11': 'node_copy_11', '12': 'node_copy_12', '14': 'node_copy_14' });
  assert.deepEqual(copied.edges.map((edge) => [edge.id, edge.fromNodeId, edge.toNodeId]), [
    ['edge_copy_history', 'node_copy_11', 'node_copy_12'],
    ['edge_copy_history-merge', 'node_copy_12', 'node_copy_14'],
  ]);
  assert.deepEqual(copied.edges[0].conditions, [{ op: 'NODE_COMPLETED', nodeId: 'node_copy_14' }]);
});

test('模拟器轮询源节点的真实 outcome，不会只跑第一条分支', () => {
  const report = routeGraph.simulate(twoBranchGraph(), NODES, { runs: 1000, seed: 'all-outcomes' });
  assert.equal(report.deadEnds, 0);
  assert.equal(report.edgeCoverage, 1);
  assert.ok(report.edgeCounts.history > 0);
  assert.ok(report.edgeCounts.art > 0);
});

test('模拟距离缺少坐标时显式标记 unknown，不当作 0 米', () => {
  const report = routeGraph.simulate(twoBranchGraph(), NODES, { runs: 1000, seed: 'unknown-distance' });
  assert.equal(report.unknownDistanceRuns, 1000);
  assert.equal(report.averageDistanceMeters, null);
  assert.equal(report.minDistanceMeters, null);
  assert.equal(report.maxDistanceMeters, null);
});

test('固定 seed 的 1000 局模拟可重放，并输出覆盖、终点和死路指标', () => {
  const graph = twoBranchGraph();
  graph.edges = [
    { id: 'history', fromNodeId: '11', toNodeId: '15', trigger: { type: 'CHOICE', outcomeCode: 'ANY' }, conditions: [], effects: [], priority: 10, weight: 3, once: false, maxVisits: 1 },
    { id: 'art', fromNodeId: '11', toNodeId: '15', trigger: { type: 'CHOICE', outcomeCode: 'ANY' }, conditions: [], effects: [], priority: 10, weight: 1, once: false, maxVisits: 1 },
  ];
  graph.fallbacks = [{ fromNodeId: '11', toNodeId: '15' }];
  const options = { runs: 1000, seed: 'release-check', outcomes: { '11': { type: 'CHOICE', outcomeCode: 'ANY' } } };
  const geoNodes = NODES.map((node, index) => Object.assign({}, node, {
    latitude: 31.23 + index * 0.001,
    longitude: 121.47 + index * 0.001,
  }));
  const first = routeGraph.simulate(graph, geoNodes, options);
  const second = routeGraph.simulate(graph, geoNodes, options);
  assert.deepEqual(first, second);
  assert.equal(first.runs, 1000);
  assert.equal(first.deadEnds, 0);
  assert.equal(first.terminalCounts['15'], 1000);
  assert.equal(first.edgeCounts.history + first.edgeCounts.art, 1000);
  assert.ok(first.edgeCounts.history > first.edgeCounts.art);
  assert.ok(first.minDistanceMeters > 0);
  assert.ok(first.maxDistanceMeters >= first.minDistanceMeters);
});
