'use strict';
// applyExpireTime 契约:申请失效时刻由服务端 min(申请+24h, 场次开始) 决定
// (migration_20260915_play_team_public_apply.sql:15 · PlayTeamServiceImpl.java:397)。
// 活动 2 小时后开场时申请 2 小时就失效,前端写死「24 小时」就是撒谎。
// 三处消费面:「申请中」卡片 foot / P6「我的队伍 · 申请中」行 / 队长申请列表行。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../../subpackageRoam/utils/map-team.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NOW = new Date('2026-09-16T20:00:00+08:00').getTime();       // 中国时间 20:00
const EXPIRE_2H = new Date('2026-09-16T22:00:00+08:00').getTime(); // 22:00 开场即失效 = 2 小时后

const base = {
  teamId: 7, title: '外滩夜行', activityName: '外滩夜行 · 周五 19:30 场', leaderName: '小周',
  joinedCount: 2, maxMembers: 4, viewerHasTicket: true,
};

test('P4 申请中:foot 说真实剩余时间,不再写死「24 小时」', () => {
  const s = T.teamCardState(Object.assign({}, base, { viewerStatus: 'PENDING', applyExpireTime: EXPIRE_2H }), NOW);
  assert.equal(s.mode, 'pending');
  assert.doesNotMatch(s.foot, /24\s*小时/);
  assert.match(s.foot, /2 小时后自动失效/);
});

test('拿不到 applyExpireTime:兜底文案不许再断言 24 小时(退回通用规则句)', () => {
  const s = T.teamCardState(Object.assign({}, base, { viewerStatus: 'PENDING' }), NOW);
  assert.doesNotMatch(s.foot, /24\s*小时/);
  assert.ok(s.foot.length > 0, '兜底文案不能为空');
});

test('P6「申请中」行说真实剩余时间', () => {
  const rows = T.myTeamRows([], [{
    teamId: 8, title: '苏河湾探店日', leaderName: '阿May', applyStatus: 'PENDING', applyExpireTime: EXPIRE_2H,
  }], NOW);
  assert.equal(rows.length, 1);
  assert.match(rows[0].sub, /2 小时后失效/);
  assert.doesNotMatch(rows[0].sub, /24\s*小时/);
});

test('队长申请列表行说真实剩余时间', () => {
  const r = T.applicantRows([{
    memberId: 5, memberName: '阿杰', memberAvatar: 'x', appliedAt: '2026-09-16 19:58:00', applyExpireTime: EXPIRE_2H,
  }], NOW);
  assert.match(r[0].sub, /2 小时后失效/);
  assert.doesNotMatch(r[0].sub, /24\s*小时/);
});

// ── 页面接线:申请成功回填服务端回执里的 applyExpireTime ──────────────
const PAGE = '../../subpackageRoam/nearby/index.js';
let config; let requests;
global.getApp = () => ({
  globalData: {}, getImgUrl: (u) => u || '', sendRequest: (opts) => { requests.push(opts) },
});
global.wx = {
  getWindowInfo: () => ({ screenHeight: 844, safeArea: { bottom: 810 } }),
  getMenuButtonBoundingClientRect: () => ({ bottom: 88 }),
  getLocation: () => {}, navigateTo: () => {}, showToast: () => {},
  // 申请留言弹层(2026-09-17 拍板第19条):stub 无 cy-modal-host 时 modal.js 回落 wx.showModal;
  // 本文件只测 applyExpireTime 回填,确认但不填留言。
  showModal: (o) => { o && typeof o.success === 'function' && o.success({ confirm: true, content: '' }); },
  createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }),
};
global.Page = (c) => { config = c; };

function setByPath(target, raw, value) {
  const parts = raw.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i += 1) { if (cur[parts[i]] == null) cur[parts[i]] = {}; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = value;
}
function loadPage() {
  requests = [];
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = function (patch, cb) { Object.keys(patch).forEach((k) => setByPath(this.data, k, patch[k])); if (cb) cb(); };
  page._openSheet = function (name) { this.setData({ sheet: name, sheetIn: true }); };
  page._genTeamIcons = () => Promise.resolve(false);
  page._genIcons = () => Promise.resolve(false);
  page.onLoad();
  return page;
}

test('页面接线:申请成功把手里的 applyExpireTime 回填进卡片,foot 立刻说真实剩余时间', () => {
  const page = loadPage();
  const row = Object.assign({}, base, {
    teamId: 7, activityId: 11, topicId: 3, productType: 1, distance: 600,
    addressName: '外滩源', coordSource: 'GATHER', latitude: 31.2, longitude: 121.4,
    memberAvatars: [], viewerStatus: 'NONE', viewerHasTicket: true, pendingCount: null,
  });
  page.fetchTeams({ lat: 31.2, lng: 121.4 }, 3000);
  requests.filter((r) => r.url === '/api/team/nearby').pop().success({ code: 200, data: [row] });
  page.onMarkerTap({ detail: { markerId: 74 } });
  page.onCardPrimary();
  const req = requests.filter((r) => r.url === '/api/team/apply').pop();
  assert.ok(req, '必须请求 POST /api/team/apply');
  req.success({ code: 200, msg: '已申请，等待队长同意', data: { applyExpireTime: Date.now() + 2 * 3600 * 1000 + 5000 } });
  assert.doesNotMatch(page.data.current.card.foot, /24\s*小时/);
  assert.match(page.data.current.card.foot, /2 小时后自动失效/);
});

test('页面静态:卡片文案模块不再出现写死的「24 小时」', () => {
  assert.doesNotMatch(stripComments(read('subpackageRoam/utils/map-team.js')), /24\s*小时/);
});
