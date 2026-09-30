const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decideMerchantGate, decideClubGate } = require('../../utils/access-gate.js');

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const { PERMISSIONS, roleName } = require('../../utils/merchant-access-policy.js');
const ROLE = 'MERCHANT_OWNER';
const merchantOk = (perms) => ({ code: 200, data: { active: true, merchant: { id: 1, name: '河畔咖啡' }, roleCode: ROLE, permissions: perms } });

test('商家守卫:非成员/缺权限 → deny;有权限 → allow;响应坏了 → unknown(不拦,后端仍拦)', () => {
  assert.equal(decideMerchantGate({ code: 200, data: { active: false } }, 'canReadFinance').state, 'deny');
  assert.equal(decideMerchantGate(merchantOk([PERMISSIONS.BASIC_READ]), 'canReadFinance').state, 'deny', '没有 finance 权限');
  assert.equal(decideMerchantGate(merchantOk([PERMISSIONS.BASIC_READ]), '').state, 'allow', '不指定权限 = 只要是商家成员');
  assert.equal(decideMerchantGate({ code: 500, msg: 'boom' }, 'canReadFinance').state, 'unknown');
  assert.equal(decideMerchantGate(null, 'canReadFinance').state, 'unknown');
  assert.equal(decideMerchantGate({ code: 403 }, 'canReadFinance').state, 'deny', '后端明确 403 才算没权限');
  assert.equal(decideMerchantGate({ code: 401 }, 'canReadFinance').state, 'deny', '401 也算明确表态');
});

test('俱乐部守卫:active 非布尔 → unknown;范围不符 / 缺权限 → deny;命中 → allow', () => {
  const ok = (extra) => ({ code: 200, data: Object.assign({ active: true, club: { id: 7, name: 'x' }, permissions: ['club:read', 'club:finance:read'] }, extra) });
  assert.equal(decideClubGate({ code: 200, data: { club: { id: 7 } } }, 7, 'club:read').state, 'unknown', '没表态是坏响应,不能栽成没权限');
  assert.equal(decideClubGate({ code: 200, data: { active: false } }, 7, 'club:read').state, 'deny');
  assert.equal(decideClubGate(ok({}), 8, 'club:read').state, 'deny', '不在这个俱乐部');
  assert.equal(decideClubGate(ok({}), '7', 'club:member:approve').state, 'deny', '缺权限');
  assert.equal(decideClubGate(ok({}), '7', 'club:finance:read').state, 'allow');
  assert.equal(decideClubGate(ok({}), '', 'club:read').state, 'allow', '没给 clubId 时不核范围(按 activityId 查的场景)');
  assert.equal(decideClubGate({ code: 500 }, 7, 'club:read').state, 'unknown');
});

test('守卫组件:deny 才整屏盖住,盖层用 modal 档 z 与页面底色,盖层内零按钮 fail 半屏 2s 自动 onExit', () => {
  const wxml = read('components/cy/access-gate/index.wxml');
  assert.match(wxml, /wx:if="\{\{state === 'deny'\}\}"/);
  // 2026-09-15 弹窗合同(稿 356-5220):无权限是终态,不给按钮,原因展示 2s 后自己出去
  assert.match(wxml, /<cy-result-sheet [^>]*kind="fail"[^>]*why="[^"]+"[^>]*bind:close="onExit"/);
  assert.doesNotMatch(wxml, /primary-text=/, '有按钮就不自愈,会把人卡在盖层上');
  const wxss = read('components/cy/access-gate/index.wxss');
  assert.match(wxss, /position: fixed;[\s\S]*z-index: var\(--cy-z-modal\);[\s\S]*background: var\(--cy-color-bg-page\)/);
  const js = read('components/cy/access-gate/index.js');
  assert.equal((js.match(/hideLoading: true,\s*\n\s*autoErrorToast: false/g) || []).length, 2, '两条分支都不许再弹 toast');
  assert.doesNotMatch(js, /silentError: true/, 'fail 已挂,silentError 是冗余的静默开关');
  assert.match(js, /Number\(statusCode\) === 401/, '401 必须拦并给去处,不能落进 unknown');
  assert.match(js, /url: '\/api\/club\/access\/me'/);
  assert.match(js, /url: '\/api\/merchant\/access\/me'/);
});

test('商家页 / 俱乐部主理人页:要么自己读 access/me,要么挂 cy-access-gate,不许裸奔', () => {
  const walk = (dir, out) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { if (name !== 'components') walk(full, out); }
      else if (name.endsWith('.json')) out.push(full);
    }
    return out;
  };
  const pages = ['pages/merchant', 'pages/coop'].flatMap((d) => walk(path.join(root, d), []))
    .map((j) => j.replace(/\.json$/, ''))
    .filter((p) => fs.existsSync(p + '.js') && fs.existsSync(p + '.wxml') && !JSON.parse(fs.readFileSync(p + '.json', 'utf8')).component);
  const CLUB_OWNER_PAGES = ['pages/club/edit/index', 'pages/club/join-requests/index', 'pages/club/customers/index', 'pages/club/customer-detail/index', 'pages/club/settlement/index', 'pages/club/group-code/index'].map((p) => path.join(root, p));
  // 豁免必须写理由:不写理由的豁免下次没人敢删,等于永久放行。
  const EXEMPT = {
    'pages/merchant/apply/index': '申请入驻:此时还不是商家成员,守卫无从谈起',
    'pages/coop/list/index': '协作邀请收发件箱:/api/coop/list 与 /api/coop/pool/received·mine 都服务俱乐部主理人,商家守卫比后端严会锁住主理人',
    'pages/coop/invite-detail/index': 'E-01(2026-09-16):/api/coop/list·/handle(to_type=club 的群主可接受/拒绝/取消)·/contact·/perks/attach·/review/save 都不要求商家行(ApiCoopController:1215-1250 / :399-418 / :738-763 / :896-925),挂 merchant 守卫会把主理人锁在协作执行页外',
    'pages/coop/invite/index': 'E-01(2026-09-16):type0 达人→商家后端明确放行无商家行 talent(ApiCoopController:267-285),只有 type1 要商家;页面级 merchant 守卫比后端严',
    'pages/coop/nearby/index': 'E-01(2026-09-16):/api/merchant/nearby 登录即可、/api/merchant/chapter-application/invitable 只要求主题发布者(scope 非 MERCHANT 时 principalMemberId 放行),都不要求商家行',
    'pages/coop/finance/index': 'E-01(2026-09-16):/api/coop/finance 只按登录人取数(ApiCoopController:926-934),不要求商家行',
    'pages/club/workbench/index': '纯重定向壳:onLoad 立即 redirectTo 俱乐部详情,自身不渲染内容',
    'subpackageA/pages/assetcenter/income-detail/income-detail': '纯重定向壳:跳 earnings',
    'subpackageA/pages/assetcenter/earnings/index': '用户自己的收益页(/api/user/info 按 token 自限),不是商家岗位权限范畴',
    'pages/club/topic-story/index': '面向参与者的剧情只读页,没有俱乐部范围参数可核;后端按主题可见性拦',
    'pages/merchant/profile/index': '4-04 旧商家主页兼容壳:只做「旧链接 → 统一主页」的公开重定向(/api/merchant/public-home 匿名可读),挂商家门禁会让玩家在重定向前被盖屏',
    'pages/club/group-code/index': '只带 activityId,后端 resolve(clubId=null) 必返 403 —— 挂守卫等于对所有人含主理人恒锁',
  };
  const naked = [];
  for (const p of pages.concat(CLUB_OWNER_PAGES)) {
    const rel = path.relative(root, p);
    if (EXEMPT[rel]) continue;
    const js = fs.readFileSync(p + '.js', 'utf8');
    const wxml = fs.readFileSync(p + '.wxml', 'utf8');
    if (!/access\/me/.test(js) && !/<cy-access-gate /.test(wxml)) naked.push(rel);
  }
  assert.deepEqual(naked, []);
  assert.ok(pages.length >= 20, '商家页扫描范围异常:' + pages.length);
  for (const [rel, why] of Object.entries(EXEMPT)) {
    assert.ok(why && why.length >= 8, rel + ' 的豁免必须写清理由');
    assert.ok(fs.existsSync(path.join(root, rel + '.js')), '豁免名单里的页已不存在,该删:' + rel);
  }
});

// 2026-09-06 复审抓到:两页 wxml 绑了 club-id="{{clubId}}",js 却从没把它放进 data ——
// 组件 check() 一进来就早退,守卫永远停在 checking(渲染不出来),而「标签存在」的断言照样绿。
// 这就是本仓最高频的假保证形态,所以这条契约核的是「绑定的键真的被喂过」。
test('俱乐部守卫绑定的 id 必须真的进 data,不许是死闸', () => {
  const walk = (dir, out) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full, out);
      else if (name.endsWith('.wxml')) out.push(full);
    }
    return out;
  };
  const dead = [];
  for (const wxmlPath of walk(path.join(root, 'pages'), [])) {
    const wxml = fs.readFileSync(wxmlPath, 'utf8');
    const bind = wxml.match(/(?:club-id|activity-id)="\{\{([a-zA-Z_$][\w$]*)\}\}"/);
    if (!bind) continue;
    const jsPath = wxmlPath.replace(/\.wxml$/, '.js');
    if (!fs.existsSync(jsPath)) continue;
    const js = fs.readFileSync(jsPath, 'utf8');
    const key = bind[1];
    const inData = new RegExp('data:\\s*\\{[^}]*(?<![\\w.])' + key + '\\s*:', 's').test(js);
    const inSetData = new RegExp('setData\\(\\s*\\{[^)]*?(?<![\\w.])' + key + '\\s*[,:}]', 's').test(js);
    if (!inData && !inSetData) dead.push(path.relative(root, wxmlPath) + ' 绑了 ' + key + ',js 从没喂过');
  }
  assert.deepEqual(dead, []);
});

// 2026-09-06 复审实测:按页面名猜权限,4 处比后端更严 —— 会把有权限的岗位锁在页外,比不设守卫更糟。
// 这条棘轮把「填了 need」限制在已核实清单里:新增页要么留空(只核成员身份),要么带着后端出处进白名单。
// E-01(2026-09-16 P0)第二次同族漏修的直接原因:棘轮只查「有没有挂守卫」,不查「挂的 kind
// 与后端准入是否一致」—— 于是同族 6 页带着比后端严的 merchant 守卫活了很久。
// 这条把 pages/coop 的 kind 逐个钉到后端出处上:改 kind 就必须改这张表并写理由。
// 负控:把 invite-detail/settlement-detail(finance) 的 merchant 守卫加回去,本测试必须红。
test('coop 页守卫的 kind 必须与后端真实准入一致,不许比后端严', () => {
  const COOP_PAGE_GATE = {
    'pages/coop/list/index': { gate: 'none', why: '/api/coop/list 服务无商家行的俱乐部主理人' },
    'pages/coop/invite-detail/index': { gate: 'none', why: '列表/处理/联系/供给/评价对 club 邀约均不要求商家上下文' },
    'pages/coop/invite/index': { gate: 'none', why: 'type0 达人线路后端放行无商家行账号' },
    'pages/coop/nearby/index': { gate: 'none', why: 'nearby 登录即可、invitable 只要求主题发布者' },
    'pages/coop/finance/index': { gate: 'none', why: '/api/coop/finance 按登录人取数' },
    'pages/coop/settlement-detail/index': { gate: 'merchant-if-ledger', why: 'finance/club 线路登录即可;ledger 走 /api/coop/mybiz 才要商家' },
    'pages/coop/withdraw/index': { gate: 'merchant', why: '商家域提现深链壳(涉资,保留岗位守卫)' },
    'pages/coop/withdraw/records/index': { gate: 'merchant', why: '商家域提现记录壳(涉资,保留岗位守卫)' },
  };
  const walk = (dir, out) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { if (name !== 'components') walk(full, out); }
      else if (name.endsWith('.wxml')) out.push(full);
    }
    return out;
  };
  const pages = walk(path.join(root, 'pages/coop'), []);
  const bad = [];
  for (const wxmlPath of pages) {
    const rel = path.relative(root, wxmlPath).replace(/\.wxml$/, '');
    const spec = COOP_PAGE_GATE[rel];
    if (!spec) { bad.push(rel + ' 不在 E-01 守卫表里:新增 coop 页必须带后端出处补表'); continue; }
    const wxml = fs.readFileSync(wxmlPath, 'utf8');
    const gate = wxml.match(/<cy-access-gate[^>]*kind="merchant"/);
    if (!gate) {
      if (spec.gate !== 'none') bad.push(rel + ' 期望 merchant 守卫(' + spec.why + '),实际没挂');
      continue;
    }
    if (spec.gate === 'none') bad.push(rel + ' 挂着比后端严的 merchant 守卫:' + spec.why);
    if (spec.gate === 'merchant-if-ledger') {
      const tag = wxml.match(/<cy-access-gate[^>]*kind="merchant"[^>]*>/)[0];
      // CU-C-41:来源从两档(finance/ledger)变成三档(+club),判据从「不等于 finance」
      // 收紧到「就是 ledger」—— 新来源默认不落商家守卫,不会因漏改而被锁在页外。
      if (!/wx:if="\{\{source === 'ledger'\}\}"/.test(tag)) bad.push(rel + ' ledger 守卫必须只盖 source=ledger:' + spec.why);
    }
    assert.ok(spec.why.length >= 8, rel + ' 的表项必须写清后端出处');
  }
  assert.deepEqual(bad, []);
  // 2026-09-16 候选池页整页删除(收编进协作列表「收到的」),pages/coop 从 9 页降为 8 页,
  // 扫描范围下限同步调小;这是页面退役的事实,不是放宽守卫口径。
  assert.ok(pages.length >= 8, 'coop 页扫描范围异常:' + pages.length);
});

test('商家守卫的 need 只能取已核实过后端出处的值,拿不准必须留空', () => {
  const VERIFIED = {
    'pages/merchant/relation/index': 'canManageCoop',
    'pages/merchant/decor/perks/index': 'canManageCoop',
    'pages/merchant/decor/coop-setting/index': 'canManageCoop',
    // RV(2)(总控 9-18 口径):装修主页同时服务两类岗位 —— 只有 COOP_MANAGE 的运营要能
    // 进合作经营/常备权益,所以整页门禁回到 canManageCoop;资料三视图与保存按钮
    // 在页内按 canWriteProfile 单独收口(见 p4-merchant-write-entry-gate-contract)。
    // gallery 与 ai-npc 仍是纯 PROFILE_WRITE 页(取数/保存只有 /merchant/info、/decor/save、/npc/*)。
    'pages/merchant/decor/gallery/index': 'canWriteProfile',
    'pages/merchant/decor/index': 'canManageCoop',
    'pages/merchant/decor/ai-npc/index': 'canWriteProfile',
    // P4 #17-3:店铺参谋按后端 MARKETING_READ 放行(运营/店长),核销员/财务进不来。
    'pages/merchant/marketing/ai-insight/index': 'canReadMarketing',
    'pages/merchant/ledger/batch-detail/index': 'canReadFinance',
    'pages/merchant/ledger/order-detail/index': 'canReadVerifyRecords',
  };
  const walk = (dir, out) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full, out);
      else if (name.endsWith('.wxml')) out.push(full);
    }
    return out;
  };
  const bad = [];
  for (const wxmlPath of walk(path.join(root, 'pages'), [])) {
    const wxml = fs.readFileSync(wxmlPath, 'utf8');
    const m = wxml.match(/<cy-access-gate[^>]*kind="merchant"[^>]*need="([^"]*)"/);
    if (!m) continue;
    const rel = path.relative(root, wxmlPath).replace(/\.wxml$/, '');
    const want = VERIFIED[rel] || '';
    if (m[1] !== want) bad.push(rel + ' need=' + JSON.stringify(m[1]) + ',应为 ' + JSON.stringify(want));
  }
  assert.deepEqual(bad, []);
});
