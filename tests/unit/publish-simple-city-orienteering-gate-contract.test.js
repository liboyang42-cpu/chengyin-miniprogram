/* CR-423 「城市定向仅主理人可发起」死闸清除合同(2026-09-15)
 *
 * 病:后端 D3(2026-09-05 用户裁决「商家城市定向只能自己玩,不能邀约就好了」)已放行
 *     「商家/普通玩家不绑俱乐部直发城市定向」(ApiTopicController.createTopic,clubId 为空时
 *     只拒「主理人」——他必须绑自己的俱乐部);而前端曾按旧规则弹
 *     「城市定向团仅主理人可发起」,把后端早已放行的商家拦在门外 —— 页/后端口径打架。
 * 治:前端只保留与 fabu.submitForm 同一条预检(手上有俱乐部就必须明确归属),
 *     谁能发一律由 /api/topic/create 裁定;前端既不比后端宽,也不比后端窄。
 *
 * 2026-09-20 合批说明:原来这里还钉着**简易版页**的发布预检行为(onPublish 三条用例)——
 * 那条发布链路(onPublish/onSaveDraft/validate/buildPayload)在 wxml 上零绑定,用户从来
 * 没能从简易页发出过主题,整块孤儿代码随 2026-09 审查 #14 删除,断言锚点已不存在。
 * 现在的发布口只有 fabu 一条:本文件钉住 ① fabu 的预检规则形状没漂;② 后端 D3 判据仍在;
 * ③ 简易页确实不再自行发布(孤儿链路不许复活成半截闸)。负控照旧钉 ①②。
 */
process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PAGE_SRC = fs.readFileSync(path.resolve(ROOT, 'pages/publish/simple/index.js'), 'utf8');
const FABU_SRC = fs.readFileSync(path.resolve(ROOT, 'pages/publish/fabu/index.js'), 'utf8');
const JAVA = path.resolve(ROOT, '../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiTopicController.java');

test('口径:fabu 预检规则形状没漂(手上有俱乐部且未选归属才拦,不比后端宽)', () => {
  // 发布口只剩 fabu:预检规则必须是「城市定向 + 有俱乐部 + 未选归属」才拦 ——
  // 谁真的能发由 /api/topic/create 裁定,前端不许再按身份加闸。
  assert.match(FABU_SRC, /isCityOrienteering && this\.data\.myClubs\.length > 0 && !this\.data\.formData\.clubId/,
    'fabu 规则漂了 —— D3 的页/后端口径要重新人工核对');
  assert.doesNotMatch(FABU_SRC, /城市定向团仅主理人可发起,要先成为主理人吗/, '旧弹窗文案回来了,非主理人仍会被拦');
});

test('口径:简易页不再自带发布链路(孤儿闸不许半截复活)', () => {
  assert.doesNotMatch(PAGE_SRC, /onPublish\(\)\s*\{/,
    '简易页发布链路的孤儿方法又回来了 —— 页面无绑定,回来就是第二道没人看得见的闸');
  assert.doesNotMatch(PAGE_SRC, /this\.data\.mode === 1 && this\.data\.myClubs\.length > 0 && !this\.data\.clubId/,
    '简易页里重新长出发布预检 —— 先回答「它到底能不能发布」再谈钉这条');
});

test('后端合同:D3 现码仍是「non-leader 无 clubId 放行 / leader 无 clubId 拒绝」', () => {
  const java = fs.readFileSync(JAVA, 'utf8');
  assert.match(java, /if \(dto\.getClubId\(\) == null\) \{/, '无俱乐部直发这段判据不见了');
  assert.match(java, /if \(isLeaderPub\) \{[\s\S]{0,200}?请选择发起经典定向团的合作俱乐部/,
    '主理人不绑俱乐部必须仍被拒,别把 D3 误读成「谁都不用绑」');
  assert.match(java, /boolean isLeaderPub = leader != null && \(leader\.getStatus\(\) == null \|\| leader\.getStatus\(\) == 1\)/,
    '身份判据变了,前端的预检前提要重新核对');
  // 放行侧不允许再出现「按角色拒绝非主理人」的分支(D3 后的口径:身份不再参与这道闸)
  const cityBlock = /boolean isCityOrienteering = TopicProductTypeResolver\.resolve\(dto\)[\s\S]*?\n            \}/.exec(java);
  assert.ok(cityBlock, '找不到城市定向门禁整段');
  assert.doesNotMatch(cityBlock[0], /isMerchant\(|isPlayer\(/, 'D3 后身份不参与这道闸,别再按角色拒绝');
});

test('负控:fabu 预检被删、后端领队闸被放宽时,上面断言必须判红', () => {
  const gateGone = FABU_SRC.replace(
    'isCityOrienteering && this.data.myClubs.length > 0 && !this.data.formData.clubId',
    'true');
  assert.notEqual(gateGone, FABU_SRC, '变异没生效:预检形状已漂移,这个负控在空转');
  assert.throws(() => assert.match(gateGone,
    /isCityOrienteering && this\.data\.myClubs\.length > 0 && !this\.data\.formData\.clubId/), assert.AssertionError);

  const java = fs.readFileSync(JAVA, 'utf8');
  const leaderGate = /if \(isLeaderPub\) \{\s*\n\s*return error\("请选择发起经典定向团的合作俱乐部"\);\s*\n\s*\}/;
  assert.match(java, leaderGate, 'D3 的领队闸形状已变,合同要跟着人工复核');
  const loosened = java.replace(leaderGate, 'if (false) { }');
  assert.notEqual(loosened, java, '变异没生效:领队闸形状已漂移,这个负控在空转');
  assert.throws(() => assert.match(loosened, leaderGate), assert.AssertionError);
});
