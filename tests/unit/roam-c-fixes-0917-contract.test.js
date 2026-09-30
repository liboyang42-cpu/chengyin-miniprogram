'use strict';
// C 组拍板实施契约(2026-09-17):漫游 C-12(打卡不存在失败态 + 距离不够按钮不可用)、
// C-13(已发现地点按账号存服务端,前端合并 found)、C-16(切号/重开后浮层清场)。
// 每条先钉住「修复后的行为」,撤掉修复即判红。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_MODULE = '../../pages/roam/index.js';
const ROAM_WXML = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.wxml'), 'utf8');

let requests;
let toasts;

global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  getUserID: () => '9',
  isDevEnv: () => false,
  sendRequest: (request) => { requests.push(request); },
});
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  showLoading() {},
  hideLoading() {},
  showToast: (value) => { toasts.push(value); },
};

function loadRoamPage() {
  let definition;
  const previous = { Page: global.Page };
  try {
    global.Page = (config) => { definition = config; };
    delete require.cache[require.resolve(PAGE_MODULE)];
    require(PAGE_MODULE);
  } finally {
    global.Page = previous.Page;
  }
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  page.setData = function (patch, cb) {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.split('.');
      let cursor = this.data;
      parts.slice(0, -1).forEach((part) => {
        const arrayMatch = /^(\w+)\[(\d+)\]$/.exec(part);
        if (arrayMatch) {
          const list = cursor[arrayMatch[1]] || (cursor[arrayMatch[1]] = []);
          cursor = list[Number(arrayMatch[2])] || (list[Number(arrayMatch[2])] = {});
        } else {
          if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
          cursor = cursor[part];
        }
      });
      cursor[parts[parts.length - 1]] = value;
    });
    if (cb) cb();
  };
  return page;
}

const HERE = { lat: 31.230416, lng: 121.473701 };
const at = (m) => ({ lat: HERE.lat + m / 111320, lng: HERE.lng });
const tick = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  requests = [];
  toasts = [];
});

/* ============ C-12 打卡不存在失败态 ============ */

test('C-12 距离不够时不发请求、不开打卡卡,只在按钮上提示还差多远', () => {
  const page = loadRoamPage();
  page._player = HERE;
  page._pois = [{ id: 'shop-1', name: '远处的店', cat: 'merchant', state: 'seen', ...at(400) }];
  page.data.nearbyPois = [{ id: 'shop-1', name: '远处的店', distM: 400 }];

  page.startVisit('shop-1');

  assert.equal(page.data.visit.active, false, '距离不够不许开出打卡卡(更不许开出会失败的卡)');
  assert.equal(requests.length, 0, '距离不够不发打卡请求');
  assert.match(toasts[0].title, /还差 \d+ 米/, '必须提示还差多少米');
  assert.equal(page.data.nearbyPois[0].canCheckin, false, '打卡按钮必须置为不可用');
  assert.ok(page.data.nearbyPois[0].gapM > 0);
});

test('C-12 走近到可打卡半径内后按钮恢复可用,点击照常发请求', () => {
  const page = loadRoamPage();
  page._player = HERE;
  page._roamSid = 88;
  page._pois = [{ id: 'shop-1', name: '近处的店', cat: 'merchant', state: 'seen', regId: 33, ...at(30) }];
  page.data.nearbyPois = [{ id: 'shop-1', name: '近处的店', distM: 30 }];

  page.startVisit('shop-1');

  assert.equal(page.data.visit.active, true, '可打卡距离内必须正常开卡');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/roam/shop/visit');
});

test('C-12 打卡真失败(服务端拒/网络断)不留失败浮卡,只收起卡并提示', async () => {
  const page = loadRoamPage();
  page._player = HERE;
  page._apiShopVisit = () => Promise.resolve({ ok: false, reason: 'server', msg: '还没到该店附近' });
  page._triggerCelebration = () => {};
  page._syncGoal = () => {};
  page.data.visit = { active: true, checkinOk: false, poi: { id: 'shop-1', name: '店' }, photos: [] };

  const ok = await page._sendCheckin({ id: 'shop-1', name: '店' });

  assert.equal(ok, false);
  assert.equal(page.data.visit.active, false, '失败必须收起打卡卡,不许留失败态');
  assert.equal(page.data.visit.checkinErr, undefined, '失败态字段已随拍板删除');
  assert.match(toasts[0].title, /还没到该店附近/);
});

test('C-12 照片不参与审核:打卡失败时照片仍留在本次足迹', async () => {
  const page = loadRoamPage();
  page._apiShopVisit = () => Promise.resolve({ ok: false, reason: 'net' });
  page._appendSessionPhoto = (photo, name) => { page._kept = (page._kept || []).concat([{ photo, name }]); };
  page._syncGoal = () => {};
  page.data.visit = { active: true, checkinOk: false, poi: { id: 'shop-1', name: '店' }, photos: [{ path: '/tmp/a.jpg', persisted: true }] };

  await page._sendCheckin({ id: 'shop-1', name: '店' });

  assert.equal(page._kept.length, 1, '照片不参与审核,打卡失败也不许丢');
  assert.equal(page._kept[0].photo.path, '/tmp/a.jpg');
});

test('C-12 失败浮卡与重试入口从模板里彻底删除', () => {
  assert.doesNotMatch(ROAM_WXML, /visit\.checkinErr/, '探店卡不许再有失败文案位');
  assert.doesNotMatch(ROAM_WXML, /visit\.checkinRetryable/, '探店卡不许再有失败重试位');
  assert.doesNotMatch(ROAM_WXML, /bindtap="retryCheckin"/, 'retryCheckin 入口必须删除');
});

/* ============ C-13 已发现地点按账号存服务端 ============ */

test('C-13 服务端 found=true 的地点在换设备/清缓存后仍然点亮(不再回到迷雾)', async () => {
  const page = loadRoamPage();
  page._nearbyReady = Promise.resolve();
  page._pois = [];
  page._seenSweepHistory = () => {};
  page._genIcons = () => Promise.resolve();
  page._syncGoal = () => {};
  page._syncMarkers = () => {};
  page._syncSparkCircles = () => {};
  page._resolveNearbyReady = () => {};

  page._fetchRoamPois(HERE);
  await tick();
  assert.equal(requests.length > 0, true, '应发起 /api/roam/pois');
  requests[0].success({
    code: '200',
    data: [
      { id: 1, name: '已发现的地标', type: 1, lat: HERE.lat, lng: HERE.lng, xp: 20, found: true },
      { id: 2, name: '没发现的地标', type: 1, lat: HERE.lat, lng: HERE.lng, xp: 20, found: false },
    ],
  });
  await tick();

  const found = page._pois.find((p) => p._roamId === 1);
  const unseen = page._pois.find((p) => p._roamId === 2);
  assert.equal(found.state, 'passed', '服务端 found 必须直接投影成已点亮(不再只看本机会话)');
  assert.equal(found.first, false, '已发现过的点不该再弹首次发现');
  assert.equal(unseen.state, 'fog');
  assert.equal(unseen.first, true);
});

/* ============ C-16 切号/重开后浮层清场 ============ */

test('C-16 切号/重新开始漫游时上一轮浮层全部退场', () => {
  const page = loadRoamPage();
  const overlay = {
    visit: { active: true, checkinOk: true, poi: { id: 1 }, photos: [{ path: '/tmp/a.jpg' }] },
    nearbyBanner: { show: true },
    nearbyPois: [{ id: 1 }],
    nearbyIdx: 2,
    paceCard: { show: true, title: 't', body: 'b', demo: false },
    medal: { show: true },
    discoverReward: { show: true, poi: { name: 'x' } },
    camOpen: true,
    topicView: { id: 1 },
    checkinView: { id: 1 },
    multiView: { count: 2 },
    runnerView: { memberId: 9 },
    shopStrip: { rows: [{ id: 1 }], idx: 0 },
  };
  Object.entries(overlay).forEach(([key, value]) => { page.data[key] = value; });
  page._cancelShareWork = () => {};
  page._pendingDiscover = { show: true };

  page._resetRoamRecoverySession();

  assert.equal(page.data.visit.active, false, 'visit 打卡卡必须清');
  assert.deepEqual(page.data.visit.poi, {});
  assert.deepEqual(page.data.visit.photos, []);
  assert.equal(page.data.nearbyBanner.show, false);
  assert.deepEqual(page.data.nearbyPois, []);
  assert.equal(page.data.nearbyIdx, 0);
  assert.equal(page.data.paceCard.show, false);
  assert.equal(page.data.medal.show, false);
  assert.equal(page.data.discoverReward.show, false);
  assert.equal(page.data.camOpen, false, '取景卡必须清');
  assert.equal(page.data.topicView, null);
  assert.equal(page.data.checkinView, null);
  assert.equal(page.data.multiView, null);
  assert.equal(page.data.runnerView, null);
  assert.deepEqual(page.data.shopStrip.rows, []);
  assert.equal(page._pendingDiscover, null, '攒着的首次发现卡也不许在下一轮补弹');
});
