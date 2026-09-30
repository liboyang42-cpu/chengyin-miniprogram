const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskJsNonCode } = require('../../../ci/api-existence-gate.js');

const XCX_ROOT = path.resolve(__dirname, '../..');
const SECURITY = path.resolve(
  XCX_ROOT,
  '../chengyinhub-framework/src/main/java/com/chengyinhub/framework/config/SecurityConfig.java'
);
const CLUB_LEAD_CONTROLLER = path.resolve(
  XCX_ROOT,
  '../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiClubLeadController.java'
);
const ROAM_CONTROLLER = path.resolve(
  XCX_ROOT,
  '../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiRoamController.java'
);
const PLAY_PROGRESS_CONTROLLER = path.resolve(
  XCX_ROOT,
  '../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiPlayProgressController.java'
);

// 当前生产代码 41 个 GET 调用点的显式权限清单（直接 26 + req 包装 15）。
// optional = 后端允许匿名，但登录时会按 uid 返回个人态，所以仍使用默认认证；
// required = 后端 anyRequest().authenticated()，绝不能 auth:false。
const MATRIX = [
  ['utils/deregister-flow.js', "sendUiStateRequest(app, '/api/user/deregister/status'", 'required', 'member', 'self-account'],
  ['pages/square/list/index.js', "url: '/api/official/events'", 'optional', 'visitor/member', 'public-list+viewer-personalization'],
  ['components/cy/scene-roam-task-list/index.js', "url: '/api/official/events'", 'optional', 'visitor/member', 'public-list+viewer-personalization'],
  ['components/cy/scene-roam-task-list/index.js', "url: '/api/official/my-events'", 'required', 'member', 'self-registration'],
  ['pages/activity/official-inbox/index.js', "url: '/api/official/v2/party-inbox'", 'required', 'member', 'self-party'],
  ['pages/merchant/coop-center/index.js', "url: '/api/official/events'", 'optional', 'visitor/member', 'public-list+viewer-personalization'],
  ['pages/coop/list/index.js', "url: '/api/official/merchant-invites'", 'required', 'merchant', 'self-merchant'],
  ['pages/activity/list/index.js', "url: '/api/official/can-publish'", 'required', 'publisher', 'self-capability'],
  ['pages/activity/list/index.js', "url: '/api/official/events'", 'optional', 'visitor/member', 'public-list+viewer-personalization'],
  ['pages/activity/list/index.js', "url: '/api/official/my-events'", 'required', 'member', 'self-registration'],
  ['pages/activity/official-mine/index.js', "url: '/api/official/my-published'", 'required', 'publisher', 'self-publisher'],
  ['pages/activity/official-detail/index.js', "url: '/api/official/events/' + id", 'optional', 'visitor/member', 'public-detail+viewer-personalization'],
  ['pages/searchmap/index.js', "url: '/api/city/nodes'", 'required', 'member', 'global-read+viewer-personalization'],
  ['components/cy/scene-roam-poi-detail/index.js', "url: '/api/city/nodes/' + this.data.poiId", 'required', 'member', 'global-read+viewer-personalization'],
  ['utils/game-session-client.js', "url: '/api/game/session/view'", 'required', 'player/merchant/club', 'activity-perspective-access'],
  ['utils/game-session-client.js', "url: '/api/game/session/merchant/entries'", 'required', 'merchant', 'self-merchant-game-entry'],
  /* 2026-09-11 本分支新增:承接页的「本站」入口自己也要按 topicId 过滤一遍本商家的场次
     —— 与上面 game-session-client 那处同一个端点、同一套权限(required/merchant),
     区别只是调用方。后端按当前登录商家派生 activityId,前端不传也不能传别人的。 */
  ['pages/topic/merchantinfo/merchantinfo.js', "url: '/api/game/session/merchant/entries'", 'required', 'merchant', 'self-merchant-game-entry'],
  /* 2026-09-24 CU-C-68:开「更多」抽屉时用**同一端点**预探一次「本人是否承接了本站」,
     没入口就把那四行置灰(原来主办方账号点下去只会得到「当前商家不负责本场站点」)。
     权限档与上面那条逐字相同(required/merchant,后端按登录商家派生),只是第二个调用点;
     marker 带上 silentError 让两条各自可定位。 */
  ['pages/topic/merchantinfo/merchantinfo.js', "url: '/api/game/session/merchant/entries', method: 'GET', hideLoading: true, silentError: true", 'required', 'merchant', 'self-merchant-game-entry'],
  ['utils/game-session-client.js', "url: '/api/game/session/recap/export'", 'required', 'club', 'club-owned-activity'],
  ['utils/game-session-client.js', "url: '/api/game/session/receipt'", 'required', 'player/merchant/club', 'activity-perspective-access'],
  ['pages/play/index.js', "req('/api/play/nodes'", 'required', 'member', 'current-session'],
  /* 2026-09-18 R14/故事变量:profile 提交成功后的补拉 —— 与首屏同端点同权限档,只是第二处调用点。
     行尾「// 补拉」让 marker 唯一,不然两条都会 resolve 到首屏那一处。 */
  ['pages/play/index.js', "req('/api/play/nodes', 'GET', this._sessionParams()).then((res) => { // 补拉", 'required', 'member', 'current-session'],
  /* 2026-09-18 R14 旅程检定:节点卡打开时探测这一拍有没有检定。后端 ApiPlayEncounterController
     currentMemberId()<=0 直接拒,resolve(memberId, topicId, nodeId) 读的是本人这一局的 run —— 与 /api/play/nodes 同档。 */
  ['pages/play/index.js', "req('/api/play/encounter'", 'required', 'member', 'current-session'],
  // unknown 回执的权威回读：与 play/index 同一接口、同一 session 参数，权限档位一致。
  ['pages/play/merchant/index.js', "url: '/api/play/nodes'", 'required', 'member', 'current-session'],
  ['pages/play/index.js', "req('/api/play/route-state'", 'required', 'member', 'current-session'],
  ['pages/play/index.js', "req('/api/club/lead/team-progress'", 'required', 'leader/paid-member', 'activity-lead-access'],
  ['pages/play/index.js', "req('/api/play/companionLine'", 'required', 'member', 'current-session'],
  ['pages/play/index.js', "req('/api/play/preference/' + nodeId", 'required', 'member', 'current-session'],
  ['pages/play/index.js', "req('/api/play/ending'", 'required', 'member', 'current-session'],
  ['pages/play/index.js', "req('/api/play/leaderboard'", 'required', 'member', 'current-session'],
  ['pages/play/index.js', "req('/api/play/os/' + this.data.topicId", 'required', 'member', 'self-member-history'],
  // 2026-09-05 漫游·附近的局:走默认认证(后端 anyRequest().authenticated()),viewer 视角决定 isMember 与拉黑过滤。
  //   (原文写「两条 GET」——另一条 /api/roam/hangout/detail 同日随组局下线撤走,这里只剩 nearby 一条。)
  ['subpackageRoam/nearby/index.js', "url: '/api/roam/hangout/nearby'", 'required', 'member', 'global-authenticated-read'],
  // 2026-09-17 第二轮拍板 22:首页「继续游戏」只列本人仍可继续的游戏会话(服务端按 uid 取,不收 memberId 参数)。
  ['pages/index/index.js', "url: '/api/play/run-session/list'", 'required', 'member', 'self-registration'],
  // 2026-09-17 第二轮拍板 17:朋友分享的足迹快照,未登录可读;只凭随机 32 位令牌取已裁剪/平移的快照,不带分享者身份。
  ['utils/roam-share-snapshot.js', "url: '/api/roam/share/snapshot', method: 'GET'", 'optional', 'visitor/member', 'share-token-snapshot'],
  // 2026-09-15 地图组队 P 方案:附近公开队伍。ApiPlayTeamController#nearby 走 getAppUserId 未登录即拒;viewerStatus/pendingCount 按 viewer 算。
  // (同日下线组局的 /api/roam/pois 与 /api/roam/hangout/detail 两条 GET:地图上不再有局卡与打卡点列表。
  //  同日撤掉漫游地图 f-hangout 一档:roam 不再调 /api/roam/hangout/nearby,搭子局已下线,该卡整卡退场。)
  ['subpackageRoam/nearby/index.js', "url: '/api/team/nearby'", 'required', 'member', 'global-authenticated-read'],
  ['pages/roam/index.js', "req('/api/ai/npc/profile'", 'required', 'member', 'global-authenticated-read'],
  ['pages/roam/index.js', "req('/api/ai/npc/event'", 'required', 'member', 'global-authenticated-read'],
  ['pages/roam/index.js', "req('/api/roam/tiles/page'", 'required', 'member', 'self-member-history'],
  // 8b0871d2e 漫游恢复核对:后端 ApiRoamController#session 未登录即拒,RoamRecoveryService.read 只按 uid 查本人会话
  ['pages/roam/index.js', "req('/api/roam/session'", 'required', 'member', 'self-member-history'],
  ['pages/roam/index.js', "req('/api/roam/pois'", 'required', 'member', 'global-read+viewer-personalization'],
  ['pages/roam/index.js', "req('/api/official/events/' + eventId", 'optional', 'visitor/member', 'public-detail+viewer-personalization'],
  ['pages/roam/index.js', "req('/api/roam/nearby-exploreday'", 'required', 'member', 'global-authenticated-read'],
  ['pages/roam/index.js', "req('/api/roam/entry/nearby'", 'required', 'member', 'global-authenticated-read'],
  ['pages/roam/index.js', "req('/api/team/nearby'", 'required', 'member', 'global-authenticated-read'],
  ['pages/roam/index.js', "req('/api/roam/badge/shop-streak'", 'required', 'member', 'global-authenticated-read'],
  ['pages/merchant/customer/index.js', 'loadSavedSegments() {', 'required', 'merchant/merchant:crm:segment', 'self-merchant'],
  ['pages/shezhi/components/marketing-consent/index.js', "url: '/api/merchant/crm/marketing-consents'", 'required', 'member', 'self-marketing-consent'],
  // 2026-09-17 商家营销同意入口(拍板第 40 条 A):与设置页同一端点、同一权限档 ——
  //   GET 只读本人可管理的商家行,失败即不出现(fail-closed),账号身份由后端 principal 定。
  ['utils/marketing-consent-entry.js', "url: '/api/merchant/crm/marketing-consents'", 'required', 'member', 'self-marketing-consent'],
];

const VALID_SCOPES = new Set([
  'self-account', 'public-list+viewer-personalization', 'self-registration',
  'self-party', 'self-merchant', 'self-capability', 'self-publisher',
  'public-detail+viewer-personalization', 'global-read+viewer-personalization',
  'current-session', 'activity-lead-access', 'global-authenticated-read',
  'self-member-history', 'activity-perspective-access',
  'self-merchant-game-entry', 'club-owned-activity',
  'owned-merchant-resource', 'self-marketing-consent',
  'share-token-snapshot',
]);

function productionJsFiles(dir) {
  const out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (['tests', 'node_modules', 'miniprogram_npm'].includes(entry.name)) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...productionJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  });
  return out;
}

function registeredCallSource(source, marker, markerAt) {
  const masked = maskJsNonCode(source);
  let callAt;
  let scanEnd = masked.length;
  if (marker.endsWith('() {')) {
    const functionOpenAt = masked.indexOf('{', markerAt);
    assert.ok(functionOpenAt >= 0, `找不到 ${marker} 的函数体`);
    let braceDepth = 0;
    let functionEnd = -1;
    for (let i = functionOpenAt; i < masked.length; i += 1) {
      if (masked[i] === '{') braceDepth += 1;
      else if (masked[i] === '}') {
        braceDepth -= 1;
        if (braceDepth === 0) {
          functionEnd = i;
          break;
        }
      }
    }
    assert.ok(functionEnd >= 0, `${marker} 的函数体没有闭合`);
    scanEnd = functionEnd;
    callAt = masked.indexOf('sendRequest(', markerAt);
    if (callAt >= scanEnd) callAt = -1;
  }
  else if (/^(?:sendUiStateRequest|req)\(/.test(marker)) callAt = markerAt;
  else callAt = masked.lastIndexOf('sendRequest(', markerAt);
  assert.ok(callAt >= 0, `找不到 ${marker} 所属请求调用`);

  const openAt = masked.indexOf('(', callAt);
  let depth = 0;
  for (let i = openAt; i < scanEnd; i += 1) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(callAt, i + 1);
    }
  }
  assert.fail(`${marker} 所属请求调用没有闭合`);
}

test('GET 矩阵窗口覆盖完整当前调用且不跨到下一请求', () => {
  const afterSuccess = `loadItems() {
    app.sendRequest({ method: 'GET', success() {}, auth: false });
  },
  loadNext() { app.sendRequest({ url: '/api/next', method: 'POST', success() {} }); }`;
  const current = registeredCallSource(afterSuccess, 'loadItems() {', afterSuccess.indexOf('loadItems() {'));
  assert.match(current, /auth\s*:\s*false/, 'success 后的 auth:false 也必须留在当前调用窗口');
  assert.throws(() => assert.doesNotMatch(current, /auth\s*:\s*false/),
    '把 success 后的 auth:false 放进真实门禁断言时必须判红');
  assert.doesNotMatch(current, /\/api\/next/, '当前调用窗口不得跨进下一请求');

  const withoutSuccess = `loadItems() {
    app.sendRequest({ method: 'POST', fail() {} });
  },
  loadNext() { app.sendRequest({ url: '/api/next', method: 'GET', success() {} }); }`;
  const noSuccessCall = registeredCallSource(withoutSuccess, 'loadItems() {', withoutSuccess.indexOf('loadItems() {'));
  assert.match(noSuccessCall, /fail\(\)/);
  assert.throws(() => assert.match(noSuccessCall, /['"]GET['"]/),
    '当前 POST 没有 success 时不得借下一请求的 GET 假绿');
  assert.doesNotMatch(noSuccessCall, /\/api\/next/, '当前请求没有 success 时也不得借下一请求过门禁');

  const withoutCurrentRequest = `loadItems() {
    this.setData({ loading: false });
  },
  loadNext() { app.sendRequest({ url: '/api/next', method: 'GET', success() {} }); }`;
  assert.throws(
    () => registeredCallSource(
      withoutCurrentRequest,
      'loadItems() {',
      withoutCurrentRequest.indexOf('loadItems() {')
    ),
    /找不到 .* 所属请求调用/,
    '当前函数没有请求时必须判红，不能借下一函数的 GET 假绿'
  );
});

test('全部 GET 调用点都有 URL + method + auth/角色/scope 分类，新增调用必须先入矩阵', () => {
  let directCount = 0;
  let wrapperCount = 0;
  productionJsFiles(XCX_ROOT).forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    directCount += (source.match(/method\s*:\s*['"]GET['"]/g) || []).length;
    wrapperCount += (source.match(/\breq\([\s\S]{0,180}?,\s*['"]GET['"]\s*,/g) || []).length;
  });
  // 2026-09-15 合拢收尾:漫游页 f-hangout 死卡退场,roam 少一条 /api/roam/hangout/nearby GET,28 → 27。
  // 2026-09-17 第二轮拍板 17/22:首页 run-session/list + 足迹分享快照读取,27 → 29。
  // 2026-09-17 商家营销同意入口(拍板第 40 条 A):utils/marketing-consent-entry.js 新增一条
  //   GET /api/merchant/crm/marketing-consents(与设置页同一端点/同一权限档),27 → 28。
  // 2026-09-17 发布版本 release-0917 再合 fix-consent:合并树 29(续玩 list + 足迹快照)+ 营销同意 GET 1 ⇒ 30(测试实跑实测)。
  // 2026-09-18 R14/故事变量:pages/play 新增两处 req 包装 GET —— encounter 探测一条、
  //   profile 提交后补拉 nodes 一条(wrapper 16 → 18);端点权限档与既有 /api/play/nodes 相同。
  // 2026-09-24 CU-C-68:merchantinfo 新增第二处 /api/game/session/merchant/entries GET
  //   (抽屉资格预探,权限档与上一处相同:required/merchant)⇒ 30 → 31。
  // 客户页退役触达：移除券候选、任务列表、任务详情三处 GET，31 → 28。
  assert.equal(directCount, 28, '直接 GET 数量变化时必须逐条复核权限并更新矩阵');
  assert.equal(wrapperCount, 20, 'req 包装 GET 数量变化时必须逐条复核权限并更新矩阵');
  assert.equal(MATRIX.length, directCount + wrapperCount);

  MATRIX.forEach(([file, marker, mode, role, scope]) => {
    const source = fs.readFileSync(path.join(XCX_ROOT, file), 'utf8');
    const at = source.indexOf(marker);
    assert.notEqual(at, -1, `${file} 缺少已登记 GET: ${marker}`);
    const call = registeredCallSource(source, marker, at);
    assert.match(call, /['"]GET['"]/, `${file} 的 ${marker} method 已漂移`);
    assert.doesNotMatch(call, /auth\s*:\s*false/, `${file} 的 ${marker} 不能降为匿名请求`);
    assert.ok(mode === 'required' || mode === 'optional');
    assert.ok(role.length > 0, `${file} 的 ${marker} 缺角色分类`);
    assert.ok(VALID_SCOPES.has(scope), `${file} 的 ${marker} scope 未进入受控枚举: ${scope}`);
  });
});

test('后端权限真源：仅 official events GET 可匿名，city nodes 仍归 authenticated', () => {
  const security = fs.readFileSync(SECURITY, 'utf8');
  assert.match(
    security,
    /HttpMethod\.GET,\s*"\/api\/official\/events",\s*"\/api\/official\/events\/\*"\)\.permitAll\(\)/
  );
  assert.doesNotMatch(security, /antMatchers\([^\n]*"\/api\/city\/nodes/);
  // 第二轮拍板 17:足迹分享快照只放行精确 GET 一条,写入/作废与同前缀其它路径仍需登录。
  assert.match(security, /HttpMethod\.GET,\s*"\/api\/roam\/share\/snapshot"\)\.permitAll\(\)/);
  assert.doesNotMatch(security, /"\/api\/roam\/share\/\*\*?"/);
  assert.match(security, /\.anyRequest\(\)\.authenticated\(\)/);
});

test('team-progress 后端必须同时校验登录身份与本场资源归属', () => {
  const controller = fs.readFileSync(CLUB_LEAD_CONTROLLER, 'utf8');
  const method = controller.slice(controller.indexOf('@GetMapping("/team-progress")'), controller.indexOf('@PostMapping("/settle")'));
  const ownership = controller.slice(controller.indexOf('private boolean canAccessLeadActivity'), controller.indexOf('@PostMapping("/settle")'));

  assert.match(method, /Long memberId = uid\(\)/);
  assert.match(method, /canAccessLeadActivity\(activityId, memberId, st\)/);
  assert.match(ownership, /memberId\.equals\(state\.getLeaderMemberId\(\)\)/);
  assert.match(ownership, /probe\.setOwnerId\(activityId\)/);
  assert.match(ownership, /probe\.setMemberId\(memberId\)/);
  assert.match(ownership, /probe\.setPaymentStatus\(2\)/);
  assert.match(ownership, /probe\.setRegistrationStatus\(2\)/);
});

test('偏好题组与新生活 OS GET 都绑定当前会员及其游玩/完成事实', () => {
  const controller = fs.readFileSync(PLAY_PROGRESS_CONTROLLER, 'utf8');
  const preference = controller.slice(
    controller.indexOf('@GetMapping("/preference/{nodeId}")'),
    controller.indexOf('@PostMapping("/preference/{nodeId}/submit")')
  );
  const resolver = controller.slice(
    controller.indexOf('private PreferencePlayCtx resolvePreferencePlayCtx'),
    controller.indexOf('private static final class PreferencePlayCtx')
  );
  const operatingSystem = controller.slice(
    controller.indexOf('@GetMapping("/os/{topicId}")'),
    controller.indexOf('private PreferencePlayCtx resolvePreferencePlayCtx')
  );

  assert.match(preference, /Long memberId = currentMemberId\(\)/);
  assert.match(preference, /resolvePreferencePlayCtx\(memberId, nodeId, activityId, topicId, null\)/);
  assert.match(resolver, /resolveCtx\(memberId, activityId, topicId, out\.node\)/);
  assert.match(resolver, /unlockGateError\(memberId, out\.playCtx\.actId, out\.node\)/);
  assert.match(operatingSystem, /Long memberId = currentMemberId\(\)/);
  assert.match(operatingSystem, /operatingSystem\(memberId, topicId\)/);
});

test('排行榜 GET 绑定当前会员及本场报名支付或自玩通行证', () => {
  const controller = fs.readFileSync(PLAY_PROGRESS_CONTROLLER, 'utf8');
  const leaderboard = controller.slice(
    controller.indexOf('@GetMapping("/leaderboard")'),
    controller.indexOf('@Operation(summary = "我的成长+徽章")')
  );

  assert.match(leaderboard, /Long memberId = currentMemberId\(\)/);
  assert.match(leaderboard, /if \(memberId <= 0\) return error\("请先登录"\)/);
  assert.match(leaderboard, /if \(!isRegistered\(memberId, actId\)\) return error\("请先报名并完成支付"\)/);
  assert.match(leaderboard, /validSelfPlayPass\(memberId, tId\) == null/);
  assert.match(leaderboard, /return new AjaxResult\(402, "请先购买自玩通行证"\)/);
});

test('roam GET scope 与后端资源模型一致：tiles 是 member-owned，pois 是全局读取+本人 found 投影', () => {
  const controller = fs.readFileSync(ROAM_CONTROLLER, 'utf8');
  const pois = controller.slice(controller.indexOf('@GetMapping("/pois")'), controller.indexOf('@GetMapping("/nearby-exploreday")'));
  const tiles = controller.slice(controller.indexOf('@GetMapping("/tiles")'), controller.indexOf('@PostMapping("/reveal")'));
  const scopeOf = (marker) => MATRIX.find((row) => row[1] === marker)[4];

  // C-13(2026-09-17):/pois 仍是全局据点列表(不按会员筛资源),只是多带一列「本账号是否已发现」(found)
  // —— 与 /api/city/nodes 同档的 global-read+viewer-personalization;uid 只喂投影,未登录(uid=0)全列 false。
  assert.equal(scopeOf("req('/api/roam/pois'"), 'global-read+viewer-personalization');
  assert.match(pois, /selectPoisNear\([^;]*uid\(\)/);
  assert.equal(scopeOf("req('/api/roam/tiles/page'"), 'self-member-history');
  assert.match(tiles, /Long memberId = uid\(\)/);
  assert.match(tiles, /selectTilesByMember\(memberId,/);
  assert.match(tiles, /selectTilePageByMember\(memberId, cursor, pageSize \+ 1\)/);
});
