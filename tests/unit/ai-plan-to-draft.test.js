const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aiPlanToDraft } = require('../../pages/club/utils/aiPlanToDraft.js');

// 后端 AiClubDesignResp 的完整形状(含全部要丢弃的玩法字段)
const fullResp = () => ({
  traceId: 'trace-abc-123',
  promoCopy: '来玩',
  merchantSuggestions: ['店A', '店B'],
  plan: {
    title: '梧桐区半日漫游',
    subtitle: '从咖啡到旧书店',
    storyline: '沿着法租界的梧桐,走一段慢下来的路。',
    tags: ['citywalk'],
    estDurationMin: 120,
    fitReason: '适合周末',
    risks: ['雨天湿滑'],
    nodes: [
      {
        order: 1, candidateId: 9001, merchantName: '小咖啡馆',
        address: '安福路 1 号', longitude: '121.4', latitude: '31.2',
        businessTime: '09:00-18:00', roleText: '起点·暖场',
        task: '找到隐藏菜单', validationMethod: 2,
        questionName: '招牌是什么', questionAnswer: '手冲',
        optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
        correctAnswer: 'A', hint1: '看吧台', hint2: '问店员',
        feedbackText: '干得漂亮', rewardSuggest: '送一杯'
      },
      {
        order: 2, candidateId: 9002, merchantName: '旧书店',
        address: '五原路 2 号', longitude: '121.5', latitude: '31.3',
        businessTime: '10:00-20:00', roleText: '终点'
      }
    ]
  }
});

test('完整 plan:顶层字段逐一映射', () => {
  const d = aiPlanToDraft(fullResp());
  assert.equal(d.name, '梧桐区半日漫游');
  assert.equal(d.subtitle, '从咖啡到旧书店');
  assert.equal(d.description, '沿着法租界的梧桐,走一段慢下来的路。');
});

test('aiTraceId 从 resp 顶层注入(留痕标记的唯一开关)', () => {
  assert.equal(aiPlanToDraft(fullResp()).aiTraceId, 'trace-abc-123');
});

test('平铺 nodes 被包成单章节,章节字段齐全', () => {
  const d = aiPlanToDraft(fullResp());
  assert.equal(d.chapters.length, 1);
  const ch = d.chapters[0];
  assert.equal(ch.name, '第1章');
  assert.equal(ch.description, '');
  assert.equal(ch.imgArr, '');
  assert.equal(ch.calculatedDistance, 0);
  assert.equal(ch.nodes.length, 2);
});

test('节点:6 个地点字段逐一映射(merchantName→name)', () => {
  const n = aiPlanToDraft(fullResp()).chapters[0].nodes[0];
  assert.equal(n.name, '小咖啡馆');
  assert.equal(n.address, '安福路 1 号');
  assert.equal(n.longitude, '121.4');
  assert.equal(n.latitude, '31.2');
  assert.equal(n.businessTime, '09:00-18:00');
  assert.equal(n.sortID, 1);
});

test('order → sortID 真的搬了(不是下标巧合)', () => {
  const resp = fullResp();
  resp.plan.nodes[0].order = 7;
  resp.plan.nodes[1].order = 5;
  const nodes = aiPlanToDraft(resp).chapters[0].nodes;
  assert.equal(nodes[0].sortID, 7);
  assert.equal(nodes[1].sortID, 5);
});

test('order 缺失 → sortID 缺省 i+1', () => {
  const resp = fullResp();
  delete resp.plan.nodes[0].order;
  delete resp.plan.nodes[1].order;
  const nodes = aiPlanToDraft(resp).chapters[0].nodes;
  assert.equal(nodes[0].sortID, 1);
  assert.equal(nodes[1].sortID, 2);
});

test('merchantName 缺失 → name 缺省「节点N」', () => {
  const resp = fullResp();
  delete resp.plan.nodes[1].merchantName;
  assert.equal(aiPlanToDraft(resp).chapters[0].nodes[1].name, '节点2');
});

test('玩法字段确实被丢弃(节点上不存在这些键)', () => {
  const n = aiPlanToDraft(fullResp()).chapters[0].nodes[0];
  const dropped = ['task', 'validationMethod', 'questionName', 'questionAnswer',
    'optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer',
    'hint1', 'hint2', 'feedbackText', 'rewardSuggest', 'roleText', 'candidateId'];
  for (const k of dropped) {
    assert.equal(Object.prototype.hasOwnProperty.call(n, k), false, `不该有 ${k}`);
  }
});

test('节点不带 description(留给 applyAiDraft 回退用 address)', () => {
  const n = aiPlanToDraft(fullResp()).chapters[0].nodes[0];
  assert.equal(Object.prototype.hasOwnProperty.call(n, 'description'), false);
});

test('resp 为 null / undefined / {} → 不抛,返回空壳', () => {
  for (const bad of [null, undefined, {}]) {
    const d = aiPlanToDraft(bad);
    assert.equal(d.name, '');
    assert.equal(d.subtitle, '');
    assert.equal(d.description, '');
    assert.equal(d.aiTraceId, '');
    assert.equal(d.chapters.length, 1);
    assert.deepEqual(d.chapters[0].nodes, []);
  }
});

test('plan 为 null / nodes 为空 / nodes 非数组 → 不抛', () => {
  assert.deepEqual(aiPlanToDraft({ traceId: 't', plan: null }).chapters[0].nodes, []);
  assert.deepEqual(aiPlanToDraft({ traceId: 't', plan: { nodes: [] } }).chapters[0].nodes, []);
  assert.deepEqual(aiPlanToDraft({ traceId: 't', plan: { nodes: null } }).chapters[0].nodes, []);
});

test('plan 为 null 时 traceId 仍要注入(留痕不能因 plan 缺失而丢)', () => {
  assert.equal(aiPlanToDraft({ traceId: 't-9', plan: null }).aiTraceId, 't-9');
});

// 合规:aiTraceId 是 fabu 里「[AI 辅助生成]」标记的唯一开关,falsy 就没标记。
// 上游漏给 traceId 不能让 AI 内容变成「纯人工原创」的样子发出去。
test('有 plan 但 traceId 缺失 → 兜底哨兵,留痕标记不许丢', () => {
  for (const bad of [undefined, null, '']) {
    const d = aiPlanToDraft({ traceId: bad, plan: { title: 'T', nodes: [] } });
    assert.ok(d.aiTraceId, `traceId=${JSON.stringify(bad)} 时 aiTraceId 必须为真值(否则合规标记静默消失)`);
  }
});

test('无 plan 的空壳不挂留痕标记(空描述上不该有孤零零的标记)', () => {
  assert.equal(aiPlanToDraft({}).aiTraceId, '');
  assert.equal(aiPlanToDraft(null).aiTraceId, '');
});

test('节点字段全缺 → 全部安全缺省,不抛', () => {
  const nodes = aiPlanToDraft({ traceId: 't', plan: { nodes: [{}] } }).chapters[0].nodes;
  assert.deepEqual(nodes[0], {
    name: '节点1', address: '', longitude: '', latitude: '',
    businessTime: '', sortID: 1
  });
});

test('经度/纬度为数字 → 归一成字符串(与 applyAiDraft 的 String() 一致)', () => {
  const nodes = aiPlanToDraft({
    plan: { nodes: [{ longitude: 121.4, latitude: 31.2 }] }
  }).chapters[0].nodes;
  assert.equal(nodes[0].longitude, '121.4');
  assert.equal(nodes[0].latitude, '31.2');
});
