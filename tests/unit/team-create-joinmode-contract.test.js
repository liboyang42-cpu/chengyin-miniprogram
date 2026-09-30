'use strict';

/* 建队组队方式契约(2026-09-15 地图组队 P 方案合拢)。
 *
 * 真源在后端:PlayTeamServiceImpl.create 对 joinMode==null 取 2(公开申请制),
 * 公开队伍才会被 /api/team/nearby 捞到、出现在漫游地图「附近的队伍」里。
 * ⇒ 前端「默认公开」的正确写法是**不传这个字段**,而不是写死一个 2 ——
 *   写死等于在前端复制一份后端枚举,后端改默认值时这里会静默变成旧语义。
 * 队长要收窄成仅邀请时才显式带 joinMode:1,由订单页那颗「仅邀请可加入」开关给出。
 *
 * 这条契约挡的是两种回潮:
 *   ① 又变回「建队一律邀请制」(joinMode 恒 1)→ 新队伍永远进不了地图,「附近的队伍」恒为空;
 *   ② 在前端写死 joinMode:2 「顺手」复制一份后端默认值 → 后端改默认时这里静默变旧语义。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const teamUp = require(path.join(ROOT, 'utils/team-up.js'));

/** 默认档的判据:body 里压根没有 joinMode 这个字段。 */
function isDefaultPublic(body) { return !('joinMode' in body); }

/** 跑一次建队,把真正发出去的 body 抓回来。 */
function sentBody(joinMode) {
  let captured = null;
  const app = { sendRequest(options) { captured = JSON.parse(options.data); } };
  teamUp.createActivityTeam(app, 42, 3, joinMode, {});
  assert.ok(captured, 'createActivityTeam 没有发出请求');
  return captured;
}

test('默认建队不传 joinMode:公开与否交给后端默认值(=2,地图可见)', () => {
  for (const noop of [undefined, null, 2, 0, '', false]) {
    const body = sentBody(noop);
    assert.ok(isDefaultPublic(body), '传 ' + String(noop) + ' 时不该出现 joinMode 字段');
    assert.deepEqual(body, { ownerType: 2, ownerId: 42, maxMembers: 3 });
  }
});

test('只有明确要「仅邀请」时才带 joinMode:1', () => {
  for (const on of [1, '1', true]) {
    assert.equal(sentBody(on).joinMode, 1, String(on) + ' 应当被当成仅邀请');
  }
});

test('负控:建队写回「恒邀请制」时,上面那条默认档判据必须判红', () => {
  // 这是 2026-09-15 之前的老行为(后端 DDL 默认 join_mode=1):新队伍全是邀请制,
  // /api/team/nearby 只捞 join_mode=2 ⇒「附近的队伍」上线即恒为空。
  const alwaysInvite = { ownerType: 2, ownerId: 42, maxMembers: 3, joinMode: 1 };
  assert.equal(isDefaultPublic(alwaysInvite), false, '判据失效:恒邀请制的 body 竟被当成默认公开');
  assert.equal(isDefaultPublic(sentBody(undefined)), true, '判据失效:现码的默认档被误判成非默认');
});

test('订单页的「仅邀请」开关真接到建队调用上(默认关=公开)', () => {
  const js = fs.readFileSync(path.join(ROOT, 'components/cy/scene-member-order-detail/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/scene-member-order-detail/index.wxml'), 'utf8');
  assert.match(js, /teamInviteOnly:\s*false/, '开关默认值必须是关(=公开)');
  // 只钉「开关值进了 joinMode 这一格」,不钉那一格的具体写法:改成 helper 或换三元都该继续绿。
  assert.match(js, /createActivityTeam\([^)]*,\s*[^,)]*teamInviteOnly[^,)]*,\s*\{/,
    '建队调用没有把开关值传下去');
  assert.match(wxml, /<cy-switch checked="\{\{teamInviteOnly\}\}" bindchange="onTeamInviteOnlyChange"/,
    '订单页建队卡上没有「仅邀请」开关');
});
