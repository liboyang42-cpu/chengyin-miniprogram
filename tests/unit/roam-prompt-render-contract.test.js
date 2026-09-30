const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const roamTemplate = fs.readFileSync(
  path.resolve(__dirname, '../../pages/roam/index.wxml'),
  'utf8'
);
const roamPromptLinesMigration = fs.readFileSync(
  path.resolve(__dirname, '../../../chengyinhub-admin/sql/migration_roam_prompt_lines_v2_20260722.sql'),
  'utf8'
);
const roamPromptLinesSql = roamPromptLinesMigration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

test('漫游提示只渲染中性文字，不渲染 NPC 人设元素', () => {
  assert.match(roamTemplate, /漫游提示/, '提示层需要使用中性标签');
  assert.doesNotMatch(roamTemplate, /AI 游戏向导/, '不得渲染角色后缀');
  assert.doesNotMatch(roamTemplate, /npcBubble/, '提示层不得继续绑定 NPC 视图模型');
  assert.doesNotMatch(roamTemplate, /npc-avatar|npc-name/, '提示层不得保留头像或角色名元素');
});

test('漫游提示话术迁移先下线旧版本，再等待新版本审核', () => {
  assert.match(roamPromptLinesSql, /SET c\.audit_status = 0/, '旧版本必须先下线，避免拟人化话术继续可见');
  assert.match(roamPromptLinesSql, /version, create_time, update_time\)[\s\S]*?, 0, 2, NOW\(\), NOW\(\)/,
    '新版本必须以待审状态写入 version=2 话术');
  assert.doesNotMatch(roamPromptLinesSql, /跟着感觉|城市认识你|辛苦啦/,
    '新版本迁移不得带入旧拟人化话术');
});
