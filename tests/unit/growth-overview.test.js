const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGrowthOverview } = require('../../subpackageP3/utils/growth-overview.js');

test('buildGrowthOverview:汇总真实成长、徽章、完成主题和累计距离', () => {
  const result = buildGrowthOverview({
    center: {
      code: '200',
      data: {
        growth: { levelNo: 4, expValue: 1280 },
        badges: [{ badgeCode: 'FIRST_STEP' }, { badgeCode: 'TOPIC_CLEAR' }]
      }
    },
    play: { code: 200, data: { totalMileage: '12.36' } },
    completed: { code: 200, data: [{ topicId: 1 }, { topicId: 2 }, { topicId: 3 }] }
  });

  assert.equal(result.levelText, 'Lv.4');
  assert.deepEqual(result.stats, [
    { key: 'exp', label: '探索值', value: '1,280', unit: 'EXP' },
    { key: 'badge', label: '徽章', value: '2', unit: '枚' },
    { key: 'topic', label: '完成主题', value: '3', unit: '个' },
    { key: 'distance', label: '累计距离', value: '12.4', unit: 'km' }
  ]);
});

test('buildGrowthOverview:成功的零值保留为零，失败来源按 UI-04 显示 0', () => {
  // 2026-09-18 用户走查 UI-04:数字统计没取到显示 0(原口径是「—」,本批覆盖)。
  const result = buildGrowthOverview({
    center: { code: 200, data: { growth: { levelNo: 1, expValue: 0 }, badges: [] } },
    play: { code: 500, data: {} },
    completed: { code: 503, data: null }
  });

  assert.equal(result.levelText, 'Lv.1');
  assert.deepEqual(result.stats, [
    { key: 'exp', label: '探索值', value: '0', unit: 'EXP' },
    { key: 'badge', label: '徽章', value: '0', unit: '枚' },
    { key: 'topic', label: '完成主题', value: '0', unit: '' },
    { key: 'distance', label: '累计距离', value: '0', unit: '' }
  ]);
});

test('buildGrowthOverview:空字段按 UI-04 显示 0', () => {
  const result = buildGrowthOverview({
    center: { code: 200, data: { growth: { levelNo: '', expValue: '' }, badges: [] } },
    play: { code: 200, data: { totalMileage: '' } },
    completed: { code: 200, data: [] }
  });

  assert.equal(result.levelText, '成长概览');
  assert.deepEqual(result.stats, [
    { key: 'exp', label: '探索值', value: '0', unit: '' },
    { key: 'badge', label: '徽章', value: '0', unit: '枚' },
    { key: 'topic', label: '完成主题', value: '0', unit: '个' },
    { key: 'distance', label: '累计距离', value: '0', unit: '' }
  ]);
});

test('buildGrowthOverview:完成主题按 topicId 去重，不把同主题多场次重复计算', () => {
  const result = buildGrowthOverview({
    center: { code: 200, data: { growth: { levelNo: 1, expValue: 30 }, badges: [] } },
    play: { code: 200, data: { totalMileage: 1 } },
    completed: {
      code: 200,
      data: [{ topicId: 7, activityId: 101 }, { topicId: 7, activityId: 102 }, { topicId: 8, activityId: 103 }]
    }
  });

  assert.equal(result.stats.find((item) => item.key === 'topic').value, '2');
});
