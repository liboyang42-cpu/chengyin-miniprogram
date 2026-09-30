'use strict';
// C 组修复契约(2026-09-16):漫游域 C-04 / C-05 / C-06 / C-09 / C-11 / C-14。
// 每条先钉住「修复后的行为」,撤掉修复即判红(负控口径见 C组修复_报告.md)。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const JS = () => read('pages/roam/index.js');
const WXML = () => read('pages/roam/index.wxml');

const PAGE_MODULE = '../../pages/roam/index.js';

function loadRoamPage(appMock) {
  let definition;
  const previous = {
    Page: global.Page, getApp: global.getApp,
    getCurrentPages: global.getCurrentPages, wx: global.wx,
  };
  try {
    global.Page = (config) => { definition = config; };
    global.getApp = () => (appMock || { globalData: {}, getUserID: () => '' });
    global.getCurrentPages = () => [];
    global.wx = { getStorageSync: () => undefined };
    delete require.cache[require.resolve(PAGE_MODULE)];
    require(PAGE_MODULE);
  } finally {
    global.Page = previous.Page;
    global.getApp = previous.getApp;
    global.getCurrentPages = previous.getCurrentPages;
    global.wx = previous.wx;
  }
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  return page;
}

test('C-04 抽屉里有「结束本次漫游」:不再只有长按 3 秒一个隐藏手势', () => {
  const wxml = WXML();
  const js = JS();
  const drawerStart = wxml.indexOf("sceneCurrent.id === 'roam-more'");
  const drawer = wxml.slice(drawerStart, wxml.indexOf('<!-- 清空本机缓存的确认'));
  assert.ok(drawerStart > 0, 'roam-more 抽屉块必须存在');
  assert.match(drawer, /bindtap="endRoamSession"/, '抽屉里必须有一行真的接 endRoamSession');
  assert.match(drawer, /aria-label="结束本次漫游并结算"/, '这一行读屏器要念得出来');
  // 从抽屉进来先收起抽屉,否则确认框背后压着一层九行抽屉;长按进来时是空操作
  assert.match(js, /endRoamSession\(\) \{[\s\S]{0,220}?this\.closeScene\(\);[\s\S]{0,120}?dangerKey: 'roam\.finish'/);
});

test('C-05 设置页权限态从 wx.getSetting 读真值,不再是恒「关」的假值', () => {
  const page = loadRoamPage();
  let asked = 0;
  const prevWx = global.wx;
  try {
    global.wx = {
      getSetting: (opts) => {
        asked += 1;
        opts.success({ authSetting: { 'scope.userLocation': true, 'scope.userLocationBackground': true } });
      },
    };
    page._syncRoamPermission();
  } finally {
    global.wx = prevWx;
  }
  assert.equal(asked, 1, '_syncRoamPermission 必须真问系统');
  assert.equal(page.data.gpsOk, true);
  assert.equal(page.data.bgGpsOk, true);

  // 未授权时两行都显示关(不能把「没问过」当已开)
  const page2 = loadRoamPage();
  const prevWx2 = global.wx;
  try {
    global.wx = { getSetting: (opts) => opts.success({ authSetting: {} }) };
    page2._syncRoamPermission();
  } finally {
    global.wx = prevWx2;
  }
  assert.equal(page2.data.gpsOk, false);
  assert.equal(page2.data.bgGpsOk, false);

  const wxml = WXML();
  assert.match(wxml, /aria-label="位置权限，\{\{gpsOk \? '已允许' : '未允许'\}\}"/);
  assert.match(wxml, /aria-label="后台持续定位，\{\{bgGpsOk \? '已开启' : '未开启'\}\}"/);
  assert.match(JS(), /onShow\(\) \{[\s\S]{0,220}?this\._syncRoamPermission\(\);/,
    '回到本页(含从系统设置页返回)要刷新权限态');
  assert.match(JS(), /openRoamSettings\(\) \{ this\._syncRoamPermission\(\);/);
});

test('C-06 未登录先补一次登录;登录不成给「登录没有成功」而不是开出必失败的漫游', async () => {
  const calls = [];
  let logged = false;
  const appMock = {
    globalData: {},
    getUserID: () => (logged ? '9' : ''),
    firstLogin: () => { logged = true; return Promise.resolve(); },
  };
  const page = loadRoamPage(appMock);
  const prevWx = global.wx;
  const prevApp = global.getApp;
  try {
    global.getApp = () => appMock;
    global.wx = {
      getStorageSync: () => undefined,
      getLocation: (o) => { calls.push('getLocation'); if (o.complete) o.complete(); },
    };
    await page.goStart();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    global.wx = prevWx;
    global.getApp = prevApp;
  }
  assert.deepEqual(calls, ['getLocation'], '补登录成功后必须继续原流程(走到取位)');
  assert.equal(page._roamStartPending, false, '门闩必须放掉,不能把常驻实例焊死');

  // 登录始终不成:不取位、给一句能理解的话,并且门闩放掉可以再点
  const appFail = { globalData: {}, getUserID: () => '', firstLogin: () => Promise.resolve() };
  const page2 = loadRoamPage(appFail);
  const calls2 = [];
  const prevWx2 = global.wx;
  const prevApp2 = global.getApp;
  try {
    global.getApp = () => appFail;
    global.wx = { getStorageSync: () => undefined, getLocation: () => calls2.push('getLocation') };
    await page2.goStart();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    global.wx = prevWx2;
    global.getApp = prevApp2;
  }
  assert.deepEqual(calls2, [], '没有会话时不许开漫游(开了也只会每次上报弹请先登录)');
  assert.match(page2.data.introError, /登录没有成功/);
  assert.equal(page2._roamStartPending, false);
});

test('C-09 真 POI 的 marker id 是数字(70 万段),点针按 id 全等回解', () => {
  const js = JS();
  assert.match(js, /const ROAM_POI_MK_BASE = 700000;/);
  assert.match(js, /id: ROAM_POI_MK_BASE \+ Number\(n\.id\), _roamId: n\.id/);
  assert.doesNotMatch(js, /id: 'r' \+ n\.id/, '字符串 marker id 违反微信 <map> 数字契约');

  const page = loadRoamPage();
  const opened = [];
  page.openScene = (id, params) => opened.push([id, params]);
  page._pois = [{ id: 700009, _roamId: 9, cat: 'landmark', isCityNode: true, state: 'seen' }];
  page.onMarkerTap({ detail: { markerId: 700009 } });
  assert.deepEqual(opened, [['roam-poi-detail', { poiId: 9 }]], '数字 id 必须能点开对应据点');
});

test('C-11 刚进图没会话时给「先走一小段」,不再误报「不是合作商家」', async () => {
  const js = JS();
  assert.match(js, /if \(!this\._roamSid\) return Promise\.resolve\(\{ ok: false, reason: 'nosession' \}\)/);
  assert.match(js, /r\.reason === 'nosession'[\s\S]{0,120}?先在地图上走一小段/);

  const page = loadRoamPage();
  page._roamSid = 0;
  const noSession = await page._apiShopVisit({ _roamId: 5 });
  assert.deepEqual(noSession, { ok: false, reason: 'nosession' });
  // 演示点(无 _roamId/regId)才走 nolocal:两条原因不许再共用一句文案
  const noSource = await page._apiShopVisit({ demo: true });
  assert.deepEqual(noSource, { ok: false, reason: 'nolocal' });
});

test('C-14 两处静默失败补内联态:原生 POI 点击有回应、商家图层失败进离线横幅', () => {
  const js = JS();
  assert.match(js, /cyToast\('这个地点暂时没有可记录的信息'\)/,
    '点地图原生 POI 不再完全静默');
  assert.match(js, /if \(res\.code != '200' \|\| !isRecordList\(res\.data\)\) \{[\s\S]{0,160}?merchantOffline: true/,
    '商家图层失败必须立可见态');
  assert.match(js, /this\.setData\(\{ merchantOffline: false \}\)/,
    '成功要清掉失败态');
  assert.doesNotMatch(js, /!res\.data\.length\) \{\s*\n\s*\/\/[^\n]*\n\s*this\.setData\(\{ merchantOffline: true/,
    '200 + 空列表是「这一带没有店」,不是失败');
  assert.match(WXML(), /poiOffline \|\| merchantOffline/, '两种离线共用同一条横幅');
  assert.match(js, /onPoiRetry\(\) \{[\s\S]{0,320}?_fetchNearbyMerchants\(this\._c\)/,
    '横幅重试必须把两个图层都重拉,不能留下另一半永远卡着');
});
