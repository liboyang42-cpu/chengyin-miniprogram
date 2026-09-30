const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { TEMPLATES } = require('../../utils/subscribe.js');

const XCX_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(XCX_ROOT, '..');

const SURFACE_ROLES = {
  // 2026-09-15 合作中心「邀约我的」tab 收进协作邀请「收到的」,邀约提醒入口随之搬家
  'pages/coop/list/index.js': 'invitee',
  'pages/merchant/ledger/index.js': 'merchant',
  'pages/publish/fabu/index.js': 'publisher',
  'pages/activity/official-detail/index.js': 'participant',
};

// 自动契约表：ID 从两端真源读取，断言不复制任何模板 ID 字面量。
const SUBSCRIPTION_RECIPIENT_CONTRACTS = [
  {
    event: '合作被邀约',
    templateKey: 'coopInvited',
    recipientRole: 'invitee',
    entryFile: 'pages/coop/list/index.js',
    entryWxml: 'pages/coop/list/index.wxml',
    wxmlScopeMarker: '新邀约到达时提醒我',
    gestureHandler: 'enableInviteAlerts',
    backendConfigKey: 'tplCoopInvited',
    backendEvidence: [
      ['chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiCoopController.java', /notifyCoopInvited\(toOwner\b/],
      ['chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiOfficialEventController.java', /notifyCoopInvited\(merchantId\b/],
    ],
  },
  {
    event: '结算到账',
    templateKey: 'coopSettle',
    recipientRole: 'merchant',
    entryFile: 'pages/merchant/ledger/index.js',
    entryWxml: 'pages/merchant/ledger/index.wxml',
    wxmlScopeMarker: '结算到账提醒',
    gestureHandler: 'enableCoopSettleAlerts',
    controlTag: 'cy-switch',
    backendConfigKey: 'tplCoopSettle',
    backendEvidence: [
      ['chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/CmsTopicServiceImpl.java', /notifyCoopSettle\(paidSettlement\.getMerchantId\(\)/],
    ],
  },
  {
    event: '招募状态',
    templateKey: 'recruit',
    recipientRole: 'publisher',
    entryFile: 'pages/publish/fabu/index.js',
    entryWxml: 'pages/publish/fabu/index.wxml',
    gestureHandler: 'submitForm',
    backendConfigKey: 'tplRecruit',
    backendEvidence: [
      ['chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/CmsTopicServiceImpl.java', /notifyRecruit\(topic\.getMemberId\(\)/],
    ],
  },
];

function read(relativePath, root = XCX_ROOT) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function enclosingPageMethod(source, index) {
  const re = /^  ([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
  let found = null;
  let match;
  while ((match = re.exec(source)) && match.index < index) found = { name: match[1], index: match.index };
  return found;
}

function isCommentedOut(source, index) {
  const before = source.slice(0, index);
  const lineStart = before.lastIndexOf('\n') + 1;
  if (before.slice(lineStart).includes('//')) return true;
  return before.lastIndexOf('/*') > before.lastIndexOf('*/');
}

function walkJs(directory, prefix = '') {
  const files = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === 'tests' || entry.name === 'node_modules' || entry.name.startsWith('.')) return;
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkJs(absolute, relative));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(relative.split(path.sep).join('/'));
  });
  return files;
}

function requestSites() {
  const sites = [];
  walkJs(XCX_ROOT).forEach((file) => {
    const source = read(file);
    const call = /subscribe\s*\.\s*request\s*\(\s*\[([\s\S]*?)\]\s*\)/g;
    let match;
    while ((match = call.exec(source))) {
      if (isCommentedOut(source, match.index)) continue;
      const keys = [];
      const quoted = /['"]([^'"]+)['"]/g;
      let keyMatch;
      while ((keyMatch = quoted.exec(match[1]))) keys.push(keyMatch[1]);
      const method = enclosingPageMethod(source, match.index);
      const methodPrefix = method ? source.slice(method.index, match.index) : '';
      keys.forEach((templateKey) => sites.push({
        templateKey,
        file,
        line: lineAt(source, match.index),
        handler: method && method.name,
        role: SURFACE_ROLES[file],
        consumesResult: /^\s*\.then\s*\(/.test(source.slice(call.lastIndex)),
        synchronousTap: !!method && !/\bawait\b|\.then\s*\(|\bsetTimeout\s*\(|\bapp\.sendRequest\s*\(|\bwx\.(?:showModal|showActionSheet|request)\s*\(/.test(methodPrefix),
      }));
    }
  });
  return sites;
}

function backendTemplateIds() {
  const yml = read('chengyinhub-admin/src/main/resources/application.yml', REPO_ROOT);
  const ids = {};
  for (const match of yml.matchAll(/^\s+(tpl[A-Za-z]+):\s*"([^"]*)"/gm)) ids[match[1]] = match[2];
  return ids;
}

function containingBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notStrictEqual(markerIndex, -1, `WXML 作用域标记不存在: ${marker}`);
  const tags = /<\/?block\b[^>]*>/g;
  const stack = [];
  let match;
  while ((match = tags.exec(source)) && match.index <= markerIndex) {
    if (match[0].startsWith('</')) stack.pop();
    else stack.push(match.index);
  }
  const start = stack[stack.length - 1];
  assert.notStrictEqual(start, undefined, `WXML 标记不在 block 内: ${marker}`);
  tags.lastIndex = start;
  let depth = 0;
  while ((match = tags.exec(source))) {
    if (match[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return source.slice(start, tags.lastIndex);
  }
  assert.fail(`WXML block 未闭合: ${marker}`);
}

function assertRecipientContract(contract, sites, backendIds, sources = {}) {
  const eventSites = sites.filter((site) => site.templateKey === contract.templateKey);
  assert.ok(eventSites.length, `${contract.event}: 后端会发送，但前端没有授权入口`);
  eventSites.forEach((site) => {
    assert.strictEqual(
      site.role,
      contract.recipientRole,
      `${contract.event}: ${site.file}:${site.line} 的授权角色 ${site.role || 'unknown'} 与后端收件角色 ${contract.recipientRole} 不一致`
    );
  });
  assert.strictEqual(eventSites.length, 1, `${contract.event}: 应保留一个明确授权入口`);
  const site = eventSites[0];
  assert.strictEqual(site.file, contract.entryFile, `${contract.event}: 授权入口页面漂移`);
  assert.strictEqual(site.handler, contract.gestureHandler, `${contract.event}: 授权不在约定 tap handler 内`);
  assert.strictEqual(site.synchronousTap, true, `${contract.event}: 授权落在异步回调之后，已脱离 tap 同步调用栈`);
  assert.strictEqual(site.consumesResult, true, `${contract.event}: 调用方没有读取结构化授权结果`);

  const wxml = (sources[contract.entryWxml] || read(contract.entryWxml)).replace(/<!--[\s\S]*?-->/g, '');
  const wxmlScope = contract.wxmlScopeMarker ? containingBlock(wxml, contract.wxmlScopeMarker) : wxml;
  const controlTag = contract.controlTag || 'cy-btn';
  const bindingName = controlTag === 'cy-switch' ? '(?:bindchange|bind:change)' : '(?:bindtap|bind:tap)';
  const tapBinding = new RegExp(`<${controlTag}[^>]+${bindingName}=["']${contract.gestureHandler}["'][^>]*>`);
  assert.match(wxmlScope, tapBinding, `${contract.event}: 缺少收件角色可点击的授权按钮`);
  if (controlTag === 'cy-btn') {
    assert.doesNotMatch(wxmlScope.match(tapBinding)[0], /\bsize=["']xs["']/, `${contract.event}: 授权按钮触控目标不足 88rpx`);
  }

  contract.backendEvidence.forEach(([file, pattern]) => {
    const source = sources[file] || read(file, REPO_ROOT);
    assert.match(source, pattern, `${contract.event}: 后端发送目标证据已漂移`);
  });

  const frontendTemplateId = TEMPLATES[contract.templateKey];
  const backendTemplateId = backendIds[contract.backendConfigKey];
  assert.ok(frontendTemplateId, `${contract.event}: 前端模板未配置`);
  assert.ok(backendTemplateId, `${contract.event}: 后端模板未配置`);
  assert.strictEqual(frontendTemplateId, backendTemplateId, `${contract.event}: 前后端模板 ID 不一致`);

  return {
    event: contract.event,
    recipientRole: contract.recipientRole,
    frontendEntry: `${site.file}:${site.line}`,
    frontendTemplateId,
    backendTemplateId,
  };
}

function assertRecipientContracts(sources = {}) {
  const sites = sources.sites || requestSites();
  const backendIds = sources.backendIds || backendTemplateIds();
  return SUBSCRIPTION_RECIPIENT_CONTRACTS.map((contract) => (
    assertRecipientContract(contract, sites, backendIds, sources)
  ));
}

test('业务事件 → 收件角色 → tap 授权入口 → 前后端模板 ID 契约闭合', () => {
  const rows = assertRecipientContracts();
  assert.strictEqual(rows.length, SUBSCRIPTION_RECIPIENT_CONTRACTS.length);
});

test('负控:把招募申请放回报名人手势时，由收件角色闸精准判红', () => {
  const contract = SUBSCRIPTION_RECIPIENT_CONTRACTS.find((item) => item.templateKey === 'recruit');
  const mutated = requestSites().map((site) => site.templateKey === 'recruit'
    ? { ...site, file: 'pages/activity/official-detail/index.js', line: 137, handler: 'doSignup', role: 'participant' }
    : site);
  assert.throws(
    () => assertRecipientContract(contract, mutated, backendTemplateIds()),
    /招募状态: .*授权角色 participant 与后端收件角色 publisher 不一致/
  );
});

test('负控:删掉结算到账授权入口时，由缺失申请点闸精准判红', () => {
  const contract = SUBSCRIPTION_RECIPIENT_CONTRACTS.find((item) => item.templateKey === 'coopSettle');
  const mutated = requestSites().filter((site) => site.templateKey !== 'coopSettle');
  assert.throws(
    () => assertRecipientContract(contract, mutated, backendTemplateIds()),
    /结算到账: 后端会发送，但前端没有授权入口/
  );
});

test('待创建模板在前后端都保持空值，不借用其它业务模板', () => {
  const backendIds = backendTemplateIds();
  assert.strictEqual(TEMPLATES.clubInterest, '');
  assert.strictEqual(TEMPLATES.roamRecall, '');
  assert.strictEqual(backendIds.tplClubInterest, TEMPLATES.clubInterest);
  assert.strictEqual(backendIds.tplRoamRecall, TEMPLATES.roamRecall);
});
