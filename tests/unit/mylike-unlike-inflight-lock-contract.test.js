'use strict';

// A-07(P2):「我的收藏」取消收藏可被连点反插。
// 后端 /api/topic/like 是「查无即插」的 toggle(前端传的 type=0 被忽略),
// 取消请求在途时用户再点一次确认,第二个请求就把刚删的行重新插入。
// 修法:与帖文点赞同款 per-id in-flight 锁 —— 在途期间同一 id 不再发第二次请求。
//
// 负控:去掉锁,连点两下必须变成两个请求(用例真红)。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_REL = 'pages/mylike/mylike.js';
const PAGE_PATH = path.resolve(__dirname, '../../pages/mylike/mylike.js');
const read = () => fs.readFileSync(PAGE_PATH, 'utf8');

function loadPage(source) {
  const requests = [];
  const modals = [];
  let definition = null;
  global.getApp = () => ({
    globalData: {},
    getRequestErrorMessage: (_res, fallback) => fallback,
    sendRequest(options) { requests.push(options); return { abort() {} }; },
  });
  global.Page = (config) => { definition = config; };
  global.wx = {
    getStorageSync: () => '',
    setNavigationBarColor() {},
    stopPullDownRefresh() {},
    showToast() {},
    showModal(options) { modals.push(options); }, // 由用例驱动确认
  };
  delete require.cache[require.resolve(PAGE_PATH)];
  if (source) {
    const Module = require('node:module');
    const m = new Module(PAGE_PATH, null);
    m.filename = PAGE_PATH;
    m.paths = Module._nodeModulePaths(path.dirname(PAGE_PATH));
    m._compile(source, PAGE_PATH);
  } else {
    require(PAGE_PATH);
  }
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
  });
  page.setData = function setData(patch, cb) {
    Object.assign(this.data, patch);
    if (cb) cb();
  };
  return { page, requests, modals };
}

const unlikeRequests = (requests) => requests.filter((r) => r.url === '/api/topic/like');

test('连点两下:第二个确认不得发出第二个 toggle 请求;请求收尾后锁释放', () => {
  const { page, requests, modals } = loadPage();
  page.setData({ ztList1: [{ id: 11, name: '收藏一' }, { id: 12, name: '收藏二' }] });

  page.topicUnlike({ currentTarget: { dataset: { index: 0, id: 11 } } });
  modals[0].success({ confirm: true });
  assert.equal(unlikeRequests(requests).length, 1, '确认后发一次取消请求');

  // 请求还在途:再点 —— 后端 toggle 会把行插回来,连确认框都不该再弹
  page.topicUnlike({ currentTarget: { dataset: { index: 0, id: 11 } } });
  assert.equal(modals.length, 1, '在途期间重复点击不该再开确认框');
  assert.equal(unlikeRequests(requests).length, 1, '在途期间的重复点击不得再发请求(否则取消变重新收藏)');

  // 收尾(complete)后锁释放,可以再次操作
  unlikeRequests(requests)[0].complete({ code: '200' });
  page.topicUnlike({ currentTarget: { dataset: { index: 1, id: 12 } } });
  modals[1].success({ confirm: true });
  assert.equal(unlikeRequests(requests).length, 2, '不同 id / 锁释放后应能正常取消');
});

test('取消成功本地摘行;失败不摘行且锁释放', () => {
  const { page, requests, modals } = loadPage();
  page.setData({ ztList1: [{ id: 11 }, { id: 12 }] });

  page.topicUnlike({ currentTarget: { dataset: { index: 0, id: 11 } } });
  modals[0].success({ confirm: true });
  unlikeRequests(requests)[0].success({ code: '200' });
  assert.deepEqual(page.data.ztList1.map((item) => item.id), [12]);
  unlikeRequests(requests)[0].complete({ code: '200' });

  page.topicUnlike({ currentTarget: { dataset: { index: 0, id: 12 } } });
  modals[1].success({ confirm: true });
  unlikeRequests(requests)[1].success({ code: '500', msg: '服务开小差' });
  assert.deepEqual(page.data.ztList1.map((item) => item.id), [12], '失败不得把行摘掉');
  unlikeRequests(requests)[1].complete({ code: '500' });

  page.topicUnlike({ currentTarget: { dataset: { index: 0, id: 12 } } });
  modals[2].success({ confirm: true });
  assert.equal(unlikeRequests(requests).length, 3, '失败后锁必须释放,允许重试');
});

test('负控:摘掉 in-flight 锁,连点必然发出两个 toggle 请求 ⇒ 用例真红', () => {
  const source = read();
  const broken = source
    .replace("    if (that._unlikeRequests[requestKey]) return;\n\n    modal.show({", '    modal.show({')
    .replace("          if (that._unlikeRequests[requestKey]) return;\n          that._unlikeRequests[requestKey] = true;\n", '');
  assert.notEqual(broken, source, '负控锚点失效:锁未命中');

  const { page, requests, modals } = loadPage(broken);
  page.setData({ ztList1: [{ id: 11 }] });
  page.topicUnlike({ currentTarget: { dataset: { index: 0, id: 11 } } });
  modals[0].success({ confirm: true });
  page.topicUnlike({ currentTarget: { dataset: { index: 0, id: 11 } } });
  modals[1].success({ confirm: true });
  assert.equal(unlikeRequests(requests).length, 2, '负控必须真的把锁摘掉');
});
