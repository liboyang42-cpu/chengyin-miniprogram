const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../pages/publish/utils/publish/advanced-game-config.js');

test('serializes all advanced gameplay sections with schema version', () => {
  const model = config.defaultConfig();
  model.timer.enabled = true;
  model.random.enabled = true;
  model.random.items = [{ id: 'gift_1', label: '线索卡', weight: 10, content: '去钟楼' }];
  model.random.drawCount = 1;
  model.branch.enabled = true;
  model.branch.steps = [
    { id: 'start', title: '起点', body: '', terminal: false,
      options: [{ id: 'go', label: '继续', nextStepId: 'end', score: 0 }] },
    { id: 'end', title: '终点', body: '', terminal: true, outcomeCode: 'FOUND_CLOCK', outcomeLabel: '找到钟楼', options: [] }
  ];
  model.branch.startStepId = 'start';
  model.leaderboard.enabled = true;
  model.multiplayer.enabled = true;

  const json = config.serialize(model);
  const parsed = JSON.parse(json);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.random.items[0].label, '线索卡');
  assert.equal(parsed.branch.steps[1].terminal, true);
  assert.equal(parsed.branch.steps[1].outcomeCode, 'FOUND_CLOCK');
  assert.equal(parsed.multiplayer.roles.length > 0, true);
});

test('returns actionable validation errors instead of emitting broken config', () => {
  const model = config.defaultConfig();
  model.random.enabled = true;
  model.random.items = [];
  assert.match(config.validate(model), /盲盒/);

  model.random.enabled = false;
  model.branch.enabled = true;
  model.branch.steps[0].terminal = false;
  model.branch.steps[0].options = [];
  assert.match(config.validate(model), /分支/);

  model.branch.steps = [
    { id: 'end', title: '终点', body: '', terminal: true, outcomeCode: '中文 结果', options: [] }
  ];
  model.branch.startStepId = 'end';
  assert.match(config.validate(model), /outcomeCode/);
});

test('旧分支终点没有 outcomeCode 时回填为 COMPLETED，保存后合同稳定', () => {
  const parsed = config.parse(JSON.stringify({
    schemaVersion: 1,
    branch: { enabled: true, startStepId: 'end', steps: [{ id: 'end', title: '终点', terminal: true, options: [] }] }
  }));
  assert.equal(parsed.value.branch.steps[0].outcomeCode, 'COMPLETED');
  assert.equal(config.validate(parsed.value), '');
});

test('malformed persisted json fails closed but remains editable', () => {
  const result = config.parse('{broken');
  assert.match(result.error, /无法读取/);
  assert.equal(result.value.schemaVersion, 1);
});

test('topic completion merges N/M without discarding existing rule fields', () => {
  const json = config.mergeTopicCompletion('{"minimumMerchants":2}', 'AT_LEAST', 3);
  const parsed = JSON.parse(json);
  assert.equal(parsed.minimumMerchants, 2);
  assert.deepEqual(parsed.nodeCompletion, { mode: 'AT_LEAST', requiredCount: 3 });
});
