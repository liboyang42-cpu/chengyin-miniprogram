// R9-32(P2):商家隐藏备注、移除客户标签成功后页面不刷新。
//
// 审查复现(第九轮 R9-32):两个写接口 200 回执只带 msg(「备注已隐藏」「标签已移除」)、
// 不带 data;客户详情页的 successObject 要求 res.data 非空,于是成功被判失败,提前 return,
// 没有 loadDetail 刷新;弹出的错误提示恰好是成功 msg,页面与接口状态矛盾。
//
// 契约(按接口真实契约处理):
//   · 读接口(access/me、customers/:id/detail)仍必须有 data;
//   · 写回执(hide/remove)以 code 判成功,成功后必须静默刷新详情;
//   · 非 200(如 409 并发/版本冲突)仍走错误提示,且不得吞掉服务端原因。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('../helpers/ui-sandbox-vm.js');

const viewModel = require('../../pages/merchant/customer/detail/view-model');

test('RED 锚点:hide 成功回执不带 data 时也必须刷新详情且不弹失败提示', () => {
  const { page, requests, toasts } = mountPage();
  readyDetail(page, requests);

  page._hideNote(8, 0);
  assert.match(requests[2].url, /\/notes\/hide$/);
  requests[2].success({ code: 200, msg: '备注已隐藏' });

  assert.equal(requests.length, 4, '回执没有 data 不等于失败,必须 loadDetail(true)');
  assert.match(requests[3].url, /\/customers\/41\/detail$/);
  assert.equal(page.data.noteHidingId, null);
  assert.equal(toasts.length, 0, '成功回执不得被当成失败弹提示(更不得弹成功 msg)');
});

test('remove 成功回执不带 data 时同样刷新详情', () => {
  const { page, requests, toasts } = mountPage();
  readyDetail(page, requests);

  page._removeTag(3);
  assert.match(requests[2].url, /\/tags\/remove$/);
  requests[2].success({ code: 200, msg: '标签已移除' });

  assert.equal(requests.length, 4, 'remove 成功后必须 loadDetail(true)');
  assert.match(requests[3].url, /\/customers\/41\/detail$/);
  assert.equal(toasts.length, 0);
});

test('非 200(并发冲突)仍提示服务端原因且不刷新成假成功', () => {
  const { page, requests, toasts } = mountPage();
  readyDetail(page, requests);

  page._hideNote(8, 1);
  requests[2].success({ code: 409, msg: '备注已被更新，请刷新后重试' });

  assert.equal(requests.length, 3, '冲突不得触发详情刷新');
  assert.equal(toasts.length, 1);
  assert.match(String(toasts[0]), /备注已被更新|隐藏跟进失败/);
});

test('读接口缺 data 仍必须判失败(修复不能把读契约一起放宽)', () => {
  const { page, requests } = mountPage();
  page.onLoad({ customerMemberId: '41' });
  requests[0].success({ code: 200, msg: '操作成功' });
  assert.equal(page.data.pageState, 'error', 'access/me 无 data 必须进错误态');
  assert.equal(requests.length, 1, 'access 失败不得继续请求详情');
});

function detailPayload() {
  return {
    summary: { customerMemberId: 41, displayName: '林青', arrivedCount: 0, pendingCount: 0, refundedCount: 0, paidAmount: '38.00' },
    systemTags: [], merchantTags: [], timeline: [],
  };
}

function readyDetail(page, requests) {
  page.onLoad({ customerMemberId: '41' });
  requests[0].success({ code: 200, data: { active: true, permissions: ['merchant:crm:read', 'merchant:crm:segment'] } });
  assert.match(requests[1].url, /\/customers\/41\/detail$/);
  requests[1].success({ code: 200, data: detailPayload() });
  assert.equal(page.data.pageState, 'ready');
}

function mountPage() {
  const file = path.resolve(__dirname, '../../pages/merchant/customer/detail/index.js');
  const source = fs.readFileSync(file, 'utf8');
  const requests = [];
  const toasts = [];
  let definition;
  const app = {
    globalData: {},
    sendRequest(options) { requests.push(options); },
    getRequestErrorMessage(res, fallback) { return (res && res.msg) || fallback; },
  };
  const sandbox = {
    getApp: () => app,
    getCurrentPages: () => [{}],
    Page(value) { definition = value; },
    wx: {
      getWindowInfo: () => ({ statusBarHeight: 20 }),
      navigateBack() {}, reLaunch() {}, showModal() {},
      showToast(options) { toasts.push(options && options.title); },
    },
    require(request) {
      if (request.includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (request.includes('merchant-access-policy')) {
        return {
          inactiveAccess: () => ({ active: false, canReadCrm: false, canSegmentCrm: false }),
          normalizeMerchantAccess: raw => ({
            active: raw.active === true,
            canReadCrm: Array.isArray(raw.permissions) && raw.permissions.includes('merchant:crm:read'),
            canSegmentCrm: Array.isArray(raw.permissions) && raw.permissions.includes('merchant:crm:segment'),
          }),
        };
      }
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
  return { page, requests, toasts };
}
