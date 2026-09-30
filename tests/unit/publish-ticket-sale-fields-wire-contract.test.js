// FIX-P2-26:发布页票种的「售票开始/结束」上送口径。
//
// 病:售票时间是 date 选择器给的纯日期串('YYYY-MM-DD'),后端 ActivityTicketRequest 的新字段
// 与 startTime/endTime 同口径(@JsonFormat "yyyy-MM-dd HH:mm:ss",GMT+8),不补全时分秒直接 400 ——
// 「填了就丢」修完会变成「填了就发不出去」。
// 本文件钉住发布入口上送前都把售票时间归一成完整时间串,开关布尔保持真 boolean。
// (入口曾有两个;简易页的孤儿发布链随 2026-09 审查 #14 删除,现在只剩 fabu 一条,见文件末尾的负向钉。)
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FABU = '../../pages/publish/fabu/index.js';
const SIMPLE = '../../pages/publish/simple/index.js';

let sent = [];
let storage = {};

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (p) => { sent.push(p); },
  tips: () => {},
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  chooseImage: () => {},
  getUserID: () => 0,
  getUserInfo: () => null,
  getToken: () => '',
  getAuthorization: () => 'token',
});
global.wx = {
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  showModal: (o) => { if (o.success) o.success({ confirm: true }); },
  navigateTo: () => {}, redirectTo: () => {},
  createMapContext: () => ({ getCenterLocation: () => {} }),
  pageScrollTo: () => {}, nextTick: (f) => f(),
};

let pageConfig = null;
global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  sent = [];
  storage = {};
  pageConfig = null;
});

function makePage(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  const inst = Object.assign({}, pageConfig);
  inst.data = JSON.parse(JSON.stringify(pageConfig.data));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let o = inst.data;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      o[parts[parts.length - 1]] = patch[k];
    });
    if (cb) cb();
  };
  return inst;
}

test('专业版新建:售票时间补全为完整时间串,布尔与集合点地址原样上送', () => {
  const page = makePage(FABU);
  page.onLoad({});
  sent = [];
  page.data.formData.tickets = [{
    name: '早鸟票', price: 69, totalStock: 100, mode: 1,
    meetingPoint: '人民广场', meetingPointAddress: '上海市黄浦区人民大道 1 号',
    startTime: '2026-10-01', endTime: '2026-10-01',
    saleStartTime: '2026-09-18', saleEndTime: '2026-09-25',
    refundSupported: false, syncWithTheme: true
  }];

  page._doSubmit();

  const req = sent.find((r) => r.url === '/api/topic/create');
  assert.ok(req, '新建必须走到 /api/topic/create');
  const ticket = JSON.parse(req.data).tickets[0];
  assert.equal(ticket.saleStartTime, '2026-09-18 00:00:00',
    '纯日期串必须补 00:00:00,否则后端 @JsonFormat 直接 400');
  assert.equal(ticket.saleEndTime, '2026-09-25 23:59:59', '售票结束补 23:59:59');
  assert.equal(ticket.meetingPointAddress, '上海市黄浦区人民大道 1 号', '集合点地址必须原样上送');
  assert.equal(ticket.refundSupported, false, '布尔必须保持 boolean(后端用 Boolean 接)');
  assert.equal(ticket.syncWithTheme, true);
});

test('专业版:售票时间没填时上送 null,不许拼出非法串', () => {
  const page = makePage(FABU);
  page.onLoad({});
  sent = [];
  page.data.formData.tickets = [{
    name: '早鸟票', price: 69, totalStock: 100, mode: 1,
    meetingPoint: '人民广场', startTime: '2026-10-01', endTime: '2026-10-01',
    saleStartTime: '', saleEndTime: ''
  }];

  page._doSubmit();

  const ticket = JSON.parse(sent.find((r) => r.url === '/api/topic/create').data).tickets[0];
  assert.equal(ticket.saleStartTime, null);
  assert.equal(ticket.saleEndTime, null);
});

// 原来这里还有一条「简易版:售票时间同样补全为完整时间串」——
// 2026-09-20 合批撤下:简易页那条「站点编辑 + 预览 + 存草稿 + 直接发布」链路(onPublish/
// buildPayload 等)在 wxml 上零绑定,是纯孤儿代码,随 2026-09 审查 #14 整块删除,
// buildPayload 锚点已不存在。发布口只剩 fabu,上面两条用例钉的就是它。
// 留一条负向钉:孤儿链路不许半截复活(复活了就得重新回答售票时间口径)。
test('简易页不再有 buildPayload(孤儿发布链已随审查 #14 删除)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, SIMPLE), 'utf8');
  assert.doesNotMatch(src, /buildPayload\s*\(/,
    '简易页又长出提交 payload 构造 —— 先回答「这一页到底发不发主题」,再谈补全口径');
});
