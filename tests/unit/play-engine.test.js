'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPrefabLife } = require('../../utils/play-engine.js');

test('F19 玩法按稳定 topicId 或 engineKey 分流，不看展示标题', () => {
  assert.equal(isPrefabLife({ topicId: 990059, title: '完全改名' }), true);
  assert.equal(isPrefabLife({ topicId: 504, engineKey: 'PREFAB_LIFE' }), true);
  assert.equal(isPrefabLife({ topicId: 504, title: '预制人生 · 同名普通活动' }), false);
});
