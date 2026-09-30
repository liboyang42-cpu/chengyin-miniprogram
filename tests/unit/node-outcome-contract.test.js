const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const outcomes = require('../../pages/publish/utils/publish/node-outcome-contract.js');

test('偏好题结果键成为稳定 PREFERENCE_RESULT，不携带地点 ID', () => {
  const result = outcomes.extract({
    validationMethod: 6,
    preferenceJson: JSON.stringify({ results: {
      HISTORY: { title: '历史线' },
      ART: { title: '艺术线' },
    } }),
  });
  assert.deepEqual(result.items, [
    { triggerType: 'PREFERENCE_RESULT', code: 'ART', label: '艺术线', source: 'preference' },
    { triggerType: 'PREFERENCE_RESULT', code: 'HISTORY', label: '历史线', source: 'preference' },
  ]);
  assert.equal(JSON.stringify(result).includes('toNodeId'), false);
});

test('高级分支只从终态导出 ADVANCED_RESULT，普通节点输出 CHOICE:COMPLETED', () => {
  const advanced = {
    schemaVersion: 1,
    branch: { enabled: true, startStepId: 'start', steps: [
      { id: 'start', title: '选择', terminal: false, options: [{ id: 'left', label: '左', nextStepId: 'end' }] },
      { id: 'end', title: '找到钟楼', terminal: true, outcomeCode: 'FOUND_CLOCK', outcomeLabel: '找到钟楼', options: [] },
    ] },
  };
  assert.deepEqual(outcomes.extract({ validationMethod: 0, advancedConfigJson: JSON.stringify(advanced) }).items, [
    { triggerType: 'ADVANCED_RESULT', code: 'FOUND_CLOCK', label: '找到钟楼', source: 'advanced' },
  ]);
  assert.deepEqual(outcomes.extract({ validationMethod: 5 }).items, [
    { triggerType: 'CHOICE', code: 'COMPLETED', label: '完成节点', source: 'default' },
  ]);
});

test('普通节点完成合同与后端 canonical 路线夹具一致', () => {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../../chengyinhub-admin/src/test/resources/contracts/topic-route-graph-v1.json'), 'utf8'));
  const ordinary = outcomes.extract({ validationMethod: 5 }).items[0];
  assert.deepEqual({ type: ordinary.triggerType, outcomeCode: ordinary.code }, fixture.edges[0].trigger);
});

test('非法或重复 outcomeCode fail closed，并给编辑器可定位错误', () => {
  const result = outcomes.extract({
    validationMethod: 6,
    preferenceJson: JSON.stringify({ results: {
      '中文 结果': { title: '非法' },
      OK: { title: '正常' },
    } }),
    advancedConfigJson: JSON.stringify({
      schemaVersion: 1,
      branch: { enabled: true, steps: [
        { id: 'one', terminal: true, outcomeCode: 'OK', outcomeLabel: '重复', options: [] },
      ] },
    }),
  });
  assert.ok(result.errors.some((error) => error.code === 'INVALID_CODE' && error.sourceKey === '中文 结果'));
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_CODE' && error.sourceKey === 'one'));
});
