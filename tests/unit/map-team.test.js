'use strict';
// 地图组队 P 方案(Figma txQoyVyK 590:1014 P1–P6)纯函数契约。
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../subpackageRoam/utils/map-team.js');

const base = {
  teamId: 7, title: '外滩夜行', activityId: 11, activityName: '外滩夜行路线 · 周五 19:30 场',
  topicId: 3, topicName: '外滩夜行路线', productType: 1, addressName: '外滩源', coordSource: 'GATHER',
  latitude: 31.2, longitude: 121.4, distance: 600, leaderName: '小周', leaderAvatar: 'a.png',
  joinedCount: 3, maxMembers: 4, memberAvatars: ['a.png', 'b.png'], viewerStatus: 'NONE', viewerHasTicket: false, pendingCount: null,
};

test('P2 没票:主按钮白「去买这场的票」,无次级', () => {
  const s = T.teamCardState(Object.assign({}, base, { viewerHasTicket: false }));
  assert.equal(s.mode, 'buy');
  assert.deepEqual(s.primary, { text: '去买这场的票', action: 'buy' });
  assert.equal(s.secondary, null);
  assert.equal(s.notice.text, '加入队伍需要先持有这一场的票');
  assert.equal(s.foot, '买完回到地图,这张卡会变成「申请加入」');
});

test('P3 有票:主按钮「申请加入」', () => {
  const s = T.teamCardState(Object.assign({}, base, { viewerHasTicket: true }));
  assert.equal(s.mode, 'apply');
  assert.deepEqual(s.primary, { text: '申请加入', action: 'apply' });
  assert.equal(s.notice.tone, 'ok');
  assert.equal(s.foot, '队长同意后即可一起出发（沟通请用微信群）');
});

test('P4 申请中:只剩次级「撤回申请」+ 失效说明,即使有票也不出主按钮', () => {
  const s = T.teamCardState(Object.assign({}, base, { viewerStatus: 'PENDING', viewerHasTicket: true }));
  assert.equal(s.mode, 'pending');
  assert.equal(s.primary, null);
  assert.deepEqual(s.secondary, { text: '撤回申请', action: 'withdraw' });
  // 没有 applyExpireTime 时只许说通用规则;写死「24 小时」会撒谎(见 apply-expire-contract.test.js)
  assert.equal(s.foot, '队长没处理或活动开始时,申请自动失效');
});

test('P5 队长:进审批模式,不出申请/买票按钮', () => {
  const s = T.teamCardState(Object.assign({}, base, { viewerStatus: 'LEADER', pendingCount: 2 }));
  assert.equal(s.mode, 'leader');
  assert.equal(s.primary, null);
  assert.equal(s.secondary, null);
});

test('被拒:「不能再申请这支队伍」,没有任何按钮', () => {
  const s = T.teamCardState(Object.assign({}, base, { viewerStatus: 'REJECTED', viewerHasTicket: true }));
  assert.equal(s.mode, 'rejected');
  assert.equal(s.primary, null);
  assert.equal(s.secondary, null);
  assert.equal(s.notice.text, '不能再申请这支队伍');
});

test('已加入:主按钮「进入队伍」', () => {
  const s = T.teamCardState(Object.assign({}, base, { viewerStatus: 'JOINED' }));
  assert.equal(s.mode, 'joined');
  assert.deepEqual(s.primary, { text: '进入队伍', action: 'enter' });
});

test('未知 viewerStatus 按最保守的 NONE 处理(不给队长能力)', () => {
  assert.equal(T.teamCardState(Object.assign({}, base, { viewerStatus: 'WHATEVER' })).mode, 'buy');
});

test('卡片文案:标题兜底、副标题、成员行、名字胶囊', () => {
  const v = T.decorateTeam(Object.assign({}, base, { title: null }));
  assert.equal(v.name, '玩家队伍');
  assert.equal(v.sub, '城市定向 · 外滩源集合 · 距你 600 m');
  assert.equal(v.membersLine, '队长 小周 · 已组 3 人 · 还差 1 人满员');
  assert.equal(v.plate, '玩家队伍 · 3/4');
  assert.equal(T.decorateTeam(Object.assign({}, base, { viewerStatus: 'PENDING' })).plate, '外滩夜行 · 申请中');
  assert.equal(T.decorateTeam(Object.assign({}, base, { viewerStatus: 'LEADER', pendingCount: 2 })).plate, '我的队伍 · 2 人申请');
  assert.equal(T.decorateTeam(Object.assign({}, base, { productType: 2, coordSource: 'TOPIC_NODE', distance: 1500 })).sub, '自由探索 · 外滩源附近 · 距你 1.5 km');
});

test('私密字段不进卡片视图:inviteCode / leaderMemberId / ownerType 一律丢掉', () => {
  const v = T.decorateTeam(Object.assign({}, base, { inviteCode: 'SECRET1', leaderMemberId: 99, ownerType: 2 }));
  const json = JSON.stringify(v);
  assert.doesNotMatch(json, /SECRET1|inviteCode|leaderMemberId|ownerType/);
});

test('顶部条与角控件文案', () => {
  assert.equal(T.headerText(2), '附近的队伍 · 2 支在招募');
  assert.equal(T.headerText(0), '附近的队伍 · 0 支在招募');
  assert.equal(T.rangeText(1000), '范围 1 km');
  assert.equal(T.rangeText(3000), '范围 3 km');
  assert.equal(T.nextRadius(1000), 3000);
  assert.equal(T.nextRadius(20000), 1000);
  assert.equal(T.myTeamsText(0), '我的队伍');
  assert.equal(T.myTeamsText(2), '我的队伍 · 2');
});

test('errorCode 分支:apply 各码落到对的界面动作', () => {
  assert.deepEqual(T.resolveTeamError('apply', { errorCode: 'TICKET_REQUIRED' }).patch, { viewerHasTicket: false, viewerStatus: 'NONE' });
  assert.deepEqual(T.resolveTeamError('apply', { errorCode: 'APPLY_REJECTED' }).patch, { viewerStatus: 'REJECTED' });
  assert.deepEqual(T.resolveTeamError('apply', { errorCode: 'APPLY_PENDING' }).patch, { viewerStatus: 'PENDING' });
  assert.deepEqual(T.resolveTeamError('apply', { errorCode: 'ALREADY_JOINED' }).patch, { viewerStatus: 'JOINED' });
  for (const code of ['TEAM_FULL', 'ACTIVITY_STARTED', 'TEAM_UNDER_REVIEW', 'TEAM_NOT_PUBLIC']) {
    assert.equal(T.resolveTeamError('apply', { errorCode: code }).dropTeam, true, code);
  }
  assert.equal(T.resolveTeamError('apply', { errorCode: 'TICKET_REQUIRED' }).primary, '去买票');
  assert.equal(T.resolveTeamError('apply', { errorCode: 'APPLY_BLOCKED' }).dropTeam, false);
});

test('errorCode 分支:withdraw / handle', () => {
  assert.equal(T.resolveTeamError('withdraw', { errorCode: 'APPLY_NOT_PENDING' }).refresh, true);
  assert.equal(T.resolveTeamError('handle', { errorCode: 'APPLY_NOT_PENDING' }).dropApplicant, true);
  assert.equal(T.resolveTeamError('handle', { errorCode: 'TICKET_REQUIRED' }).dropApplicant, true);
  assert.equal(T.resolveTeamError('handle', { errorCode: 'TEAM_FULL' }).refresh, true);
});

test('不解析文案:同一句 msg 没有 errorCode 时只当兜底失败,不触发任何状态改动', () => {
  const r = T.resolveTeamError('apply', { msg: '请先购买本场次的票(TICKET_REQUIRED)' });
  assert.equal(r.patch, null);
  assert.equal(r.dropTeam, false);
  assert.equal(r.why, '请先购买本场次的票(TICKET_REQUIRED)');
  assert.equal(r.primary, '');
});

test('失败半屏合同:按钮最多两个,标题恒有', () => {
  const codes = ['TICKET_REQUIRED', 'APPLY_REJECTED', 'APPLY_PENDING', 'ALREADY_JOINED', 'TEAM_FULL', 'ACTIVITY_STARTED',
    'TEAM_UNDER_REVIEW', 'TEAM_NOT_PUBLIC', 'APPLY_BLOCKED', 'APPLY_NOT_PENDING', undefined];
  for (const op of ['apply', 'withdraw', 'handle']) {
    for (const code of codes) {
      const r = T.resolveTeamError(op, { errorCode: code, msg: 'x' });
      assert.ok(r.title, op + code);
      assert.ok([r.primary, r.secondary].filter(Boolean).length <= 2);
    }
  }
});

test('P6 我的队伍三态:已加入 / 申请中 / 队长未同意,同一队去重以已加入为准', () => {
  const rows = T.myTeamRows(
    [{ id: 7, title: '外滩夜行', activityName: '周五场', joinedCount: 3, maxMembers: 4, status: 0, inviteCode: 'SECRET1' },
      { id: 9, title: '散了', joinedCount: 1, maxMembers: 4, status: 4 }],
    [{ teamId: 8, title: '苏河湾探店日', leaderName: '阿May', applyStatus: 'PENDING', joinedCount: 2, maxMembers: 4 },
      { teamId: 10, title: '霓虹拾光', leaderName: 'x', applyStatus: 'REJECTED' },
      { teamId: 7, title: '外滩夜行', applyStatus: 'PENDING' }],
  );
  assert.deepEqual(rows.map((r) => [r.teamId, r.badge, r.action.text, r.action.kind, r.sub]), [
    [7, '已加入', '进入队伍', 'primary', '3/4 人'],
    [8, '申请中', '撤回申请', 'secondary', '队长 阿May'],
    [10, '队长未同意', '看附近队伍', 'secondary', '不能再申请这支队伍'],
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /SECRET1|inviteCode/);
});

test('队伍 marker:数字 id 末位 4、圆头像 + 人数角标;无坐标不画', () => {
  const m = T.buildTeamMarkers([base, Object.assign({}, base, { teamId: 8, latitude: null })], {}, 'fallback.png');
  assert.equal(m.length, 1);
  assert.equal(m[0].id, 74);
  assert.equal(T.teamMarkerSpec(base).role, 'player');
  assert.equal(T.teamMarkerSpec(base).badge, '3');
  assert.equal(T.teamMarkerSpec(Object.assign({}, base, { viewerStatus: 'JOINED' })).state, 'joined');
});

test('申请列表行:「持本场票 · N 分钟前申请」', () => {
  const now = new Date(2026, 8, 15, 12, 10, 0).getTime();
  const r = T.applicantRows([{ memberId: 5, memberName: '阿杰', memberAvatar: 'x', appliedAt: '2026-09-15 12:08:00' }], now);
  assert.equal(r[0].sub, '持本场票 · 2 分钟前申请');
  assert.equal(T.leaderSub({ joinedCount: 3, maxMembers: 4 }), '你是队长 · 已组 3/4 · 还能再加 1 人');
  assert.equal(T.leaderFoot({ joinedCount: 3, maxMembers: 4 }), '同意 1 人后队伍满员:从地图上消失,其余申请自动失效');
});

test('TEAM_NOT_PUBLIC 不冒充「已满/已开始」', () => {
  const r = T.resolveTeamError('apply', { errorCode: 'TEAM_NOT_PUBLIC' });
  assert.equal(r.dropTeam, true);
  assert.equal(r.title, '这支队伍只接受邀请');
});
