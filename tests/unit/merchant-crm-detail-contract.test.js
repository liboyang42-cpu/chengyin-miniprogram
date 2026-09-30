const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('../helpers/ui-sandbox-vm.js'); // node:vm + 沙箱里装真 utils/toast.js·loading.js

const viewModel = require('../../pages/merchant/customer/detail/view-model');

test('客户详情严格绑定路由 customerMemberId，脱敏金额明确显示无查看权限', () => {
  const shaped = viewModel.shapeCustomerDetail({
    summary: {
      customerMemberId: 41,
      displayName: '林青',
      avatar: '',
      arrivedCount: 2,
      pendingCount: 1,
      refundedCount: 0,
      paidAmount: null,
      lastInteractionTime: '2026-08-23 12:00:00',
    },
    systemTags: [{ code: 'ARRIVED', label: '已到店' }],
    merchantTags: [{ id: 3, tagName: '高频复购', tagColor: '#2E6D5A' }],
    timeline: [
      { key: 'campaign-18', type: 'CAMPAIGN', title: '周末活动提醒', description: '站内通知 · 已送达', occurredAt: '2026-08-23 14:00:00' },
      { key: 'note-8', type: 'NOTE', title: '团队跟进', description: '记得无糖', occurredAt: '2026-08-23 13:00:00' },
    ],
  }, 41);

  assert.equal(shaped.summary.customerMemberId, 41);
  assert.equal(shaped.summary.paidAmountText, '无查看权限');
  assert.equal(shaped.systemTags[0].label, '已到店');
  assert.equal(shaped.merchantTags[0].tagName, '高频复购');
  assert.equal(shaped.timeline[0].typeText, '触达');
  assert.equal(viewModel.shapeCustomerDetail({ summary: { customerMemberId: 99 }, systemTags: [], merchantTags: [], timeline: [] }, 41), null);
});

test('备注与标签草稿仅输出白名单字段并拒绝脏输入', () => {
  assert.deepEqual(viewModel.buildNoteDraft('  记得无糖  '), { valid: true, content: '记得无糖' });
  assert.equal(viewModel.buildNoteDraft('   ').valid, false);
  assert.deepEqual(viewModel.buildTagDraft('  高频复购  ', '#2e6d5a'), {
    valid: true, tagName: '高频复购', tagColor: '#2E6D5A',
  });
  assert.equal(viewModel.buildTagDraft('标签', 'red').valid, false);
});

test('页面先查 access/me，读写分别受 canReadCrm 与 canSegmentCrm 约束', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/customer/detail/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/customer/detail/index.wxml'), 'utf8');
  assert.match(source, /\/api\/merchant\/access\/me/);
  assert.match(source, /canReadCrm/);
  assert.match(source, /canSegmentCrm/);
  assert.match(source, /\/api\/merchant\/crm\/customers\/\$\{this\._customerMemberId\}\/detail/);
  assert.doesNotMatch(source, /merchantId/);
  assert.match(wxml, /pageState === 'no-permission'/);
  assert.match(wxml, /wx:if="\{\{canEdit\}\}"/);
  assert.match(wxml, /bindtap="submitNote"/);
  assert.match(wxml, /bindtap="submitTag"/);
  assert.match(wxml, /(?:bindtap|catchtap)="removeTag"/);
});

test('运行态：无权限不读详情，网络失败进错误态，空标签/时间线保持可用详情', () => {
  const { page, requests } = mountPage();
  page.onLoad({ customerMemberId: '41' });
  assert.equal(requests[0].url, '/api/merchant/access/me');
  requests[0].success({ code: 200, data: { active: true, permissions: [] } });
  assert.equal(page.data.pageState, 'no-permission');
  assert.equal(requests.length, 1, '无 CRM_READ 不得请求客户详情');
  page.submitNote();
  assert.equal(requests.length, 1, '无 CRM_SEGMENT 不得提交跟进');

  const mounted = mountPage();
  mounted.page.onLoad({ customerMemberId: '41' });
  mounted.requests[0].success({ code: 200, data: { active: true, permissions: ['merchant:crm:read'] } });
  assert.match(mounted.requests[1].url, /\/customers\/41\/detail$/);
  mounted.requests[1].fail();
  assert.equal(mounted.page.data.pageState, 'error');

  mounted.page.retry();
  mounted.requests[2].success({ code: 200, data: {
    summary: { customerMemberId: 41, displayName: '林青', arrivedCount: 0, pendingCount: 1, refundedCount: 0, paidAmount: '38.00' },
    systemTags: [], merchantTags: [], timeline: [],
  } });
  assert.equal(mounted.page.data.pageState, 'ready');
  assert.deepEqual(mounted.page.data.detail.systemTags, []);
  assert.deepEqual(mounted.page.data.detail.merchantTags, []);
  assert.deepEqual(mounted.page.data.detail.timeline, []);
});

test('负控：若详情不再核对 customerMemberId，跨客户响应必须被测试判红', () => {
  const file = path.resolve(__dirname, '../../pages/merchant/customer/detail/view-model.js');
  const source = fs.readFileSync(file, 'utf8');
  const mutated = source.replace(
    'if (customerMemberId !== expectedCustomerMemberId) return null;',
    'if (false) return null;',
  );
  assert.notEqual(mutated, source, '负控锚点失效');
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(mutated, sandbox);
  assert.notEqual(
    sandbox.module.exports.shapeCustomerDetail({ summary: { customerMemberId: 99, arrivedCount: 0, pendingCount: 0, refundedCount: 0 }, systemTags: [], merchantTags: [], timeline: [] }, 41),
    null,
    '变异实现应错误接纳跨客户响应',
  );
  assert.equal(viewModel.shapeCustomerDetail({ summary: { customerMemberId: 99 }, systemTags: [], merchantTags: [], timeline: [] }, 41), null);
});

function mountPage() {
  const file = path.resolve(__dirname, '../../pages/merchant/customer/detail/index.js');
  const source = fs.readFileSync(file, 'utf8');
  const requests = [];
  let definition;
  const app = {
    globalData: {},
    sendRequest(options) { requests.push(options); },
    getRequestErrorMessage(_res, fallback) { return fallback; },
  };
  const sandbox = {
    getApp: () => app,
    getCurrentPages: () => [{}],
    Page(value) { definition = value; },
    wx: {
      getWindowInfo: () => ({ statusBarHeight: 20 }),
      navigateBack() {}, reLaunch() {}, showModal() {}, showToast() {},
    },
    require(request) {
      if (request.includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (request.includes('utils/datetime')) return require(path.resolve(__dirname, '../../utils/datetime.js'));
      if (request.includes('merchant-access-policy')) return {
        inactiveAccess: () => ({ active: false, canReadCrm: false, canSegmentCrm: false }),
        normalizeMerchantAccess: raw => ({
          active: raw.active === true,
          canReadCrm: Array.isArray(raw.permissions) && raw.permissions.includes('merchant:crm:read'),
          canSegmentCrm: Array.isArray(raw.permissions) && raw.permissions.includes('merchant:crm:segment'),
        }),
      };
      if (request === './view-model.js') return viewModel;
      throw new Error(`unexpected require ${request}`);
    },
    Date,
    Math,
    JSON,
  };
  vm.runInNewContext(source, sandbox, { filename: file });
  const page = Object.assign({ data: JSON.parse(JSON.stringify(definition.data)) }, definition);
  page.setData = patch => Object.assign(page.data, patch);
  return { page, requests };
}
