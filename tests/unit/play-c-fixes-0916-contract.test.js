'use strict';
// C 组修复契约(2026-09-16):游玩域 C-18 / C-19(前端) / C-21(前端) / C-22 / C-24 / C-27
// 与地图域 C-01 / C-02。每条钉住修复后的行为,撤掉修复即判红。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const PLAY_JS = () => read('pages/play/index.js');
const PLAY_WXML = () => read('pages/play/index.wxml');
const TEAM_DETAIL_WXML = () => read('pages/team/detail/index.wxml');
const MAP_TEAM_JS = () => read('subpackageRoam/utils/map-team.js');

// C-18(2026-09-17 用户拍板第16条改口径):拍照节点人工审核开关下线,一律机审。
// 玩家端不再有「审核中」态与待审回执分支;编辑器不再有开关;保存回显恒 0。
// 撤掉本修复(把开关/审核态加回去)即判红。
test('C-18 拍照一律机审:人工审核开关与「审核中」态全部下线', () => {
  const js = PLAY_JS();
  const wxml = PLAY_WXML();
  const editor = read('pages/publish/temp/index.wxml');
  const editorJs = read('pages/publish/temp/index.js');

  assert.doesNotMatch(wxml, /reviewStatus/, '玩家端不得再渲染审核态');
  assert.doesNotMatch(js, /reviewStatus/, '玩家端不得再读审核态');
  assert.doesNotMatch(js, /applyPendingReview/, '待审回执落地路径必须随开关一起删掉');
  assert.doesNotMatch(wxml, /人工审核/);

  assert.doesNotMatch(editor, /需人工审核照片/, '编辑器不得再有「需人工审核照片」开关');
  assert.doesNotMatch(editor, /onPhotoReviewChange/);
  assert.doesNotMatch(editorJs, /onPhotoReviewChange/, '开关 handler 必须删掉');
  assert.match(editorJs, /photoReview: 0,/, '保存/回显恒为机审');
  // 回显旧值会绕过单点「恒 0」:模板里 photo_review=1 又被抄回去就等于开关复活
  assert.doesNotMatch(editorJs, /photoReview:\s*templateData\.photoReview/, '回显不得再抄模板旧开关值');

  // 提交成功直接走完成链(发奖/解锁/庆祝),不存在第二条「等审核」路径
  const submit = js.slice(js.indexOf('submitPhoto(nodeId, pic)'), js.indexOf('submitGame() {'));
  assert.match(submit, /that\.onComplete\(nodeId, r\.data\);/);
  assert.doesNotMatch(submit, /pendingReview/);
});

test('C-19 解锁提示必须带会话上下文(与解谜提示同口径),只发 nodeId 会被后端拒', () => {
  const js = PLAY_JS();
  const slice = js.slice(js.indexOf("url: '/api/play/hint/unlock'"), js.indexOf("url: '/api/play/hint/unlock'") + 600);
  assert.match(slice, /data: Object\.assign\(\{ nodeId: g\.nodeId \}, that\._sessionParams\(\)\)/);
  assert.doesNotMatch(slice, /data: \{ nodeId: g\.nodeId \}/, '只发 nodeId 的旧形态必须改掉');
});

test('C-21 名次奖牌只为中签者弹;没中签不再弹假勋章', () => {
  const js = PLAY_JS();
  assert.match(js, /const medalRank = data && Number\(data\.medalRank\) > 0 \? Number\(data\.medalRank\) : 0;/);
  assert.match(js, /if \(hasMedalArt && \(medalRank \|\| previewMedal\)\)/);
  assert.match(js, /this\.diegetic\('这个节点的名次奖牌已经发完，完成记录已保存'\)/);
  assert.doesNotMatch(js, /if \(node\.medalName \|\| node\.medalImg\) \{\s*\n\s*\/\/ 模板勋章弹层/,
    '旧的无条件弹层条件必须消失');
  assert.doesNotMatch(js, /if \(newBadges\.length \|\| node\.medalName \|\| node\.medalImg\) this\._triggerCelebration\('medal-earned'\)/);
});

test('C-22 只有后端标了「答案错」才计错;业务拒绝不再解锁揭示', () => {
  const js = PLAY_JS();
  assert.match(js, /const answerWrong = !!\(r\.data && r\.data\.answerWrong\);/);
  assert.match(js, /const wc = answerWrong \? that\.data\.wrongCount \+ 1 : that\.data\.wrongCount;/);
});

test('C-24 没有 registrationId 时给一条去票夹的出路,不再是一句死提示', () => {
  const js = PLAY_JS();
  assert.match(js, /_explainMissingEntryQr\(\) \{[\s\S]{0,500}?wx\.reLaunch\(\{ url: '\/subpackageMember\/signup\/index' \}\)/);
  const openEntry = js.slice(js.indexOf('  openEntryQr() {'), js.indexOf('  noop() {}'));
  assert.match(openEntry, /if \(!regId\) \{ this\._explainMissingEntryQr\(\); return; \}/);
  const ticket = js.slice(js.indexOf('  ensureTicket() {'), js.indexOf("req('/api/verify/dyncode/issue'"));
  assert.match(ticket, /if \(!regId\) \{ this\._explainMissingEntryQr\(\); return; \}/);
  assert.doesNotMatch(js, /从票夹进入才能出示入场码'\) : cyToast\('从票夹进入才能出示入场码/,
    '原来那句只 toast 的死提示必须改掉');
});

test('C-27 节点分展示后端真源 xp,缺省才回落 12', () => {
  const js = PLAY_JS();
  assert.match(js, /points: n\.xp \|\| 12,/);
  assert.doesNotMatch(js, /points: 12,/, '写死的 12 会少报高探索值节点');
});

test('C-01 有票卡的底注不再承诺「自动进群聊」(小程序根本不露出队伍群)', () => {
  const js = MAP_TEAM_JS();
  assert.doesNotMatch(js, /你会自动进入这支队伍的群聊/);
  assert.match(js, /队长同意后即可一起出发（沟通请用微信群）/);
});

test('C-02 队伍详情按 joinMode 显示公开/仅邀请,不再恒称邀请制', () => {
  const wxml = TEAM_DETAIL_WXML();
  assert.match(wxml, /team\.joinMode == 2 \? '公开招募[^']*' : '仅邀请[^']*'/);
  assert.doesNotMatch(wxml, /邀请制队伍 · 组队与否不影响活动举行/);
});
