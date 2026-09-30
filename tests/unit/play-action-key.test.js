const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildActionKey, buildUnitId } = require('../../pages/play/utils/play-action-key.js');

test('同一次动作意图重试produce同一个幂等键', () => {
  const first = buildActionKey(12, 3, 'CHOOSE', { optionId: 'a1' });
  const second = buildActionKey(12, 3, 'CHOOSE', { optionId: 'a1' });
  assert.equal(first, second, '重试必须复用同一个键，否则服务端 replay 永远命中不了');
});

test('payload 键顺序不影响幂等键', () => {
  assert.equal(
    buildActionKey(12, 3, 'ASSIGN_ROLE', { memberId: 7, roleId: 'r1' }),
    buildActionKey(12, 3, 'ASSIGN_ROLE', { roleId: 'r1', memberId: 7 })
  );
});

test('version / action / payload / session 任一变化都换键', () => {
  const base = buildActionKey(12, 3, 'CHOOSE', { optionId: 'a1' });
  assert.notEqual(base, buildActionKey(12, 4, 'CHOOSE', { optionId: 'a1' }), 'version 变=新动作');
  assert.notEqual(base, buildActionKey(12, 3, 'DRAW', { optionId: 'a1' }), 'action 变=新动作');
  assert.notEqual(base, buildActionKey(12, 3, 'CHOOSE', { optionId: 'a2' }), 'payload 变=新动作');
  assert.notEqual(base, buildActionKey(13, 3, 'CHOOSE', { optionId: 'a1' }), 'session 变=新动作');
});

test('幂等键长度不超过服务端 64 位上限', () => {
  const key = buildActionKey(Number.MAX_SAFE_INTEGER, 999999, 'ASSIGN_ROLE', {
    memberId: 9007199254740991, roleId: 'r'.repeat(200)
  });
  assert.ok(key.length <= 64, `实际 ${key.length} 位，服务端会抛「幂等键不能为空且最多 64 位」`);
  assert.ok(key.length > 0);
});

test('缺 sessionId 或 version 时拒绝出键 —— 不能拿空值当幂等键', () => {
  assert.equal(buildActionKey(0, 3, 'DRAW', {}), '');
  assert.equal(buildActionKey(12, null, 'DRAW', {}), '');
  assert.equal(buildActionKey(12, 3, '', {}), '');
});

test('completeUnit 的 unitId 按 session+version 派生，重试不换单元', () => {
  assert.equal(buildUnitId(12, 3), buildUnitId(12, 3));
  assert.notEqual(buildUnitId(12, 3), buildUnitId(12, 4));
  assert.ok(buildUnitId(12, 3).length <= 64);
});

test('负控：源码里不得再用 Date.now/Math.random 拼幂等键或 unitId', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../pages/play/components/advanced-game/index.js'), 'utf8');
  const keyLines = source.split('\n').filter(line => /idempotencyKey|unitId/.test(line));
  assert.ok(keyLines.length > 0, '组件里应当仍在传幂等键');
  keyLines.forEach(line => {
    assert.doesNotMatch(line, /Date\.now\(\)|Math\.random\(\)/,
      `幂等键/单元号不能带时间或随机数，否则重试=新键=重复写入：${line.trim()}`);
  });
});
