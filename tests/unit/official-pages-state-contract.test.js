'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function loadPage(relativePath, appOverrides, wxOverrides) {
  let definition;
  const requests = [];
  const modals = [];
  const toasts = [];
  const app = Object.assign({
    sendRequest: (request) => requests.push(request),
    getRequestErrorMessage: (_error, fallback) => fallback,
    getUserRole: () => 'merchant',
    getUserType: () => 2,
  }, appOverrides || {});
  global.getApp = () => app;
  global.wx = Object.assign({
    getStorageSync: () => '',
    showModal: (modal) => modals.push(modal),
    showToast: (toast) => toasts.push(toast),
    stopPullDownRefresh: () => {},
    navigateTo: () => {},
  }, wxOverrides || {});
  global.Page = (config) => { definition = config; };
  const absolutePath = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(absolutePath)];
  require(absolutePath);
  return { definition, requests, modals, toasts };
}

function makePage(definition, data) {
  const page = Object.assign({}, definition);
  page.data = Object.assign({}, JSON.parse(JSON.stringify(definition.data)), data || {});
  page.setData = (patch, done) => {
    Object.keys(patch).forEach((key) => {
      if (!key.includes('.')) page.data[key] = patch[key];
    });
    if (done) done();
  };
  return page;
}

function actionEvent(partyId, action) {
  return { currentTarget: { dataset: { id: partyId, action } } };
}

function publishedPayload() {
  return {
    events: [{ id: 7, title: '外滩夜行档案', city: '上海', status: 2 }],
    broadcasts: [{ id: 8, title: '集合提醒', status: 2, copyMode: 1, audience: 'merchant', reachedCount: 0, city: '上海' }],
  };
}

test('官方邀约写操作同步防重，失败留在原卡片且重试前不假更新列表', () => {
  const h = loadPage('pages/activity/official-inbox/index.js', {
    getRequestErrorMessage: (_error, fallback) => fallback,
  });
  const invite = {
    partyId: 21,
    partyType: 'MERCHANT',
    role: 'FULFILLMENT_MERCHANT',
    status: 'INVITED',
    _partyKey: '21',
  };
  const page = makePage(h.definition, { loading: false, invites: [invite] });
  const before = JSON.parse(JSON.stringify(page.data.invites));

  page.act(actionEvent(21, 'accept'));
  page.act(actionEvent(21, 'accept'));
  assert.equal(h.modals.length, 1, '同步连点只能出现一个确认流程');
  assert.equal(page.data.actionBusyPartyKey, '21', '等待确认时卡片也要有可见忙碌态');

  h.modals[0].success({ confirm: true });
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, 'POST');
  page.act(actionEvent(21, 'decline'));
  assert.equal(h.requests.length, 1, '请求在途时不能发起冲突写操作');
  assert.equal(h.modals.length, 1, '请求在途时不能再弹第二个确认框');

  h.requests[0].fail({ errMsg: 'request:fail network' });
  assert.equal(page.data.actionBusyPartyKey, '');
  assert.equal(page.data.actionErrorPartyKey, '21');
  assert.equal(page.data.actionError, '网络异常，请重试');
  assert.deepEqual(page.data.invites, before, '失败不能把 INVITED 乐观改成已接受');

  page.retryAction();
  assert.equal(h.requests.length, 2, '原位重试直接重发已确认过的同一动作');
  assert.equal(h.modals.length, 1, '重试 CTA 不重复询问同一确认');
  assert.equal(page.data.actionError, '');
  h.requests[1].success({ code: 500, msg: '状态已变化' });
  assert.equal(page.data.actionErrorPartyKey, '21');
  assert.equal(page.data.actionError, '操作未完成');
  assert.deepEqual(page.data.invites, before, '业务失败同样不能假更新列表');

  page.retryAction();
  h.requests[2].success({ code: 200 });
  assert.equal(h.requests.length, 4, '写成功后必须回读收件箱，以服务端事实更新列表');
  assert.equal(h.requests[3].method, 'GET');
  assert.deepEqual(page.data.invites, before, '回读完成前仍保留旧快照，不伪造成功状态');
  page.act(actionEvent(21, 'accept'));
  assert.equal(h.modals.length, 1, '服务端回读完成前旧卡片仍不可重复提交');
  h.requests[3].success({
    code: 200,
    data: [{ partyId: 21, partyType: 'MERCHANT', role: 'FULFILLMENT_MERCHANT', status: 'ACCEPTED' }],
  });
  assert.equal(page.data.invites[0].status, 'ACCEPTED');
});

test('官方邀约动作错误与忙碌态使用现有 inline-error，并暴露无障碍状态', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/activity/official-inbox/index.wxml'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/activity/official-inbox/index.json'), 'utf8'));
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index');
  assert.match(wxml, /actionErrorPartyKey\s*===\s*item\._partyKey[\s\S]*?<cy-inline-error\b/);
  assert.match(wxml, /actionBusyPartyKey\s*===\s*item\._partyKey/);
  assert.match(wxml, /aria-disabled="\{\{[^}]*actionBusyPartyKey[^}]*\}\}"/);
  assert.match(wxml, /aria-live="polite"/);
});

test('我的发布拒绝畸形 rows，不能把未知载荷冒充两个空列表', () => {
  const h = loadPage('pages/activity/official-mine/index.js');
  const page = makePage(h.definition);
  page.fetch();

  assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: { events: {}, broadcasts: [] } }));
  assert.equal(page.data.hasLoaded, false);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.events.length, 0);
  assert.equal(page.data.error, '发布记录加载失败');

  page.fetch();
  assert.doesNotThrow(() => h.requests[1].success({ code: 200, data: { events: [{ title: '缺少主键' }], broadcasts: [] } }));
  assert.equal(page.data.hasLoaded, false, '缺失可导航主键的行不能渲染成可点击卡片');
  assert.equal(page.data.error, '发布记录加载失败');
});

test('我的发布严格区分 0 与 unknown，未知状态、对象、方式和范围不伪装成空值', () => {
  const h = loadPage('pages/activity/official-mine/index.js');
  const page = makePage(h.definition);
  page.fetch();
  h.requests[0].success({
    code: 200,
    data: {
      events: [{ id: 1, title: '', city: '', status: 999 }],
      broadcasts: [
        { id: 2, title: '', status: 999, copyMode: 99, audience: 'unknown-role', reachedCount: '0', city: '' },
        { id: 3, title: '零触达通知', status: 0, copyMode: 1, audience: 'merchant', reachedCount: 0, city: '上海' },
      ],
    },
  });

  assert.equal(page.data.hasLoaded, true);
  assert.equal(page.data.events[0]._title, '未命名官方活动');
  assert.equal(page.data.events[0]._city, '城市待确认');
  assert.equal(page.data.events[0]._st, '状态待确认');
  assert.equal(page.data.broadcasts[0]._st, '状态待确认');
  assert.equal(page.data.broadcasts[0]._aud, '对象待确认');
  assert.equal(page.data.broadcasts[0]._mode, '发送方式待确认');
  assert.equal(page.data.broadcasts[0]._reach, '站内触达人数待确认');
  assert.equal(page.data.broadcasts[0]._city, '范围待确认');
  assert.equal(page.data.broadcasts[1]._reach, '站内触达 0 人', '数值 0 必须保留为真实零触达');
});

test('我的发布刷新保留已确认快照，失败进入局部错误且较早响应不能覆盖新结果', () => {
  const h = loadPage('pages/activity/official-mine/index.js', {
    getRequestErrorMessage: (_error, fallback) => fallback,
  });
  const page = makePage(h.definition);
  page.fetch();
  h.requests[0].success({ code: 200, data: publishedPayload() });
  const before = JSON.parse(JSON.stringify(page.data.events));

  page.fetch();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.refreshing, true);
  assert.deepEqual(page.data.events, before, '刷新期间不能退回骨架或清空旧列表');
  h.requests[1].fail({ errMsg: 'request:fail timeout' });
  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.error, '');
  assert.deepEqual(page.data.events, before);

  page.fetch();
  page.fetch();
  assert.equal(h.requests.length, 4);
  h.requests[3].success({
    code: 200,
    data: { events: [{ id: 9, title: '新结果', city: '杭州', status: 3 }], broadcasts: [] },
  });
  h.requests[2].success({
    code: 200,
    data: { events: [{ id: 8, title: '迟到结果', city: '北京', status: 2 }], broadcasts: [] },
  });
  assert.equal(page.data.events[0]._title, '新结果', '迟到响应不得覆盖最新一次刷新');
});

test('我的发布首载、刷新、局部错误与未知数字文案在视图层分离', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/activity/official-mine/index.wxml'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/activity/official-mine/index.json'), 'utf8'));
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index');
  assert.match(wxml, /<cy-skeleton\b[^>]*wx:if="\{\{loading\s*&&\s*!hasLoaded\}\}"/);
  assert.match(wxml, /refreshing[\s\S]*aria-role="status"[\s\S]*aria-live="polite"/);
  assert.doesNotMatch(wxml, /<cy-inline-error\b[^>]*staleError/s);
  assert.match(wxml, /item\._reach/);
  assert.doesNotMatch(wxml, /reachedCount\s*\|\|\s*0/);
  assert.doesNotMatch(wxml, /item\.city\s*\|\|\s*'全国'/);
});

function assertMutationSensitiveContracts(inboxJs, mineJs, mineWxml) {
  assert.match(inboxJs, /this\._actionBusy\s*=\s*true/);
  assert.match(mineJs, /isRecordList\(data\.events\)[\s\S]*isRecordList\(data\.broadcasts\)/);
  assert.match(mineJs, /Number\.isInteger\(value\)\s*&&\s*value\s*>=\s*0/);
  assert.match(mineWxml, /item\._reach/);
}

test('negative control: 移除同步锁、严格列表或 unknown 投影时合同必须判红', () => {
  const inboxJs = fs.readFileSync(path.join(ROOT, 'pages/activity/official-inbox/index.js'), 'utf8');
  const mineJs = fs.readFileSync(path.join(ROOT, 'pages/activity/official-mine/index.js'), 'utf8');
  const mineWxml = fs.readFileSync(path.join(ROOT, 'pages/activity/official-mine/index.wxml'), 'utf8');
  assertMutationSensitiveContracts(inboxJs, mineJs, mineWxml);

  const noLock = inboxJs.replaceAll('this._actionBusy = true', 'this._actionBusy = false');
  const looseRows = mineJs.replace('isRecordList(data.events)', 'Array.isArray(data.events)');
  const fakeZero = mineWxml.replace('item._reach', 'item.reachedCount || 0');
  assert.notEqual(noLock, inboxJs);
  assert.notEqual(looseRows, mineJs);
  assert.notEqual(fakeZero, mineWxml);
  assert.throws(() => assertMutationSensitiveContracts(noLock, mineJs, mineWxml), assert.AssertionError);
  assert.throws(() => assertMutationSensitiveContracts(inboxJs, looseRows, mineWxml), assert.AssertionError);
  assert.throws(() => assertMutationSensitiveContracts(inboxJs, mineJs, fakeZero), assert.AssertionError);
});
