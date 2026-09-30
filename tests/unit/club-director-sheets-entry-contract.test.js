// E-04(2026-09-16 整体检查 E 组 P1):导演台四个弹层(D4/D5/D6/D8)有组件、有方法、没有入口。
//
// 病:cy-club-director-* 五个 sheet 都渲染在页面里,openManualUnlock/openTeamSheet/
//     openRoleAssignment/openIncidentSheet 也都有实现,但全仓 wxml 零绑定 ——
//     只有单测直接调方法,于是「入口缺失」这门禁盲区一直绿。
// 治:现场工具行 bindtap 到四个真方法;D6 弹层的成员列表改喂可定位的 roleMemberRows。
// 负控:删掉任一 bindtap 或把 members 换回 teams,本文件必须红。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const WXML = read('pages/club/topic-detail/index.wxml');
const PAGE_JS = read('pages/club/topic-detail/index.js');
const DIRECTOR_JS = read('pages/club/topic-detail/director.js');
const { DIRECTOR_METHODS } = require(path.join(ROOT, 'pages/club/topic-detail/director.js'));

const ENTRIES = [
  ['openManualUnlock', '手动解锁章节', 'D4'],
  ['openTeamSheet', '队伍进度', 'D5'],
  ['openRoleSheet', '角色分配', 'D6'],
  ['openIncidentSheet', '现场事件', 'D8'],
];

test('D4/D5/D6/D8 四个弹层都有绑到真方法的可点入口,不是只有方法没有线', () => {
  for (const [handler, label, sheet] of ENTRIES) {
    assert.match(WXML, new RegExp('bindtap="' + handler + '"'), sheet + '(' + label + ') 必须有 bindtap 入口');
    assert.match(PAGE_JS + DIRECTOR_JS, new RegExp(handler + '\\s*\\('), sheet + ' 的 ' + handler + ' 必须在页面方法里真的存在');
  }
});

test('D6:弹层成员列表喂 roleMemberRows(带 teamId:memberId),行点击有接收方', () => {
  assert.match(WXML, /members="\{\{roleMemberRows\}\}"/);
  assert.doesNotMatch(WXML, /members="\{\{teams\}\}"/, 'teams 行没有 memberId,点不出角色分配');
  assert.match(WXML, /bind:selectmember="onRoleMemberPick"/);

  // 行为:按 id 回落到角色分配草稿(负控:去掉 prefix 解析,这里必红)
  const host = {
    data: {
      writeLocked: false,
      canAssignRoles: true,
      roles: [{ teamId: 11, memberId: 21, memberNameText: '阿青', roleCode: 'SCOUT' }],
      roleMemberRows: [{ id: '11:21', title: '阿青' }],
      roleDraft: {},
    },
    _roleOptions: [{ roleCode: 'SCOUT', label: '侦察员' }, { roleCode: 'KEEPER', label: '守护员' }],
    openRoleRow: DIRECTOR_METHODS.openRoleRow,   // 真页面里方法全铺在同一个 Page 对象上
    setData(patch) { Object.assign(this.data, patch); },
  };
  DIRECTOR_METHODS.onRoleMemberPick.call(host, { detail: { id: '11:21' } });
  assert.equal(host.data.roleSheetVisible, true, '选成员必须把弹层打开');
  assert.equal(host.data.roleDraft.teamId, 11);
  assert.equal(host.data.roleDraft.memberId, 21);
  assert.equal(host.data.roleDraft.roleCode, 'SCOUT', '默认选中该成员当前角色');

  const noPerm = { data: { writeLocked: false, canAssignRoles: false, roles: [], roleMemberRows: [] }, setData() {} };
  global.wx = global.wx || { showToast() {} };   // director.js 的 toast 回落读全局 wx
  DIRECTOR_METHODS.openRoleSheet.call(noPerm);
  assert.equal(noPerm.data.roleSheetVisible, undefined, '没有 ASSIGN_ROLES 不许开弹层');
});
