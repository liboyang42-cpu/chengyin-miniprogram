const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('../helpers/ui-sandbox-vm.js'); // node:vm + 沙箱里装真 utils/toast.js·loading.js

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('客户列表把分页、tag、来源与时间窗发往真实CRM分页接口', () => {
  const { page, requests } = mountList();
  Object.assign(page.data, { tagId: 7, sourceType: '2', sourceStart: '2026-08-01', sourceEnd: '2026-08-23' });
  page.load();
  assert.equal(requests[0].url, '/api/merchant/crm/customers/list');
  const body = JSON.parse(requests[0].data);
  assert.deepEqual({ pageNum: body.pageNum, tagId: body.tagId, sourceType: body.sourceType,
    sourceStart: body.sourceStart, sourceEnd: body.sourceEnd },
  { pageNum: 1, tagId: 7, sourceType: 2, sourceStart: '2026-08-01', sourceEnd: '2026-08-23' });
});

test('批量标签最多选择100人且只提交客户ID与标签白名单', () => {
  const { page, requests } = mountList();
  Object.assign(page.data, { canSegment: true, selecting: true, rows: [{ memberId: 41 }, { memberId: 42 }] });
  page.openCustomer({ currentTarget: { dataset: { memberid: '41' } } });
  page.openCustomer({ currentTarget: { dataset: { memberid: '42' } } });
  page.setData({ batchTagName: '高频复购' });
  page.submitBatchTag();
  assert.equal(requests[0].url, '/api/merchant/crm/customers/tags/batch');
  const body = JSON.parse(requests[0].data);
  assert.deepEqual(body.customerMemberIds, [41, 42]);
  assert.equal(body.tagName, '高频复购');
  assert.equal('merchantId' in body, false);
});

test('无CRM_READ时列表不读客户；导出处理中可轮询，下载同时携带登录与随机token', () => {
  const denied = mountList();
  denied.page.onLoad();
  denied.requests[0].success({
    code: 200,
    data: { active: true, merchant: { id: 7 }, roleCode: 'MERCHANT_MANAGER', permissions: [] },
  });
  assert.equal(denied.page.data.noPermission, true);
  assert.equal(denied.requests.length, 1);

  const mounted = mountList();
  mounted.page.setData({ canExport: true });
  mounted.page.createExport();
  mounted.requests[0].success({ code: 200, data: { id: 88, status: 'PENDING', downloadToken: 'random-download-token-12345678901234567890' } });
  assert.match(mounted.requests[1].url, /\/exports\/88\/status$/);
  mounted.requests[1].success({ code: 200, data: { id: 88, status: 'SUCCESS', rowCount: 2 } });
  mounted.page.downloadExport();
  assert.match(mounted.downloads[0].url, /\/api\/merchant\/crm\/exports\/88\/download$/);
  assert.equal(mounted.downloads[0].header.Authorization, 'login-token');
  assert.equal(mounted.downloads[0].header['X-CRM-Export-Token'], 'random-download-token-12345678901234567890');
});

test('导出状态 200 空对象保持待确认、继续轮询，并提供手动重新查询', () => {
  const mounted = mountList();
  mounted.page.setData({ canExport: true });
  mounted.page.createExport();
  mounted.requests[0].success({
    code: 200,
    data: { id: 88, status: 'PENDING', downloadToken: 'random-download-token-12345678901234567890' },
  });
  mounted.requests[1].success({ code: 200, data: {} });

  assert.equal(mounted.page.data.exportState, 'PENDING', '空状态不能覆盖最后一次可信状态');
  assert.equal(mounted.page.data.exportTask.id, 88, '空状态不能丢掉待查询任务主键');
  assert.match(mounted.page.data.exportError, /状态.*(失败|没读到)|数据.*异常/);
  assert.equal(mounted.timers.length, 1, '自动轮询必须继续，而不是在空状态上永久停住');
  assert.match(read('pages/merchant/customer/index.wxml'),
    /exportError[\s\S]*?exportState === 'PENDING'[\s\S]*?bindtap="retryExportStatus"[\s\S]*?>重新查询</,
    '处理中查询失败必须暴露手动重查入口');

  mounted.page.retryExportStatus();
  assert.equal(mounted.requests.length, 3);
  assert.match(mounted.requests[2].url, /\/exports\/88\/status$/);
});

test('页面公开成功/错误/空/处理中态，并只开放受同意与权限约束的真实触达', () => {
  const wxml = read('pages/merchant/customer/index.wxml');
  const detail = read('pages/merchant/customer/detail/index.js');
  assert.match(wxml, /exportState === 'PENDING'/);
  assert.match(wxml, /exportState === 'SUCCESS'/);
  assert.match(wxml, /exportState === 'FAILED'/);
  assert.match(detail, /correctsNoteId: this\.data\.correctsNoteId \|\| null/);
  assert.match(detail, /\/notes\/hide/);
});

test('有效负控：移除下载token header后运行态会丢失二次凭证', () => {
  const source = read('pages/merchant/customer/index.js');
  const mutated = source.replace("'X-CRM-Export-Token': this._exportToken", "'X-Removed-Token': this._exportToken");
  assert.notEqual(mutated, source, '负控锚点失效');
  const original = mountList(source);
  const broken = mountList(mutated);
  for (const mounted of [original, broken]) {
    mounted.page._exportToken = 'random-download-token-12345678901234567890';
    mounted.page.setData({ exportTask: { id: 88, status: 'SUCCESS' }, exportState: 'SUCCESS' });
    mounted.page.downloadExport();
  }
  assert.equal(original.downloads[0].header['X-CRM-Export-Token'], 'random-download-token-12345678901234567890');
  assert.equal(broken.downloads[0].header['X-CRM-Export-Token'], undefined,
    '变异实现必须暴露为缺少下载二次凭证');
});

// #29 / F-MC-1:原来下载失败时写 exportState:'SUCCESS' + 一条错误,同屏既说「导出已就绪」
// 又说「下载失败」。服务端就绪是事实,但本机没拿到文件不是同一件事,不能共用一个态。
test('下载失败落在自己的终态:不再谎称已就绪,且留下能点的重试出口', () => {
  for (const outcome of [
    () => ({ statusCode: 500, tempFilePath: '' }),
    null,
  ]) {
    const mounted = mountList();
    mounted.page._exportToken = 'dl-token';
    mounted.page.setData({ exportTask: { id: 88, status: 'SUCCESS' }, exportState: 'SUCCESS' });

    mounted.page.downloadExport();
    if (outcome) mounted.downloads[0].success(outcome());
    else mounted.downloads[0].fail({ errMsg: 'downloadFile:fail' });

    assert.equal(mounted.page.data.exportState, 'DOWNLOAD_FAILED');
    assert.match(mounted.page.data.exportError, /下载失败/);
  }

  const wxml = read('pages/merchant/customer/index.wxml');
  assert.match(wxml, /exportState === 'DOWNLOAD_FAILED'/, '该态要有自己的说法');
  assert.match(wxml, /exportState === 'SUCCESS'\}\}">导出已就绪/, '「已就绪」只许挂在 SUCCESS 上');
  assert.match(wxml, /DOWNLOAD_FAILED' \? '重新下载' : '下载并打开'/, '失败后按钮要改名,不能还是那句「下载并打开」');
});

function mountList(overrideSource) {
  const file = path.join(root, 'pages/merchant/customer/index.js');
  const source = overrideSource || fs.readFileSync(file, 'utf8');
  const requests = [];
  const downloads = [];
  const timers = [];
  let definition;
  const app = {
    globalData: { siteBaseUrl: 'https://api.example.test' },
    sendRequest(options) { requests.push(options); },
    getAuthorization() { return 'login-token'; },
    getRequestErrorMessage(_res, fallback) { return fallback; },
  };
  const sandbox = {
    getApp: () => app,
    Page(value) { definition = value; },
    wx: {
      getSystemInfoSync: () => ({ statusBarHeight: 20 }),
      navigateTo() {}, makePhoneCall() {}, showToast() {},
      downloadFile(options) { downloads.push(options); },
      openDocument() {},
    },
    require(request) {
      if (request.includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (request.includes('response-shape')) return {
        isRecord: value => !!(value && typeof value === 'object' && !Array.isArray(value)),
        isRecordList: value => Array.isArray(value) && value.every(Boolean),
      };
      if (request.includes('merchant-access-policy')) {
        return require(path.join(root, 'utils/merchant-access-policy.js'));
      }
      throw new Error(`unexpected require ${request}`);
    },
    setTimeout(callback, delay) { timers.push({ callback, delay, cleared: false }); return timers.length; },
    clearTimeout(timer) { if (timers[timer - 1]) timers[timer - 1].cleared = true; },
    Date, Math, Number, JSON, Object, Array, String,
  };
  vm.runInNewContext(source, sandbox, { filename: file });
  const page = Object.assign({ data: JSON.parse(JSON.stringify(definition.data)) }, definition);
  page.setData = patch => Object.assign(page.data, patch);
  return { page, requests, downloads, timers };
}
