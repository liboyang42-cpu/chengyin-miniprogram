const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('../helpers/ui-sandbox-vm.js'); // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..');

function mountCityNodePage() {
  let definition;
  const requests = [];
  const navigations = [];
  const scans = [];
  const toasts = [];
  const app = {
    globalData: { navBarHeight: 44 },
    sendRequest(request) { requests.push(request); },
  };
  const wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    navigateTo: options => navigations.push(options.url),
    showToast: options => toasts.push(options),
    scanCode: options => scans.push(options),
    showModal() {},
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'pages/merchant/citynode/index.js'), 'utf8'),
    {
      Page: value => { definition = value; },
      getApp: () => app,
      getCurrentPages: () => [{}],
      require: request => {
        if (request.includes('withdraw-form')) {
          return {
            CONSENT_DOC_TYPE: 'WITHDRAWAL_TERMS',
            CONSENT_SCENE: 'WITHDRAW',
            checkWithdrawForm: () => ({ ok: true }),
          };
        }
        if (request.includes('merchant-access-policy')) {
          return {
            inactiveAccess: () => ({ active: false, canManageProjects: false, canVerify: false }),
            normalizeMerchantAccess: raw => raw,
          };
        }
        if (request.includes('motion-preference')) return { readReducedMotion: () => true };
        if (request.includes('motion.js')) return { haptic() {} };
        if (request.includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
        if (request.includes('album-template')) return require('../../utils/album-template.js');
        if (request.includes('validation-method-labels')) return require('../../utils/validation-method-labels.js');
        // 2026-09-15 提现改弹客服微信;本组用例只考 citynode 权限链,不驱动提现。
        if (request.includes('withdraw-cs')) return { showWithdrawCsPopup() {} };
        // 发布者实名:场景表单在 data 里就要读它的两句文案,用真模块而不是桩
        if (request.includes('publisher-identity')) return require('../../utils/publisher-identity.js');
        throw new Error('unexpected require: ' + request);
      },
      wx,
      console,
      Number,
      String,
      Array,
      Object,
    },
  );
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  };
  return { page, requests, navigations, scans, toasts };
}

function mountCityNodeCreatePage() {
  let definition;
  const requests = [];
  const navigations = [];
  const toasts = [];
  const app = {
    globalData: { navBarHeight: 44 },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(request) { requests.push(request); },
  };
  const wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    navigateTo: options => navigations.push(options),
    showToast: options => toasts.push(options),
    showModal() {},
    chooseLocation() {},
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'pages/merchant/citynode/create/index.js'), 'utf8'),
    {
      Page: value => { definition = value; },
      getApp: () => app,
      getCurrentPages: () => [{}],
      require: request => {
        if (request.includes('merchant-access-policy')) {
          return {
            inactiveAccess: () => ({ active: false, canManageProjects: false }),
            normalizeMerchantAccess: raw => raw,
          };
        }
        if (request.includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
        if (request.includes('album-template')) return require('../../utils/album-template.js');
        if (request.includes('validation-method-labels')) return require('../../utils/validation-method-labels.js');
        // 发布者实名:场景表单在 data 里就要读它的两句文案,用真模块而不是桩
        if (request.includes('publisher-identity')) return require('../../utils/publisher-identity.js');
        throw new Error('unexpected require: ' + request);
      },
      wx,
      console,
      Number,
      String,
      Array,
      Object,
    },
  );
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  };
  return { page, requests, navigations, toasts };
}

test('据点页先读 access/me，只有 PROJECT_MANAGE 才读取商家据点', () => {
  const denied = mountCityNodePage();
  denied.page.onShow();
  assert.equal(denied.requests[0].url, '/api/merchant/access/me');
  denied.requests[0].success({
    code: 200,
    data: { active: true, canManageProjects: false, canVerify: true },
  });
  assert.equal(denied.requests.length, 1, '无项目权限不得探测据点与申请');
  assert.equal(denied.page.data.accessState, 'no-permission');

  const allowed = mountCityNodePage();
  allowed.page.onShow();
  allowed.requests[0].success({
    code: 200,
    data: { active: true, canManageProjects: true, canVerify: true },
  });
  assert.equal(allowed.requests[1].url, '/api/merchant/city-node/list');
});

test('权限未知或无权时，项目写操作与核销操作都在客户端 fail closed', () => {
  const mounted = mountCityNodePage();
  mounted.page.goCreate();
  mounted.page.toggleClaim();
  mounted.page.loadPosterCode(301);
  mounted.page.toggleNode({ currentTarget: { dataset: { poiid: 301, status: 1 } } });
  mounted.page.scanRedeem();

  assert.deepEqual(mounted.navigations, []);
  assert.deepEqual(mounted.requests, []);
  assert.deepEqual(mounted.scans, []);
});

test('据点创建页先校验 PROJECT_MANAGE，通过后才读取店铺资料', () => {
  const denied = mountCityNodeCreatePage();
  denied.page.onLoad();
  assert.equal(denied.requests[0].url, '/api/merchant/access/me');
  denied.requests[0].success({ code: 200, data: { active: true, canManageProjects: false } });
  assert.equal(denied.requests.length, 1);
  assert.equal(denied.page.data.accessState, 'no-permission');

  const allowed = mountCityNodeCreatePage();
  allowed.page.onLoad();
  allowed.requests[0].success({ code: 200, data: { active: true, canManageProjects: true } });
  assert.equal(allowed.requests[1].url, '/api/merchant/info');
});

test('据点创建页权限未知时拒绝配置和提交，通过后把 MERCHANT scope 交给玩法页', () => {
  const mounted = mountCityNodeCreatePage();
  mounted.page.goConfigTemplate();
  mounted.page.data.tpl = { id: 801 };
  mounted.page.data.picked = { lat: 30.1, lng: 120.2 };
  mounted.page.submitNode();
  assert.equal(mounted.navigations.length, 0);
  assert.equal(mounted.requests.length, 0);

  mounted.page.data.merchantAccess = { active: true, canManageProjects: true };
  mounted.page.data.accessState = 'ready';
  mounted.page.goConfigTemplate();
  assert.match(mounted.navigations[0].url, /from=citynode/);
  assert.match(mounted.navigations[0].url, /scope=MERCHANT/);
});

test('据点玩法编辑分支在 access/me 未确认前拒绝提交', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages/publish/temp/index.js'), 'utf8');
  assert.match(source, /merchant-access-policy/);
  assert.match(source, /merchantAccessPolicy\.inactiveAccess\(\)/);
  assert.match(source, /url:\s*['"]\/api\/merchant\/access\/me['"]/);
  assert.match(source, /from === 'citynode'[\s\S]{0,220}!this\.data\.merchantAccess\.canManageProjects/);
  assert.match(source, /from === 'citynode'[\s\S]{0,500}city-node\/template\/submit/);
});

function mountRouteContent() {
  let definition;
  const requests = [];
  const app = {
    getUserID: () => 901,
    getPageSize: () => 20,
    sendRequest(request) { requests.push(request); },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'components/cy/scene-route-content/index.js'), 'utf8'),
    {
      Component: value => { definition = value; },
      getApp: () => app,
      require: request => {
        if (request.includes('withdraw-form')) {
          return {
            CONSENT_DOC_TYPE: 'WITHDRAWAL_TERMS',
            CONSENT_SCENE: 'WITHDRAW',
            checkWithdrawForm: () => ({ ok: true }),
          };
        }
        // 2026-09-15 提现改弹客服微信;本组用例只考 citynode 权限链,不驱动提现。
        if (request.includes('withdraw-cs')) {
          return { showWithdrawCsPopup() {} };
        }
        if (request.includes('merchant-access-policy')) {
          return {
            inactiveAccess: () => ({ active: false, canManageProjects: false }),
            normalizeMerchantAccess: raw => raw,
          };
        }
        if (request.includes('merchant-identity-policy')) {
          return require(path.join(ROOT, 'utils/merchant-identity-policy.js'));
        }
        // 发布者实名:场景表单在 data 里就要读它的两句文案,用真模块而不是桩
        if (request.includes('publisher-identity')) return require('../../utils/publisher-identity.js');
        throw new Error('unexpected require: ' + request);
      },
      wx: { showToast() {}, showModal() {}, navigateTo() {} },
      console,
      Number,
      String,
      Array,
      Object,
    },
  );
  const component = Object.assign({}, definition.methods);
  component.data = Object.assign({}, definition.data, { sceneId: 'merchant-citynode', params: {} });
  component.setData = function setData(patch) { Object.assign(this.data, patch); };
  component.triggerEvent = function triggerEvent() {};
  return { component, requests };
}

test('场景容器的 merchant-citynode 同样先校验 PROJECT_MANAGE', () => {
  const denied = mountRouteContent();
  denied.component.loadScene();
  assert.equal(denied.requests[0].url, '/api/merchant/access/me');
  denied.requests[0].success({ code: 200, data: { active: true, canManageProjects: false } });
  assert.equal(denied.requests.length, 1);
  assert.equal(denied.component.data.state, 'no-permission');

  const allowed = mountRouteContent();
  allowed.component.loadScene();
  allowed.requests[0].success({ code: 200, data: { active: true, canManageProjects: true } });
  assert.equal(allowed.requests[1].url, '/api/merchant/city-node/list');
});

test('场景容器的 access/me 业务异常同样 fail closed', () => {
  const mounted = mountRouteContent();
  mounted.component.loadScene();

  assert.equal(typeof mounted.requests[0].successStatusAbnormal, 'function');
  mounted.requests[0].successStatusAbnormal({ msg: '权限服务暂不可用' });

  assert.equal(mounted.requests.length, 1);
  assert.equal(mounted.component.data.state, 'error');
  assert.equal(mounted.component.data.errorText, '权限服务暂不可用');
});
