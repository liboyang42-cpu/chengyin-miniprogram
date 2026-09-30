const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('../helpers/ui-sandbox-vm.js'); // node:vm + 沙箱里装真 utils/toast.js·loading.js

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('客户整行进入 CRM 详情，电话点击仍由 catchtap 截断', () => {
  const wxml = read('pages/merchant/customer/index.wxml');
  assert.match(wxml,
    /class="cu-row"[^>]*data-memberid="\{\{item\.memberId\}\}"[^>]*bindtap="openCustomer"/);
  // F15:电话动作按 memberId 向服务端换明文;脱敏号不再当拨号参数。
  assert.match(wxml,
    /class="cu-phone"[^>]*catchtap="callCustomer"[^>]*data-memberid="\{\{item\.memberId\}\}"/);
});

test('详情入口只接受正的安全整数 memberId', () => {
  const { page, navigations } = mountListPage();
  page.openCustomer({ currentTarget: { dataset: { memberid: '41' } } });
  assert.deepEqual(navigations, ['/pages/merchant/customer/detail/index?customerMemberId=41']);

  ['0', '-1', '1.5', '9007199254740992', 'abc', '', null].forEach((memberid) => {
    page.openCustomer({ currentTarget: { dataset: { memberid } } });
  });
  assert.equal(navigations.length, 1, '脏 memberId 不得进入客户详情');
});

test('批量选择使用单一圆环勾选图标，不叠加第二层圆框', () => {
  const wxml = read('pages/merchant/customer/index.wxml');
  const wxss = read('pages/merchant/customer/index.wxss');

  assert.match(wxml, /class="cu-check \{\{item\.selected[^>]*>[\s\S]*?<cy-icon wx:if="\{\{item\.selected\}\}" name="check" size="40"/);
  assert.match(wxss, /\.cu-check--on\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*color:\s*var\(--cy-btn-solid-bg\);/s);
});

test('负控：若入口退化为 Number(value)>0，超出安全整数的 ID 必须被测试判红', () => {
  const source = read('pages/merchant/customer/index.js');
  const mutated = source.replace(
    'Number.isSafeInteger(memberId) && memberId > 0',
    'Number(memberId) > 0',
  );
  assert.notEqual(mutated, source, '负控锚点失效');
  const { page, navigations } = mountListPage(mutated);
  page.openCustomer({ currentTarget: { dataset: { memberid: '9007199254740992' } } });
  assert.equal(navigations.length, 1, '变异实现应错误放行不安全整数');
});

function mountListPage(overrideSource) {
  const file = path.join(root, 'pages/merchant/customer/index.js');
  const source = overrideSource || fs.readFileSync(file, 'utf8');
  const navigations = [];
  let definition;
  const sandbox = {
    getApp: () => ({ globalData: {}, sendRequest() {}, getRequestErrorMessage(_res, fallback) { return fallback; } }),
    Page(value) { definition = value; },
    wx: {
      getSystemInfoSync: () => ({ statusBarHeight: 20 }),
      navigateTo({ url }) { navigations.push(url); },
      makePhoneCall() {},
    },
    require(request) {
      if (request.includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (request.includes('response-shape')) return { isRecord: () => true, isRecordList: () => true };
      if (request.includes('merchant-access-policy')) {
        return require(path.join(root, 'utils/merchant-access-policy.js'));
      }
      throw new Error(`unexpected require ${request}`);
    },
    setTimeout() {}, clearTimeout() {}, Date, Math, Number, JSON,
  };
  vm.runInNewContext(source, sandbox, { filename: file });
  const page = Object.assign({ data: JSON.parse(JSON.stringify(definition.data)) }, definition);
  page.setData = patch => Object.assign(page.data, patch);
  return { page, navigations };
}
