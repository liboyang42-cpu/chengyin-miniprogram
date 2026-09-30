/**
 * CU-M-81(2026-09-24 走查)· 漫游落点显示地址,但商家没有可用地图坐标。
 *
 * 走查现象:AI 店铺角色页的「漫游落点」显示「上海市黄浦区咖啡」,像已经设好了落点;
 * 同一商家库里的 location_lat / location_lng 都是 NULL(location_verified=0)。
 * 原实现 storePointText 的唯一判据是 address 字符串,接口已下发的坐标被无视 ——
 * 生产存量商家「有地址、零坐标」是常态(见 pages/merchant/apply/index.js 的注释),
 * 于是每个这样的商家都看到一个看着像已设、实际落不下去的落点。
 *
 * 修复:按 locationLat/locationLng 判;选点成功后从后端回读,显示的必须是服务端确实存下来的那份。
 * 负控在测试内联:把判据改回 address 字符串,同一条断言必须真红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const JS_PATH = 'pages/merchant/decor/ai-npc/index.js';
const PAGE_JS = fs.readFileSync(path.join(ROOT, JS_PATH), 'utf8');

const tick = () => new Promise((resolve) => setImmediate(resolve));

function loadPage(source) {
  let definition = null;
  const requests = [];
  const noop = () => {};
  const app = {
    globalData: {},
    sendRequest(o) { requests.push(o); },
    getUploadClient: () => ({ uploadAll: noop }),
  };
  const file = path.join(ROOT, JS_PATH);
  vm.runInNewContext(source, {
    Page: (value) => { definition = value; },
    getApp: () => app,
    wx: {},
    console,
    setTimeout: noop,
    clearTimeout: noop,
    require(id) {
      if (id.includes('/toast')) return Object.assign(noop, { success: noop });
      if (id.includes('/merchant-theme')) return { merchantPageShow: noop, merchantPageRestore: noop };
      return require(path.resolve(path.dirname(file), id));
    },
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.keys(patch).forEach((key) => { this.data[key] = patch[key]; });
      if (typeof callback === 'function') callback();
    },
  });
  return { page, requests };
}

function profileRequest(requests) {
  const request = requests.find((r) => r.url === '/api/merchant/coop-profile');
  assert.ok(request, '落点状态必须读一次 /api/merchant/coop-profile');
  return request;
}

test('有地址、零坐标:不许把地址当落点(存量商家的常态)', async () => {
  const { page, requests } = loadPage(PAGE_JS);
  page._loadStorePoint();
  profileRequest(requests).success({
    code: 200,
    data: { address: '上海市黄浦区咖啡', locationLat: null, locationLng: null, locationVerified: 0 },
  });
  await tick();
  assert.equal(page.data.storePointText, '尚未选择地图位置');
});

test('坐标齐、地址也在:显示地址', async () => {
  const { page, requests } = loadPage(PAGE_JS);
  page._loadStorePoint();
  profileRequest(requests).success({
    code: 200, data: { address: '上海市黄浦区咖啡', locationLat: 31.23, locationLng: 121.47, locationVerified: 1 },
  });
  await tick();
  assert.equal(page.data.storePointText, '上海市黄浦区咖啡');
});

test('坐标齐但地址为空:仍算已选点,不回落到「尚未选择」', async () => {
  const { page, requests } = loadPage(PAGE_JS);
  page._loadStorePoint();
  profileRequest(requests).success({ code: 200, data: { address: '', locationLat: 31.23, locationLng: 121.47 } });
  await tick();
  assert.equal(page.data.storePointText, '已选择地图位置');
});

test('读不到档案:落点文案退回「尚未选择」,不许保持已设置的假象', async () => {
  const { page, requests } = loadPage(PAGE_JS);
  page.data.storePointText = '上海市黄浦区咖啡';
  page._loadStorePoint();
  profileRequest(requests).fail({});
  await tick();
  assert.equal(page.data.storePointText, '尚未选择地图位置');
});

test('页面初值就是「尚未选择地图位置」,不先摆一个像已设置的样子', () => {
  const { page } = loadPage(PAGE_JS);
  assert.equal(page.data.storePointText, '尚未选择地图位置');
});

test('选点成功后回读落点状态,而不是就地相信选点回调', () => {
  assert.match(PAGE_JS, /wx\.chooseLocation\(\{[\s\S]*?\.then\(\(\) => this\._loadStorePoint\(\)\)/,
    '保存成功后必须重新读服务端状态(落库的是经纬度)');
});

test('负控:判据改回 address 字符串时必须判红', async () => {
  const regressed = PAGE_JS.replace(
    "storePointText: hasPoint ? (profile.address || '已选择地图位置') : STORE_POINT_UNSET,",
    "storePointText: profile.address || '选择地图位置',"
  );
  assert.notEqual(regressed, PAGE_JS, '负控锚点失效:落点判据已改名,扫描口径需同步');
  const { page, requests } = loadPage(regressed);
  page._loadStorePoint();
  profileRequest(requests).success({ code: 200, data: { address: '上海市黄浦区咖啡', locationLat: null, locationLng: null } });
  await tick();
  assert.throws(() => assert.equal(page.data.storePointText, '尚未选择地图位置'), assert.AssertionError);
  assert.equal(page.data.storePointText, '上海市黄浦区咖啡');
});
