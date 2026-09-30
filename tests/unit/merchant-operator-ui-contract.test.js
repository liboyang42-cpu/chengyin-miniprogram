const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('../helpers/ui-sandbox-vm.js'); // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const accessPolicy = require('../../utils/merchant-access-policy');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function mountTeamPage(storage = {}, options = {}) {
  let definition;
  const requests = [];
  const toasts = [];
  let memberId = Object.prototype.hasOwnProperty.call(options, 'memberId') ? options.memberId : 'member-7';
  const app = {
    globalData: options.globalData || { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => memberId,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    // 静默登录成功等价于 session-store 落地(真实 session-manager 会写 user_id)。
    getSessionManager: () => ({
      ensureSession: () => {
        if (!memberId) memberId = 'member-7';
        return Promise.resolve({ ok: true });
      },
    }),
    sendRequest(options) { requests.push(options); },
  };
  const wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: key => { delete storage[key]; },
    showToast: options => toasts.push(options.title),
    switchTab: options => switches.push(options.url),
  };
  const switches = [];
  vm.runInNewContext(options.source || read('pages/merchant/team/index.js'), {
    Page: value => { definition = value; },
    getApp: () => app,
    require: request => {
      if (request.includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (request.includes('response-shape')) {
        return {
          isRecord: value => !!value && typeof value === 'object' && !Array.isArray(value),
          isRecordList: Array.isArray,
        };
      }
      if (request.includes('merchant-access-policy')) {
        return {
          inactiveAccess: () => ({ active: false }),
          normalizeMerchantAccess: value => value,
          roleName: code => code,
        };
      }
      if (request.includes('ensure-session')) {
        return {
          ensureSession: target => Promise.resolve(target.getSessionManager().ensureSession())
            .then(result => !!(result && result.ok)),
        };
      }
      throw new Error(`unexpected require: ${request}`);
    },
    wx,
    Date,
    Math,
    JSON,
    encodeURIComponent,
  });
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function setData(patch) { Object.assign(this.data, patch); };
  return { page, requests, toasts, storage, switches };
}

test('商家岗位权限只认服务端白名单，未知或脏访问上下文关闭全部经营入口', () => {
  const owner = accessPolicy.normalizeMerchantAccess({
    active: true,
    merchant: { id: 7, name: '测试门店', logo: '/logo.png' },
    roleCode: 'MERCHANT_OWNER',
    permissions: [
      'merchant:verify',
      'merchant:finance:read',
      'merchant:operator:manage',
      'merchant:made-up:permission',
      42,
    ],
  });

  assert.equal(owner.active, true);
  assert.equal(owner.canVerify, true);
  assert.equal(owner.canReadFinance, true);
  assert.equal(owner.canManageOperators, true);
  assert.equal(accessPolicy.hasPermission(owner, 'merchant:made-up:permission'), false,
    '前端不得把后端意外下发的新字符串自动升级成可用权限');

  const dirty = accessPolicy.normalizeMerchantAccess({
    active: true,
    merchant: { id: null, name: '缺主键' },
    roleCode: 'MERCHANT_OWNER',
    permissions: ['merchant:operator:manage'],
  });
  assert.equal(dirty.active, false);
  assert.equal(dirty.canManageOperators, false);
  assert.deepEqual(dirty.permissions, []);

  for (const roleCode of ['constructor', 'toString', '__proto__']) {
    const prototypeRole = accessPolicy.normalizeMerchantAccess({
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode,
      permissions: ['merchant:finance:read'],
    });
    assert.equal(prototypeRole.active, false, `${roleCode} 不是固定商家岗位`);
    assert.equal(prototypeRole.canReadFinance, false, `${roleCode} 不得继承 Object.prototype 放行财务权限`);
  }

  const stringId = accessPolicy.normalizeMerchantAccess({
    active: true,
    merchant: { id: '8', name: '测试门店' },
    roleCode: 'MERCHANT_FINANCE',
    permissions: ['merchant:finance:read'],
  });
  assert.equal(stringId.active, true, '后端精确十进制字符串 ID 保持兼容');
  assert.equal(stringId.canReadFinance, true);

  for (const id of [true, [8], 1.5, '1.5', '08', {}, 0, -1, '']) {
    const invalidId = accessPolicy.normalizeMerchantAccess({
      active: true,
      merchant: { id, name: '测试门店' },
      roleCode: 'MERCHANT_FINANCE',
      permissions: ['merchant:finance:read'],
    });
    assert.equal(invalidId.active, false, `${JSON.stringify(id)} 不是合法商家主体 ID`);
    assert.equal(invalidId.canReadFinance, false, `${JSON.stringify(id)} 不得取得财务权限`);
  }
});

test('核销员、运营、财务的工作台入口按权限拆开，不由全局 merchant 角色放大', () => {
  const checkin = accessPolicy.normalizeMerchantAccess({
    active: true,
    merchant: { id: 8, name: '门店' },
    roleCode: 'MERCHANT_CHECKIN',
    permissions: ['merchant:basic:read', 'merchant:verify', 'merchant:verify:record:read'],
  });
  assert.equal(checkin.canVerify, true);
  assert.equal(checkin.canReadCrm, false);
  assert.equal(checkin.canReadFinance, false);
  assert.equal(checkin.canManageProjects, false);

  const marketing = accessPolicy.normalizeMerchantAccess({
    active: true,
    merchant: { id: 8, name: '门店' },
    roleCode: 'MERCHANT_MARKETING',
    permissions: ['merchant:basic:read', 'merchant:crm:read', 'merchant:marketing:write'],
  });
  assert.equal(marketing.canVerify, false);
  assert.equal(marketing.canReadCrm, true);
  assert.equal(marketing.canWriteMarketing, true);

  const finance = accessPolicy.normalizeMerchantAccess({
    active: true,
    merchant: { id: 8, name: '门店' },
    roleCode: 'MERCHANT_FINANCE',
    permissions: ['merchant:basic:read', 'merchant:finance:read'],
  });
  assert.equal(finance.canReadFinance, true);
  assert.equal(finance.canExportFinance, undefined, '安全导出链未落地前前端不得投影伪能力');
  assert.equal(accessPolicy.PERMISSIONS.FINANCE_EXPORT, undefined);
  assert.equal(finance.canWriteProfile, false);
});

test('经营团队页已注册，并覆盖邀请、接受、改岗、移除和撤销接口', () => {
  const appJson = JSON.parse(read('app.json'));
  const merchantPackage = appJson.subPackages.find((item) => item.root === 'pages/merchant');
  assert.ok(merchantPackage && merchantPackage.pages.includes('team/index'));

  const js = read('pages/merchant/team/index.js');
  [
    '/api/merchant/access/me',
    '/api/merchant/operators/roles',
    '/api/merchant/operators/list',
    '/api/merchant/operators/invite',
    '/api/merchant/operators/invite/accept',
    '/api/merchant/operators/role',
    '/api/merchant/operators/remove',
    '/api/merchant/operators/invite/revoke',
  ].forEach((url) => assert.ok(js.includes(url), `团队页缺少接口 ${url}`));

  assert.match(js, /onShareAppMessage\s*\(/, '原始邀请 token 必须走微信分享闭环');
  assert.doesNotMatch(js, /(?:setStorageSync|setStorage|console\.(?:log|info|warn|error))[^\n]*(?:token|invite)/i,
    '邀请 token 不得写入缓存或日志');
  assert.doesNotMatch(js, /tokenHash/, '前端不应知道服务端 tokenHash 字段');
});

test('岗位列表业务失败时保留旧岗位并显示可重试的页内错误', () => {
  const mounted = mountTeamPage();
  mounted.page.data.roles = [{ roleCode: 'MERCHANT_CHECKIN', name: '核销员' }];
  mounted.page.loadRoles();
  mounted.requests[0].success({ code: 500, msg: '岗位服务失败' });

  assert.deepEqual(mounted.page.data.roles, [{ roleCode: 'MERCHANT_CHECKIN', name: '核销员' }]);
  assert.equal(mounted.page.data.roleError, '岗位服务失败');
  assert.match(read('pages/merchant/team/index.wxml'),
    /roleError[\s\S]*action="重试"[\s\S]*bind:action="loadRoles"/);
});

test('岗位列表只接受最后一次请求结果', () => {
  const mounted = mountTeamPage();
  mounted.page.loadRoles();
  const staleRequest = mounted.requests[0];
  mounted.page.loadRoles();
  const freshRequest = mounted.requests[1];

  freshRequest.success({ code: 200, data: [{ roleCode: 'MERCHANT_FINANCE', name: '财务', permissions: [] }] });
  staleRequest.success({ code: 200, data: [{ roleCode: 'MERCHANT_CHECKIN', name: '核销员', permissions: [] }] });
  staleRequest.fail();

  assert.equal(mounted.page.data.roles[0].roleCode, 'MERCHANT_FINANCE');
  assert.equal(mounted.page.data.roleError, '');
});

test('团队名单任一 operator 或 invite 畸形时整批 fail-closed，并保留可信旧名单', () => {
  const operator = {
    id: 17,
    nickname: '核销员甲',
    avatar: '',
    roleCode: 'MERCHANT_CHECKIN',
    status: 'ACTIVE',
    acceptedAt: '2026-08-20T10:00:00.000+08:00',
    version: 0,
  };
  const invite = {
    id: 27,
    roleCode: 'MERCHANT_MARKETING',
    status: 'PENDING',
    expiresAt: '2026-08-27T10:00:00.000+08:00',
    version: 0,
  };
  const malformedPayloads = [
    { operators: [operator, Object.assign({}, operator, { id: null })], invites: [invite] },
    { operators: [Object.assign({}, operator, { roleCode: 'MERCHANT_OWNER' })], invites: [invite] },
    { operators: [operator], invites: [Object.assign({}, invite, { version: true })] },
    { operators: [operator], invites: [Object.assign({}, invite, { expiresAt: 'not-a-date' })] },
  ];

  malformedPayloads.forEach((data) => {
    const mounted = mountTeamPage();
    mounted.page.data.operators = [{ id: 99, nickname: '可信旧员工' }];
    mounted.page.data.pendingInvites = [{ id: 199, roleName: '可信旧邀请' }];
    mounted.page.loadTeam();
    mounted.requests[0].success({ code: 200, data });

    assert.equal(mounted.page.data.teamState, 'error', JSON.stringify(data));
    assert.match(mounted.page.data.teamError, /名单.*异常|加载失败/, JSON.stringify(data));
    assert.deepEqual(mounted.page.data.operators, [{ id: 99, nickname: '可信旧员工' }]);
    assert.deepEqual(mounted.page.data.pendingInvites, [{ id: 199, roleName: '可信旧邀请' }]);
  });
});

// 4-03 阻断#17-6:后端 /operators/roles 会把「店长」下发给岗位选择器
// (ApiMerchantOperatorController:210),MerchantRoleCode.operatorRoles 含 MERCHANT_MANAGER。
// 前端白名单漏了它 ⇒ 店长行被 shapeOperator/shapeInvite 判 null ⇒ 整页「团队名单数据格式异常」,
// 调岗/邀请回执也被判无效,显示成假失败。
test('店长(MERCHANT_MANAGER)与后端 operatorRoles 对齐:名单、邀请、调岗回执都算合法', () => {
  const manager = {
    id: 17,
    nickname: '店长甲',
    avatar: '',
    roleCode: 'MERCHANT_MANAGER',
    status: 'ACTIVE',
    acceptedAt: '2026-08-20T10:00:00.000+08:00',
    version: 0,
  };
  const managerInvite = {
    id: 27,
    roleCode: 'MERCHANT_MANAGER',
    status: 'PENDING',
    expiresAt: '2026-08-27T10:00:00.000+08:00',
    version: 0,
  };

  const mounted = mountTeamPage();
  mounted.page.loadTeam();
  mounted.requests[0].success({ code: 200, data: { operators: [manager], invites: [managerInvite] } });

  assert.equal(mounted.page.data.teamState, 'ready', '店长行不得再让整页报格式异常');
  assert.equal(mounted.page.data.operators.length, 1);
  assert.equal(mounted.page.data.operators[0].roleCode, 'MERCHANT_MANAGER');
  assert.equal(mounted.page.data.pendingInvites.length, 1);
  assert.equal(mounted.page.data.pendingInvites[0].roleCode, 'MERCHANT_MANAGER');

  // 调岗成店长:权威回执必须被认成 EXACT_RESULT,不能显示假失败
  const roleMounted = mountTeamPage();
  roleMounted.page.data.access = { merchant: { id: 7 } };
  roleMounted.page.updateOperatorRole(Object.assign({}, manager, { roleCode: 'MERCHANT_CHECKIN' }), 'MERCHANT_MANAGER');
  roleMounted.requests[0].success({
    code: 200,
    data: {
      id: 17,
      roleCode: 'MERCHANT_MANAGER',
      status: 'ACTIVE',
      version: 1,
      mutationState: 'EXACT_RESULT',
    },
  });
  roleMounted.requests[0].complete();
  assert.equal(roleMounted.toasts.includes('岗位已更新'), true, '调岗成店长的成功回执不得被判无效');
  assert.equal(roleMounted.requests[1].url, '/api/merchant/operators/list', '成功后回读权威名单');

  // 邀请店长:回执同样要认
  const inviteMounted = mountTeamPage();
  inviteMounted.page.data.access = { merchant: { id: 7 } };
  inviteMounted.page.createInvite('MERCHANT_MANAGER');
  inviteMounted.requests[0].success({
    code: 200,
    data: {
      invite: { id: 31, roleCode: 'MERCHANT_MANAGER', expiresAt: '2026-08-25 10:00:00' },
      token: 'safe-share-token-1234567890',
    },
  });
  inviteMounted.requests[0].complete();
  assert.equal(inviteMounted.page.data.canShareCreatedInvite, true, '邀请店长的分享凭证必须被认下');
});

test('4-03 负控:白名单拿掉店长后,店长行必须能把名单契约判红', () => {
  const source = read('pages/merchant/team/index.js');
  const mutated = source.replace(
    "const OPERATOR_ROLES = ['MERCHANT_MANAGER', 'MERCHANT_CHECKIN', 'MERCHANT_MARKETING', 'MERCHANT_FINANCE'];",
    "const OPERATOR_ROLES = ['MERCHANT_CHECKIN', 'MERCHANT_MARKETING', 'MERCHANT_FINANCE'];");
  assert.notEqual(mutated, source, '负控锚点失效');

  const mounted = mountTeamPage({}, { source: mutated });
  mounted.page.loadTeam();
  mounted.requests[0].success({
    code: 200,
    data: {
      operators: [{
        id: 17, nickname: '店长甲', avatar: '', roleCode: 'MERCHANT_MANAGER',
        status: 'ACTIVE', acceptedAt: '2026-08-20T10:00:00.000+08:00', version: 0,
      }],
      invites: [],
    },
  });
  assert.equal(mounted.page.data.teamState, 'error', '变异体确实把店长行丢成了整页异常');
  assert.throws(() => assert.equal(mounted.page.data.teamState, 'ready'));
});

test('创建邀请丢响应后同岗位重试复用 requestId，成功后才开启新意图', () => {
  const storage = {};
  const mounted = mountTeamPage(storage);
  mounted.page.data.access = { merchant: { id: 7 } };
  mounted.page.createInvite('MERCHANT_CHECKIN');
  const first = mounted.requests[0];
  const firstBody = JSON.parse(first.data);
  first.fail();
  first.complete();

  mounted.page.onUnload();
  const reopened = mountTeamPage(storage);
  reopened.page.data.access = { merchant: { id: 7 } };
  reopened.page.createInvite('MERCHANT_CHECKIN');
  const replay = reopened.requests[0];
  assert.equal(JSON.parse(replay.data).requestId, firstBody.requestId,
    '页面退出重开后仍必须重放网络结果未知的创建邀请意图');
  assert.doesNotMatch(JSON.stringify(storage), /safe-share-token/i, '持久层只能保存 requestId，不能保存邀请 token');
  replay.success({
    code: 200,
    data: {
      invite: { id: 31, roleCode: 'MERCHANT_CHECKIN', expiresAt: '2026-08-25 10:00:00' },
      token: 'safe-share-token-1234567890',
    },
  });
  replay.complete();

  reopened.page.createInvite('MERCHANT_CHECKIN');
  const nextInviteRequest = reopened.requests.findLast(item => item.url === '/api/merchant/operators/invite');
  assert.notEqual(JSON.parse(nextInviteRequest.data).requestId, firstBody.requestId,
    '已收到成功回执后才可生成新的邀请意图');
});

test('接受邀请丢响应后重试复用 requestId，不把未知结果改写成新操作', () => {
  const mounted = mountTeamPage();
  mounted.page._incomingInviteToken = 'safe-incoming-token-1234567890';
  mounted.page.acceptIncomingInvite();
  const first = mounted.requests[0];
  const firstBody = JSON.parse(first.data);
  first.fail();
  first.complete();

  mounted.page.acceptIncomingInvite();
  const replay = mounted.requests[1];
  assert.equal(JSON.parse(replay.data).requestId, firstBody.requestId);
});

test('改岗网络结果未知时持久化复用 requestId，收到权威回执后清理并回读名单', () => {
  const storage = {};
  const operator = {
    id: 41,
    nickname: '核销员甲',
    avatar: '',
    roleCode: 'MERCHANT_CHECKIN',
    status: 'ACTIVE',
    acceptedAt: '2026-08-20T10:00:00.000+08:00',
    version: 2,
  };
  const first = mountTeamPage(storage);
  first.page.data.access = { merchant: { id: 7 } };
  first.page.updateOperatorRole(operator, 'MERCHANT_FINANCE');
  const firstRequest = first.requests[0];
  const firstRequestId = JSON.parse(firstRequest.data).requestId;
  firstRequest.fail();
  firstRequest.complete();

  const reopened = mountTeamPage(storage);
  reopened.page.data.access = { merchant: { id: 7 } };
  reopened.page.updateOperatorRole(operator, 'MERCHANT_FINANCE');
  const replay = reopened.requests[0];
  assert.equal(JSON.parse(replay.data).requestId, firstRequestId,
    '重启页面也必须重放同一改岗意图');
  replay.success({
    code: 200,
    data: {
      id: 41,
      roleCode: 'MERCHANT_FINANCE',
      status: 'ACTIVE',
      version: 3,
      mutationState: 'EXACT_RESULT',
    },
  });
  replay.complete();

  assert.equal(reopened.requests[1].url, '/api/merchant/operators/list',
    '改岗成功回执后必须以权威名单回读收口');
  assert.doesNotMatch(JSON.stringify(storage), new RegExp(firstRequestId),
    '成功回执后应清理本次意图');
});

test('改岗重放返回 later authoritative state 时只刷新名单，不假报岗位更新成功', () => {
  const storage = {};
  const operator = {
    id: 41,
    nickname: '核销员甲',
    avatar: '',
    roleCode: 'MERCHANT_CHECKIN',
    status: 'ACTIVE',
    acceptedAt: '2026-08-20T10:00:00.000+08:00',
    version: 2,
  };
  const mounted = mountTeamPage(storage);
  mounted.page.data.access = { merchant: { id: 7 } };
  mounted.page.updateOperatorRole(operator, 'MERCHANT_FINANCE');
  const requestId = JSON.parse(mounted.requests[0].data).requestId;

  mounted.requests[0].success({
    code: 200,
    data: {
      id: 41,
      roleCode: 'MERCHANT_MARKETING',
      status: 'ACTIVE',
      version: 4,
      mutationState: 'LATER_AUTHORITATIVE',
    },
  });
  mounted.requests[0].complete();

  assert.equal(mounted.requests[1].url, '/api/merchant/operators/list');
  assert.equal(mounted.toasts.includes('岗位已更新'), false,
    '后续状态已变化时不得继续显示原操作成功');
  assert.ok(mounted.toasts.some(message => /后续.*变化|最新名单/.test(message)),
    '必须明确告知用户已回读后续状态');
  assert.doesNotMatch(JSON.stringify(storage), new RegExp(requestId),
    'HTTP 200 later authoritative 已给出已知终态，不得留下永久重放意图');
});

test('移除员工返回 later authoritative 时清理 intent 并回读，但不显示移除成功', () => {
  const storage = {};
  const target = {
    id: 41, nickname: '核销员甲', roleCode: 'MERCHANT_CHECKIN', status: 'ACTIVE', version: 3,
  };
  const mounted = mountTeamPage(storage);
  mounted.page.data.access = { merchant: { id: 7 } };
  mounted.page._dangerConfirm = { show: true, type: 'operator', target };
  mounted.page.confirmDanger();
  const requestId = JSON.parse(mounted.requests[0].data).requestId;

  mounted.requests[0].success({
    code: 200,
    data: {
      id: 41,
      roleCode: 'MERCHANT_CHECKIN',
      status: 'REVOKED',
      version: 5,
      mutationState: 'LATER_AUTHORITATIVE',
    },
  });
  mounted.requests[0].complete();

  assert.equal(mounted.requests[1].url, '/api/merchant/operators/list');
  assert.equal(mounted.toasts.includes('成员已移除'), false);
  assert.ok(mounted.toasts.some(message => /后续.*变化|最新名单/.test(message)));
  assert.doesNotMatch(JSON.stringify(storage), new RegExp(requestId));
});

test('移除员工的 5xx 保留同一 requestId，明确 4xx 才清理该意图', () => {
  const storage = {};
  const target = {
    id: 41, nickname: '核销员甲', roleCode: 'MERCHANT_CHECKIN', status: 'ACTIVE', version: 3,
  };
  const mounted = mountTeamPage(storage);
  mounted.page.data.access = { merchant: { id: 7 } };
  mounted.page._dangerConfirm = { show: true, type: 'operator', target };
  mounted.page.confirmDanger();
  const firstRequestId = JSON.parse(mounted.requests[0].data).requestId;
  mounted.requests[0].success({ code: 503, msg: '服务暂不可用' });
  mounted.requests[0].complete();

  mounted.page.confirmDanger();
  assert.equal(JSON.parse(mounted.requests[1].data).requestId, firstRequestId,
    '5xx 不能把结果未知的移除改写成新请求');
  mounted.requests[1].success({ code: 409, msg: '参数与原请求不一致' });
  mounted.requests[1].complete();

  mounted.page.confirmDanger();
  assert.notEqual(JSON.parse(mounted.requests[2].data).requestId, firstRequestId,
    '明确 4xx 后应开启新意图');
});

test('撤销邀请丢响应后复用 requestId，只在 REVOKED 权威回执后清理并回读名单', () => {
  const storage = {};
  const target = { id: 31, roleCode: 'MERCHANT_MARKETING', status: 'PENDING', version: 0 };
  const first = mountTeamPage(storage);
  first.page.data.access = { merchant: { id: 7 } };
  first.page._dangerConfirm = { show: true, type: 'invite', target };
  first.page.confirmDanger();
  const firstRequestId = JSON.parse(first.requests[0].data).requestId;
  first.requests[0].fail();
  first.requests[0].complete();

  const reopened = mountTeamPage(storage);
  reopened.page.data.access = { merchant: { id: 7 } };
  reopened.page._dangerConfirm = { show: true, type: 'invite', target };
  reopened.page.confirmDanger();
  const replay = reopened.requests[0];
  assert.equal(JSON.parse(replay.data).requestId, firstRequestId);
  replay.success({
    code: 200,
    data: {
      id: 31,
      roleCode: 'MERCHANT_MARKETING',
      status: 'REVOKED',
      version: 1,
      mutationState: 'EXACT_RESULT',
    },
  });
  replay.complete();

  assert.equal(reopened.requests[1].url, '/api/merchant/operators/list');
  assert.doesNotMatch(JSON.stringify(storage), new RegExp(firstRequestId));
});

test('匿名打开邀请链接:静默登录后从短 TTL 内存 handoff 恢复邀请,成功或确定性 4xx 后清理且不落盘', async () => {
  const token = 'safe-incoming-token-1234567890';
  const storage = {};
  const globalData = { statusBarHeight: 20, navBarHeight: 44 };
  const anonymous = mountTeamPage(storage, { globalData, memberId: '' });
  anonymous.page.onLoad({ invite: token });
  anonymous.page.onShow();
  await flush();
  assert.equal(anonymous.requests[0].url, '/api/merchant/access/me', '匿名打开必须先静默登录再确认身份');
  anonymous.requests[0].success({
    code: 200,
    data: { active: false, applicationState: 'NONE', permissions: [], merchant: null },
  });
  assert.equal(anonymous.page.data.accessState, 'invite', '有邀请 token 时落邀请落地页');
  assert.doesNotMatch(JSON.stringify(storage), new RegExp(token), 'raw token 不能写入本地持久化');
  anonymous.page.onUnload();

  const reopened = mountTeamPage(storage, { globalData, memberId: 'member-7' });
  reopened.page.onLoad({});
  assert.equal(reopened.page.data.hasIncomingInvite, true, '登录返回后必须从内存 handoff 恢复邀请');
  reopened.page.acceptIncomingInvite();
  assert.equal(JSON.parse(reopened.requests[0].data).token, token);
  reopened.requests[0].fail();
  reopened.requests[0].complete();

  const afterNetworkUnknown = mountTeamPage(storage, { globalData, memberId: 'member-7' });
  afterNetworkUnknown.page.onLoad({});
  assert.equal(afterNetworkUnknown.page.data.hasIncomingInvite, true, '网络结果未知时必须保留 handoff 供幂等重试');
  afterNetworkUnknown.page.acceptIncomingInvite();
  afterNetworkUnknown.requests[0].success({ code: 200, data: { id: 9 } });
  afterNetworkUnknown.requests[0].complete();

  const afterSuccess = mountTeamPage(storage, { globalData, memberId: 'member-7' });
  afterSuccess.page.onLoad({});
  assert.equal(afterSuccess.page.data.hasIncomingInvite, false, '成功后必须清除 raw token handoff');

  const rejected = mountTeamPage(storage, { globalData, memberId: '' });
  rejected.page.onLoad({ invite: token });
  rejected.page.onUnload();
  const rejectedAfterLogin = mountTeamPage(storage, { globalData, memberId: 'member-7' });
  rejectedAfterLogin.page.onLoad({});
  rejectedAfterLogin.page.acceptIncomingInvite();
  rejectedAfterLogin.requests[0].success({ code: 410, msg: '邀请已失效' });
  rejectedAfterLogin.requests[0].complete();
  const afterRejected = mountTeamPage(storage, { globalData, memberId: 'member-7' });
  afterRejected.page.onLoad({});
  assert.equal(afterRejected.page.data.hasIncomingInvite, false, '确定性 4xx 后必须清除失效 token');

  globalData.merchantTeamInviteHandoffV1 = { value: token, expiresAt: Date.now() - 1 };
  const expired = mountTeamPage(storage, { globalData, memberId: 'member-7' });
  expired.page.onLoad({});
  assert.equal(expired.page.data.hasIncomingInvite, false, '超过短 TTL 的内存 token 不得恢复');
  assert.equal(globalData.merchantTeamInviteHandoffV1, undefined, '过期 handoff 应立即从内存清理');
});

test('工作台先解析商家域 access/me，再按权限控制数据请求和入口', () => {
  const js = read('pages/merchant/index/index.js');
  const wxml = read('pages/merchant/index/index.wxml');

  assert.match(js, /url:\s*'\/api\/merchant\/access\/me'/);
  assert.match(js, /normalizeMerchantAccess/);
  assert.doesNotMatch(js, /app\.setUserType\(2\)/,
    '员工进入工作台不得把全局身份改写成商家 Owner');
  assert.match(wxml, /wx:if="\{\{merchantAccess\.canVerify\}\}"[^>]*bindtap="goScanQR"/);
  assert.match(wxml, /wx:if="\{\{merchantAccess\.canReadCrm\}\}"[^>]*bindtap="goCustomers"/);
  assert.match(wxml, /wx:if="\{\{merchantAccess\.canReadFinance\}\}"[^>]*bindtap="goFinance"/);
  assert.doesNotMatch(wxml, /data-action="team"/,
    '经营团队是低频配置，只保留“我的”主入口，不在工作台更多菜单重复出现');
});

test('商家项目写链路显式携带 MERCHANT scope，个人发布入口不被员工岗位吞掉', () => {
  const workbench = read('pages/merchant/index/index.js');
  const marketing = read('pages/merchant/marketing/index.js');
  const editor = read('pages/publish/fabu/index.js');
  const projects = read('subpackageA/pages/myproject/index.js');
  const shelf = read('pages/template/index.js');
  const projectHome = read('pages/topic/merchantinfo/merchantinfo.js');

  assert.doesNotMatch(workbench, /pages\/publish\/fabu\/index\?scope=MERCHANT/,
    '工作台零项目去合作中心，不得再把商家送进发主题');
  assert.match(marketing, /pages\/publish\/fabu\/index\?scope=MERCHANT/);
  assert.match(workbench, /subpackageA\/pages\/myproject\/index\?scope=MERCHANT/);
  assert.match(editor, /operationScope/);
  assert.match(editor, /scope:\s*this\.data\.operationScope/);
  assert.match(editor, /data:\s*\{\s*id,\s*scope:\s*this\.data\.operationScope/);
  assert.match(projects, /operationScope/);
  assert.match(projects, /scope:\s*this\.data\.operationScope/);
  assert.match(projectHome, /scope:\s*that\.data\.operationScope/);
  assert.match(shelf, /scope:\s*this\.data\.operationScope/);

  const genericPublishRoutes = read('components/tabBar/index.js');
  assert.match(genericPublishRoutes, /pagePath:\s*"\/pages\/template\/index"/,
    '玩家发布入口必须继续无 MERCHANT query，员工仍可发布个人作品');
});

test('商家节点玩法全生命周期贯穿 MERCHANT scope，模板 Tab 对无项目权限员工只读', () => {
  const shelf = read('pages/template/index.js');
  const shelfWxml = read('pages/template/index.wxml');
  const publishSheet = read('components/cy/publish-sheet/index.js');
  const projects = read('subpackageA/pages/myproject/index.js');
  const editor = read('pages/publish/fabu/index.js');
  const gameEditor = read('pages/publish/temp/index.js');

  assert.match(shelf, /url:\s*'\/api\/merchant\/access\/me'/,
    '商家模板 Tab 必须读取岗位权限，不能沿用全局 userType');
  assert.match(shelf, /normalizeMerchantAccess/);
  assert.match(shelf, /canManageMerchantProjects/);
  const publishFab = shelfWxml.match(/<view\b[^>]*class="fab[^"]*"[^>]*>/);
  assert.ok(publishFab, '模板架必须保留发布 FAB');
  assert.match(publishFab[0], /wx:if="\{\{isMerchant && \(!operationScope \|\| canManageMerchantProjects\)\}\}"/);
  assert.match(shelfWxml, /<cy-publish-sheet[^>]*scope="\{\{operationScope\}\}"/);
  assert.match(publishSheet, /scope:\s*\{\s*type:\s*String/);
  assert.match(publishSheet, /scope=MERCHANT/,
    '发布弹窗到简单主题、专业主题、节点玩法入口必须保留主体作用域');

  assert.match(projects, /url:\s*'\/api\/template\/my-list'[\s\S]{0,220}scope:\s*this\.data\.operationScope/);
  assert.match(projects, /url:\s*'\/api\/template\/updateLibraryStatus'[\s\S]{0,220}scope:\s*that\.data\.operationScope/);
  // 2026-08-27:删除改走 cy-danger-confirm 的确认回调后,发请求的是箭头函数里的 this,
  // 不再是闭包 that。合同要保的是「删除必须带 scope」,两种写法都算数。
  assert.match(projects, /url:\s*[^\n]*'\/api\/template\/delete'[\s\S]{0,220}scope:\s*(?:that|this)\.data\.operationScope/);
  assert.match(editor, /url:\s*'\/api\/template\/my-list'[\s\S]{0,220}scope:\s*that\.data\.operationScope/);
  assert.match(editor, /pages\/publish\/temp\/index\?from=fabu[\s\S]{0,260}scope=MERCHANT/);
  assert.match(gameEditor, /operationScope/);
  assert.match(gameEditor, /formData\.scope\s*=\s*this\.data\.operationScope/);
});

test('商家承接生成的 activity 只读展示，不复用俱乐部取消/删除资金权限', () => {
  const projects = read('subpackageA/pages/myproject/index.js');
  assert.match(projects, /const merchantActivity = p\.ownerType === 'merchant' && p\.bizType === 'activity'/);
  assert.match(projects, /_canToggle:\s*merchantActivity \? false : canToggle/);
  assert.match(projects, /_canDelete:\s*merchantActivity \? false : canDelete/);
});

test('“我的”页在资产之后提供经营团队主入口，且只在有效商家访问上下文显示', () => {
  const wxml = read('components/cy/profile/index.wxml');
  const js = read('components/cy/profile/index.js');
  const asset = wxml.indexOf('我的资产');
  const team = wxml.indexOf('经营团队');

  assert.ok(asset >= 0 && team > asset, '经营团队应放在我的资产之后');
  assert.match(wxml.slice(asset, team + 300), /wx:if="\{\{merchantAccess\.active\}\}"/);
  assert.match(js, /req\('\/api\/merchant\/access\/me'/);
  assert.match(js, /goMerchantTeam:\s*function\s*\(/);
  assert.match(js, /\/pages\/merchant\/team\/index/);
});

test('双身份用户在商家版“我的”页有明确的俱乐部工作台入口', () => {
  const wxml = read('components/cy/profile/index.wxml');
  const js = read('components/cy/profile/index.js');

  assert.match(wxml, /wx:if="\{\{isClubLeader\}\}"[\s\S]{0,260}title="俱乐部工作台"[\s\S]{0,260}bind:tap="goClubWorkbench"/,
    '商家视角必须按主理人能力显示俱乐部入口，不能按单值 role 互斥');
  assert.match(js, /isClubLeader:\s*false/,
    '纯商家默认不得出现俱乐部工作台');
  assert.match(js, /var isClubLeader\s*=\s*data\.isClubLeader\s*===\s*true\s*\|\|\s*data\.role\s*===\s*'club'/,
    '双身份判定必须复用 role-info 的 isClubLeader 能力位');
  assert.match(js, /isClubLeader:\s*isClubLeader/,
    '双身份能力位必须写入个人页状态');
  assert.match(js, /goClubWorkbench:\s*function\s*\(\)\s*\{[\s\S]{0,180}\/pages\/club\/detail\/index\?owner=1&tab=manage/,
    '俱乐部工作台必须直达既有详情管理 tab');
});

test('负控：把核销员静默放大成财务权限时必须判红', () => {
  const source = read('utils/merchant-access-policy.js');
  const mutated = source.replace(
    "FINANCE_READ: 'merchant:finance:read'",
    "FINANCE_READ: 'merchant:verify'",
  );
  assert.notEqual(mutated, source, '负控锚点失效');

  const vm = require('node:vm');
  const module = { exports: {} };
  vm.runInNewContext(mutated, { module, exports: module.exports, require }, { filename: 'merchant-access-policy.mutant.js' });
  const checkin = module.exports.normalizeMerchantAccess({
    active: true,
    merchant: { id: 8, name: '门店' },
    roleCode: 'MERCHANT_CHECKIN',
    permissions: ['merchant:verify'],
  });
  assert.throws(() => assert.equal(checkin.canReadFinance, false));
});

test('商家项目招商从项目页到邀约提交全程保留 MERCHANT 主体', () => {
  const projectHome = read('pages/topic/merchantinfo/merchantinfo.js');
  const nearby = read('pages/coop/nearby/index.js');
  const link = read('utils/merchant-home-link.js');
  const userinfo = read('pages/userinfo/userinfo.js');
  const userinfoWxml = read('pages/userinfo/userinfo.wxml');
  const profile = read('components/cy/profile/index.js');
  const invite = read('pages/coop/invite/index.js');
  const coopList = read('pages/coop/list/index.js');

  assert.match(projectHome, /pages\/coop\/nearby\/index\?topicId=[\s\S]{0,220}scope=MERCHANT/);
  assert.match(projectHome, /pages\/coop\/list\/index\?tab=received[\s\S]{0,120}scope=MERCHANT/);
  assert.match(projectHome, /review[\s\S]{0,320}scope:\s*that\.data\.operationScope/);

  assert.match(nearby, /operationScope/);
  assert.match(nearby, /scope:\s*that\.data\.operationScope/);
  assert.match(nearby, /merchantHomeUrl[\s\S]{0,180}scope:\s*this\.data\.operationScope/);
  assert.match(link, /scope=MERCHANT/);

  assert.match(userinfo, /operationScope/);
  assert.match(userinfoWxml, /operation-scope="\{\{operationScope\}\}"/);
  assert.match(profile, /operationScope:\s*\{\s*type:\s*String/);
  assert.match(profile, /topicId=[\s\S]{0,220}operationScope[\s\S]{0,120}scope=MERCHANT/);

  assert.match(invite, /operationScope/);
  assert.match(invite, /is_my:\s*1,\s*scope:\s*this\.data\.operationScope/);
  assert.match(invite, /payload\.scope\s*=\s*data\.operationScope/);
  assert.match(coopList, /operationScope/);
  assert.match(coopList, /scope:\s*this\._operationScope/);
  assert.match(coopList, /registrationId:\s*id,\s*scope:\s*that\._operationScope/);
});

test('主办方项目页就地审核章节申请和更新后的商家点位', () => {
  const page = read('pages/topic/merchantinfo/merchantinfo.js');
  const pageWxml = read('pages/topic/merchantinfo/merchantinfo.wxml');
  const hostJs = read('pages/topic/components/project-host/index.js');
  const hostWxml = read('pages/topic/components/project-host/index.wxml');

  assert.match(pageWxml, /owner-chapter-applications="\{\{ownerChapterApplications\}\}"/);
  assert.match(pageWxml, /pending-merchant-nodes="\{\{pendingMerchantNodes\}\}"/);
  assert.match(hostJs, /ownerChapterApplications:\s*\{\s*type:\s*Array/);
  assert.match(hostJs, /pendingMerchantNodes:\s*\{\s*type:\s*Array/);
  assert.match(hostWxml, /data-act="auditChapterApplication"/);
  assert.match(hostWxml, /data-act="auditMerchantNode"/);

  assert.match(page, /url:\s*'\/api\/merchant\/chapter-node\/pending'/);
  assert.match(page, /url:\s*'\/api\/merchant\/chapter-application\/audit'/);
  assert.match(page, /url:\s*'\/api\/merchant\/chapter-node\/audit'/);
  assert.match(page, /scope:\s*that\.data\.operationScope/);
  assert.match(page, /auditChapterApplication:\s*1/);
  assert.match(page, /auditMerchantNode:\s*1/);
});

// 2026-09-23 CU-M-03:后端 LocalDateTime 下发「2026-09-30T12:00:00」,旧 formatDate 先 replace(-,/)
// 得到非法串 ⇒ 邀请有效期恒显示「—」。isValidDate 用原值判,所以行没被丢、只是日期空。
test('邀请有效期认 ISO(带 T、带不带偏移都认),不再显示「—」', () => {
  [
    ['2026-09-30T12:05:00', '2026-09-30 12:05'],
    ['2026-09-30T12:05:00.000+08:00', '2026-09-30 12:05'],
    ['2026-09-30 12:05:00', '2026-09-30 12:05'],
  ].forEach(([expiresAt, text]) => {
    const mounted = mountTeamPage();
    mounted.page.loadTeam();
    mounted.requests[0].success({ code: 200, data: { operators: [], invites: [{
      id: 27, roleCode: 'MERCHANT_CHECKIN', status: 'PENDING', expiresAt, version: 0,
    }] } });
    assert.equal(mounted.page.data.pendingInvites[0].expiresAtText, text, expiresAt);
  });
});
