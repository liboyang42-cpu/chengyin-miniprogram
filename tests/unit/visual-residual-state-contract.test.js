'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const INBOX_PAGE = '../../pages/activity/official-inbox/index.js';
const MAP_PAGE = '../../pages/searchmap/index.js';
const INBOX_WXML = path.resolve(__dirname, '../../pages/activity/official-inbox/index.wxml');
const MAP_WXML = path.resolve(__dirname, '../../pages/searchmap/index.wxml');

function assertResidualMarkup(inbox, map) {
  assert.match(inbox, /item\._display\.eventTitle/);
  assert.match(inbox, /item\._display\.cityRole/);
  assert.match(inbox, /item\._display\.scope/);
  assert.doesNotMatch(inbox, /\{\{item\.eventTitle\}\}/);
  assert.match(map, /<cover-view wx:if="\{\{locationError\}\}"/);
  assert.match(map, /<cover-view[^>]+bindtap="recoverLocation"/);
  assert.match(map, /\{\{locationMessage\}\}/);
  assert.match(map, /<cover-view class="location-btn" bindtap="requestLocation"/);
}

function loadPage(pagePath, app, wx) {
  let config;
  global.getApp = () => app;
  global.wx = wx;
  global.Page = (definition) => { config = definition; };
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  return config;
}

function makePage(config, data) {
  const page = Object.assign({}, config, { data: Object.assign({}, config.data, data) });
  page.setData = (patch, done) => {
    Object.keys(patch).forEach((key) => {
      if (key.indexOf('.') === -1) page.data[key] = patch[key];
      else {
        const parts = key.split('.');
        let target = page.data;
        parts.slice(0, -1).forEach((part) => { target = target[part] = target[part] || {}; });
        target[parts[parts.length - 1]] = patch[key];
      }
    });
    if (done) done();
  };
  return page;
}

test('官方邀约关键字段为空时归一为可读占位，WXML 不直渲原字段', () => {
  const requests = [];
  const pageConfig = loadPage(INBOX_PAGE, {
    sendRequest: (request) => requests.push(request),
    getRequestErrorMessage: () => '邀约加载失败'
  }, {});
  const page = makePage(pageConfig);
  page.fetch();
  requests[0].success({ code: 200, data: [
    { partyId: 1, status: '', eventTitle: '', city: '', role: '', targetType: '节点' },
    { partyId: 2, status: 'INVITED', eventTitle: '秋季', city: null, role: 'FULFILLMENT_CLUB',
      targetType: 'EVENT', targetId: 99002302, windowStart: '2026-09-22T09:00:00', windowEnd: '2026-10-02T18:00:00' },
  ] });

  // 2026-09-23 CU-C-14:city 空 = 全国活动(与详情页同口径);内部 targetType/targetId 不露给用户。
  assert.deepEqual(page.data.invites[0]._display, {
    eventTitle: '未命名官方活动',
    cityRole: '全国 · 职责待确认',
    scope: '指定范围职责'
  });
  assert.equal(page.data.invites[1]._display.scope, '本场整体职责', 'EVENT #id 不得出现在卡片上');
  assert.equal(page.data.invites[1]._window, '9月22日 09:00 — 10月2日 18:00', 'ISO 时间必须格式化');
  assert.equal(page.data.invites[0]._status, '状态待确认');
  const wxml = fs.readFileSync(INBOX_WXML, 'utf8');
  assertResidualMarkup(wxml, fs.readFileSync(MAP_WXML, 'utf8'));
});

test('地图定位说明确认后才取位；被拒后用 map-native CTA 打开设置并重试', () => {
  let locationRequest;
  let openedSettings = false;
  let locationModal;
  const pageConfig = loadPage(MAP_PAGE, { globalData: {} }, {
    getLocation: (request) => { locationRequest = request; },
    showModal: (modal) => { locationModal = modal; },
    openSetting: (request) => {
      openedSettings = true;
      request.success({ authSetting: { 'scope.userLocation': true } });
    },
    showToast: () => {},
    createMapContext: () => ({})
  });
  const page = makePage(pageConfig);
  page.requestLocation();
  assert.equal(locationRequest, undefined);
  assert.equal(locationModal.title, '定位说明');
  locationModal.success({ confirm: true });
  locationRequest.fail({ errMsg: 'getLocation:fail auth deny' });

  assert.equal(page.data.locationError, true);
  assert.equal(page.data.locationAction, 'open-setting');
  assert.equal(page.data.locationMessage, '定位权限未开启');
  page.recoverLocation();
  assert.equal(openedSettings, true);
  locationModal.success({ confirm: true });
  assert.equal(page.data.locationError, false);
  assert.equal(typeof locationRequest.success, 'function');

  const wxml = fs.readFileSync(MAP_WXML, 'utf8');
  assertResidualMarkup(fs.readFileSync(INBOX_WXML, 'utf8'), wxml);
});

test('negative control: 官方邀约重回原始空字段或地图退回非原生覆盖层必须判红', () => {
  const inbox = fs.readFileSync(INBOX_WXML, 'utf8');
  const map = fs.readFileSync(MAP_WXML, 'utf8');
  const brokenInbox = inbox.replace('item._display.eventTitle', 'item.eventTitle');
  const brokenMap = map.replace('<cover-view wx:if="{{locationError}}"', '<view wx:if="{{locationError}}"');
  assert.notEqual(brokenInbox, inbox, '负控锚点失效：官方邀约显示字段不存在');
  assert.notEqual(brokenMap, map, '负控锚点失效：地图原生覆盖层不存在');
  assert.throws(() => assertResidualMarkup(brokenInbox, map), assert.AssertionError);
  assert.throws(() => assertResidualMarkup(inbox, brokenMap), assert.AssertionError);
});
