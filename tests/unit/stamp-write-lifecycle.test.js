const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../subpackageP3/pages/stamp-camera/index/index.js');
const PENDING_KEY = 'cy_stamp_pending_create';
let sandbox;

beforeEach(() => {
  sandbox = {
    pageConfig: null,
    requests: [],
    stored: {},
    uploadDone: null,
    uploadAborts: 0,
    writeAborts: 0,
    memberId: 7,
  };
  const operation = () => ({
    aborted: false,
    attach(control) { this.control = control; return this; },
    finish() { this.control = null; },
    abort() { this.aborted = true; if (this.control && this.control.abort) this.control.abort(); },
    isAborted() { return this.aborted; },
  });
  global.getApp = () => ({
    globalData: {},
    getUserID() { return sandbox.memberId; },
    createPageBoundOperation: operation,
    getUploadClient() {
      return {
        uploadAll(_files, options) {
          sandbox.uploadDone = options.onDone;
          return { abort() { sandbox.uploadAborts += 1; } };
        },
      };
    },
    sendRequest(options) {
      sandbox.requests.push(options);
      return { abort() { sandbox.writeAborts += 1; } };
    },
  });
  global.Page = config => { sandbox.pageConfig = config; };
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44, pixelRatio: 3 }),
    setStorageSync(key, value) { sandbox.stored[key] = value; },
    getStorageSync(key) { return sandbox.stored[key]; },
    removeStorageSync(key) { delete sandbox.stored[key]; },
    showToast() {},
    showLoading() {},
    hideLoading() {},
    redirectTo() {},
  };
});

function loadPage() {
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
  const page = Object.assign({}, sandbox.pageConfig);
  page.data = JSON.parse(JSON.stringify(sandbox.pageConfig.data));
  page.setData = function (patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  };
  return page;
}

test('上传完成后先持久化同一幂等键，离页不 abort 可能已提交的写请求', () => {
  const page = loadPage();
  page.data.shot = '/tmp/stamp.jpg';
  page._idemKey = 'st-fixed';

  page.onSave();
  sandbox.uploadDone({ results: ['https://img.example/stamp.jpg'] });

  assert.deepEqual(sandbox.stored[PENDING_KEY + ':7'], {
    picUrl: 'https://img.example/stamp.jpg',
    idempotencyKey: 'st-fixed',
    memberId: '7',
  });
  page.onUnload();
  assert.equal(sandbox.writeAborts, 0, '服务端可能已提交的 POST 不得在离页时 abort');
});

test('重新进入相机会用持久化的幂等键对账，不生成新键重复入册', () => {
  sandbox.stored[PENDING_KEY] = {
    picUrl: 'https://img.example/stamp.jpg',
    idempotencyKey: 'st-fixed',
    memberId: '7',
  };
  const page = loadPage();

  page.onLoad();

  assert.equal(sandbox.requests.length, 1);
  assert.equal(sandbox.requests[0].url, '/api/roam/stamp/create');
  assert.deepEqual(sandbox.requests[0].data, {
    picUrl: 'https://img.example/stamp.jpg',
    idempotencyKey: 'st-fixed',
  });
});

test('写请求离页后成功仍保留待对账记录，重进页面用同一幂等键读取结果', () => {
  sandbox.stored[PENDING_KEY] = {
    picUrl: 'https://img.example/stamp.jpg',
    idempotencyKey: 'st-fixed',
    memberId: '7',
  };
  const page = loadPage();

  page.onLoad();
  page.onUnload();
  sandbox.requests[0].success({ code: 200, data: { id: 88 } });

  assert.deepEqual(sandbox.stored[PENDING_KEY + ':7'], {
    picUrl: 'https://img.example/stamp.jpg',
    idempotencyKey: 'st-fixed',
    memberId: '7',
  });

  const nextPage = loadPage();
  nextPage.onLoad();
  assert.equal(sandbox.requests.length, 2);
  assert.deepEqual(sandbox.requests[1].data, {
    picUrl: 'https://img.example/stamp.jpg',
    idempotencyKey: 'st-fixed',
  });
});

test('换号后不得用旧账号的图片入册，也不得删除旧账号待对账记录', () => {
  sandbox.memberId = 8;
  sandbox.stored[PENDING_KEY] = {
    picUrl: 'https://img.example/private-user-7.jpg',
    idempotencyKey: 'st-user-7',
    memberId: '7',
  };
  const page = loadPage();

  page.onLoad();

  assert.equal(sandbox.requests.length, 0);
  assert.deepEqual(sandbox.stored[PENDING_KEY], {
    picUrl: 'https://img.example/private-user-7.jpg',
    idempotencyKey: 'st-user-7',
    memberId: '7',
  });
  assert.equal(page.data.shot, '');
});

test('登录态尚未恢复时不得删除待对账记录', () => {
  sandbox.memberId = '';
  sandbox.stored[PENDING_KEY] = {
    picUrl: 'https://img.example/private-user-7.jpg',
    idempotencyKey: 'st-user-7',
    memberId: '7',
  };
  const page = loadPage();

  page.onLoad();

  assert.equal(sandbox.requests.length, 0);
  assert.equal(sandbox.stored[PENDING_KEY].idempotencyKey, 'st-user-7');
});

test('不同账号保存使用独立 storage key，不覆盖彼此未知结果', () => {
  sandbox.stored[PENDING_KEY] = {
    picUrl: 'https://img.example/private-user-7.jpg',
    idempotencyKey: 'st-user-7',
    memberId: '7',
  };
  sandbox.memberId = 8;
  const page = loadPage();

  assert.equal(page.persistPendingCreate('https://img.example/user-8.jpg', 'st-user-8'), true);
  assert.equal(sandbox.stored[PENDING_KEY].idempotencyKey, 'st-user-7');
  assert.deepEqual(sandbox.stored[PENDING_KEY + ':8'], {
    picUrl: 'https://img.example/user-8.jpg',
    idempotencyKey: 'st-user-8',
    memberId: '8',
  });
});
