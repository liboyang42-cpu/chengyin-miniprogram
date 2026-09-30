const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PAGE_PATH = '../../pages/merchant/index/index.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let app;
let pageConfig;
let requests;
let openedScenes;
let closedScenes;

beforeEach(() => {
  requests = [];
  openedScenes = [];
  closedScenes = 0;
  pageConfig = null;
  app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: (request) => requests.push(request),
  };
  global.getApp = () => app;
  global.getCurrentPages = () => [];
  global.wx = {
    scanCode: ({ success }) => success({ result: JSON.stringify({ type: 'topic', code: 'TICKET-1' }) }),
    showLoading() {},
    hideLoading() {},
    showToast() {},
    navigateTo() {},
    reLaunch() {},
  };
  global.Page = (config) => { pageConfig = config; };
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
});

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch) => Object.assign(page.data, patch);
  page.openScene = (id) => openedScenes.push(id);
  page.closeScene = () => { closedScenes += 1; };
  return page;
}

function openTwoStationChoice(page) {
  page.goScanQR();
  assert.equal(requests.length, 1);
  requests[0].success({
    code: 500,
    msg: '请选择要核销的据点',
    data: {
      needStationChoice: true,
      stations: [
        { registrationMerchantId: 701, name: '东门咖啡', validationMethod: 1 },
        { registrationMerchantId: 702, name: '西岸书店', validationMethod: 3 },
      ],
    },
  });
}

test('多据点回执只打开选择面板,不直接取第一站或显示核销成功', () => {
  const page = makePage();

  openTwoStationChoice(page);

  assert.equal(page.data.stationSheet.show, true);
  assert.equal(page.data.stationSheet.items.length, 2);
  assert.deepEqual(openedScenes, ['merchant-station-picker']);
  assert.equal(page.data.verificationResult.show, false,
    'needStationChoice 是未核销态,不能先显示成功结果');
  assert.equal(requests.length, 1,
    '商家尚未点选时不得自动调用选择端点或拿候选第一行核销');
});

test('取消据点选择不发第二次请求,code 仍保持未核销', () => {
  const page = makePage();
  openTwoStationChoice(page);

  page.onStationSheetClose();

  assert.equal(closedScenes, 1);
  assert.equal(requests.length, 1, '取消只关面板,不能调用核销端点');
  assert.equal(page.data.verificationResult.show, false,
    '取消不能把错误回执改写为已核销结果');
});

test('点选后只提交商家明确选择的 registrationMerchantId', () => {
  const page = makePage();
  openTwoStationChoice(page);

  page.onStationPick({ currentTarget: { dataset: { registrationMerchantId: 702 } } });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, '/api/registration/scan_qr_code_station');
  assert.deepEqual(requests[1].data, { code: 'TICKET-1', registrationMerchantId: 702 });
  assert.equal(closedScenes, 1);
  requests[1].success({ code: 200, msg: '核销成功' });
});

test('商家工作台与个人页都按既有选章形态注册据点面板和选择端点', () => {
  const pageJs = read('pages/merchant/index/index.js');
  const pageWxml = read('pages/merchant/index/index.wxml');
  const profileJs = read('components/cy/profile/index.js');
  const profileWxml = read('components/cy/profile/index.wxml');
  const registry = read('utils/scene-registry.js');

  for (const js of [pageJs, profileJs]) {
    assert.match(js, /d\.needStationChoice/);
    assert.match(js, /openStationSheet/);
    assert.match(js, /scan_qr_code_station/);
    assert.match(js, /registrationMerchantId/);
  }
  assert.match(pageWxml, /sceneCurrent\.id === 'merchant-station-picker'/);
  assert.match(pageWxml, /wx:for="\{\{stationSheet\.items\}\}"/);
  assert.match(pageWxml, /bindtap="onStationPick"/);
  assert.match(profileWxml, /sceneCurrent\.id === 'member-station-picker'/);
  assert.match(profileWxml, /wx:for="\{\{stationSheet\.items\}\}"/);
  assert.match(profileWxml, /bindtap="onStationPick"/);
  assert.match(registry, /'merchant-station-picker':\s*\{[^\n]*variant: 'half'/);
  assert.match(registry, /'member-station-picker':\s*\{[^\n]*variant: 'half'/);
});

test('参与详情快捷扫码识别多据点未核销态,不会退化为普通成功提示', () => {
  const js = read('subpackageMember/components/scene-member-participation-detail/index.js');
  assert.match(js, /d\.needChapterChoice\s*\|\|\s*d\.needStationChoice/);
  assert.match(js, /多个章节/);
});
