// [C8-05 / FIX-WEATHER] 天气、场地原因取消:主办方在「我的项目」取消场次或主题并全额退款。
// 9-18 拍板:发起前的确认要写明「将给 N 位已付款玩家全额退款，不可撤销」—— N 由后端预览接口算,
// 拿不到就不弹确认、不发取消(宁可什么都不发生,也不能让主办方在不知道退多少人的情况下点下去)。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getDangerAction } = require('../../utils/danger-actions.js');

const PAGE = '../../subpackageA/pages/myproject/index.js';

let sent = [];
let toasts = [];
let pageConfig = null;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (p) => { sent.push(p); },
  getUserID: () => 1,
  getToken: () => '',
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
});
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  showToast: (o) => { toasts.push(o && o.title); },
  showLoading: () => {},
  hideLoading: () => {},
  showModal: (o) => { if (o.success) o.success({ confirm: true }); },
  navigateTo: () => {},
  redirectTo: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  nextTick: (f) => f(),
  setNavigationBarColor: () => {},
  setNavigationBarTitle: () => {},
};
global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  sent = [];
  toasts = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage(scope) {
  const inst = Object.assign({}, pageConfig);
  inst.data = JSON.parse(JSON.stringify(pageConfig.data));
  inst.setData = function (patch) { Object.assign(inst.data, patch); };
  inst.data.operationScope = scope || '';
  const dialogs = {};
  inst.selectComponent = (id) => {
    if (!dialogs[id]) {
      dialogs[id] = {
        opened: [], states: [],
        open(key, params) { this.opened.push({ key, params }); return true; },
        busyOn() { this.states.push('busy'); },
        done() { this.states.push('done'); },
        failed(t) { this.states.push('failed:' + t); },
      };
    }
    return dialogs[id];
  };
  inst.dialogs = dialogs;
  inst.reload = () => {};
  return inst;
}

function row(overrides) {
  return Object.assign({
    id: 301, bizType: 'activity', title: '外滩夜行', state: 'running',
    ownerType: 'member', signupCount: 2, viewCount: 1,
  }, overrides);
}

function loadRows(page, tab, rows) {
  page.setData({ typeTab: tab });
  page.loadProjects();
  sent.shift().success({ code: '200', data: { rows: rows, total: rows.length } });
}

test('商家主办场次:取消前先问后端人数,确认框写明「将给 N 位已付款玩家全额退款，不可撤销」', () => {
  const page = makePage('MERCHANT');
  page.cancelActivity({ currentTarget: { dataset: { id: 301, title: '外滩夜行' } } });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/activity/cancel_preview');
  assert.deepEqual(sent[0].data, { id: 301, scope: 'MERCHANT' });
  assert.equal(page.dialogs['#dcCancel'], undefined, '人数没回来之前不得弹确认');

  sent[0].success({ code: '200', data: { paidPlayers: 3 } });
  const opened = page.dialogs['#dcCancel'].opened[0];
  assert.equal(opened.key, 'activity.cancel-refund');
  const action = getDangerAction(opened.key, opened.params);
  const text = [action.title, action.content].concat(action.consequences.map((c) => c.text)).join('\n');
  assert.match(text, /将给 3 位已付款玩家全额退款/);
  assert.match(text, /不可撤销/);
});

test('人数拿不到就不弹确认、不发取消', () => {
  const page = makePage('MERCHANT');
  page.cancelActivity({ currentTarget: { dataset: { id: 301, title: '外滩夜行' } } });
  sent[0].success({ code: 500, msg: '当前岗位没有这个权限' });

  assert.equal(page.dialogs['#dcCancel'], undefined);
  assert.equal(sent.length, 1, '不得继续发取消请求');
  assert.ok(toasts.some((t) => String(t).indexOf('当前岗位没有这个权限') >= 0), JSON.stringify(toasts));
});

test('个人/商家主办的主题卡可以「取消并退款」,俱乐部主题不给(走俱乐部结束主题)', () => {
  const page = makePage('MERCHANT');
  loadRows(page, 'topic', [
    row({ id: 42, bizType: 'topic', ownerType: 'member', state: 'running' }),
    row({ id: 43, bizType: 'topic', ownerType: 'club', state: 'running' }),
  ]);
  assert.equal(page.data.list[0]._canCancel, true);
  assert.equal(page.data.list[1]._canCancel, false);
});

test('主题取消:预览人数 → 确认框写明 N → 确认后调 /api/topic/cancel 带 scope 和原因', () => {
  const page = makePage('MERCHANT');
  page.setData({ opsSheet: { show: true, id: 42, biz: 'topic', title: '城市夜跑', canCancel: true } });
  page.onOpsPick({ currentTarget: { dataset: { k: 'cancel' } } });

  assert.equal(sent[0].url, '/api/topic/cancel_preview');
  assert.deepEqual(sent[0].data, { id: 42, scope: 'MERCHANT' });
  sent[0].success({ code: '200', data: { paidPlayers: 5 } });

  const dc = page.dialogs['#dcCancelTopic'];
  assert.equal(dc.opened[0].key, 'topic.cancel-refund');
  const action = getDangerAction(dc.opened[0].key, dc.opened[0].params);
  const text = [action.title, action.content].concat(action.consequences.map((c) => c.text)).join('\n');
  assert.match(text, /将给 5 位已付款玩家全额退款/);
  assert.match(text, /不可撤销/);

  page.onConfirmCancelTopic({ detail: { params: dc.opened[0].params } });
  const req = sent[1];
  assert.equal(req.url, '/api/topic/cancel');
  assert.equal(req.data.id, 42);
  assert.equal(req.data.scope, 'MERCHANT');
  assert.ok(req.data.reason && req.data.reason.trim(), '后端要求原因非空,会展示给已付款玩家');
  req.success({ code: '200', msg: '主题已取消,已为 5 笔订单全额退款' });
  assert.deepEqual(dc.states, ['busy', 'done']);
});
