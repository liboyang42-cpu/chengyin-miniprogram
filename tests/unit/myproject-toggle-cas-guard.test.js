// D6:上/下架按钮 —— 期望态上送(CAS)+ 在途守卫。行为测试,不看源码文本。
//
// 病(2026-08-18 定性):这个接口是**翻转**语义且只收 id,于是
//   ① 这一屏过时(内容安全回调会自动下架)⇒ 照翻转算会做出**反向**动作,还提示「操作成功」;
//   ② 无任何在途守卫,弱网重复点/超时重试 ⇒ 第二次把第一次的结果又翻回去,两次都提示成功。
//
// 承重不变量:
//  - 主题卡必须上送 expectedUserStatus = 渲染这一刻的态(_online),后端据此做 CAS
//  - 活动卡走另一个接口,**不许**塞这个参数
//  - 同一张卡在途时重复点只发一次请求;不同卡互不影响
//  - ★ flag 必须能被归零:success / fail / complete / **同步抛错** / onShow 五条路都要清
//    (本仓栽过「在途 flag 卡住 = 永久死锁,热启动都不自愈」)
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../subpackageA/pages/myproject/index.js';

let sent = [];
let toasts = [];
let throwOnSend = false;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (p) => {
    if (throwOnSend) throw new Error('传输层同步炸了');
    sent.push(p);
  },
  getUserID: () => 1,
  getToken: () => '',
});
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  showToast: (o) => { toasts.push(o && o.title); },
  showLoading: () => {}, hideLoading: () => {},
  showModal: (o) => { if (o.success) o.success({ confirm: true }); },
  navigateTo: () => {}, redirectTo: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  nextTick: (f) => f(),
  setNavigationBarColor: () => {}, setNavigationBarTitle: () => {},
};

let pageConfig = null;
global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  sent = [];
  toasts = [];
  throwOnSend = false;
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const inst = Object.assign({}, pageConfig);
  inst.data = JSON.parse(JSON.stringify(pageConfig.data));
  inst.setData = function (patch) { Object.assign(inst.data, patch); };
  // 只测 toggle,不让它真去拉列表
  inst.loadProjects = function () {};
  inst.loadTemplates = function () {};
  return inst;
}

function tap(id, online, biz) {
  return { currentTarget: { dataset: { id: id, online: online, biz: biz || 'topic' } } };
}

test('主题卡上送 expectedUserStatus = 渲染这一刻的态(已上架 → 1)', () => {
  const page = makePage();
  page.toggleStatus(tap(101, true));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/topic/update_user_status');
  assert.equal(sent[0].data.id, 101);
  assert.equal(sent[0].data.expectedUserStatus, 1,
    '按钮写着「下架」就是因为它现在是已上架,期望态必须如实上送,否则后端 CAS 无从比较');
});

test('未上架的卡上送 expectedUserStatus = 0', () => {
  const page = makePage();
  page.toggleStatus(tap(102, false));

  assert.equal(sent[0].data.expectedUserStatus, 0);
});

test('活动卡走另一个接口,不许塞 expectedUserStatus', () => {
  const page = makePage();
  page.toggleStatus(tap(103, true, 'activity'));

  assert.equal(sent[0].url, '/api/activity/update_publish_status');
  assert.equal('expectedUserStatus' in sent[0].data, false,
    '活动线没有这个参数,乱塞会让它成为一个谁也不读的假字段');
});

test('在途守卫:同一张卡重复点只发一次', () => {
  const page = makePage();
  page.toggleStatus(tap(101, true));
  page.toggleStatus(tap(101, true));
  page.toggleStatus(tap(101, true));

  assert.equal(sent.length, 1, '重复点必须只生效一次,否则第二次会把第一次的结果翻回去');
});

test('在途守卫按 id 记:不同卡互不影响', () => {
  const page = makePage();
  page.toggleStatus(tap(101, true));
  page.toggleStatus(tap(102, false));

  assert.equal(sent.length, 2, '整页一个门闩会让批量上下架变成排队');
});

test('响应回来后 flag 归零,可以再点', () => {
  const page = makePage();
  page.toggleStatus(tap(101, true));
  sent[0].success({ code: '200' });

  page.toggleStatus(tap(101, false));
  assert.equal(sent.length, 2, 'success 之后必须能再点,否则一次操作就把按钮永久锁死');
});

test('失败回来后 flag 也归零', () => {
  const page = makePage();
  page.toggleStatus(tap(101, true));
  sent[0].fail({});

  page.toggleStatus(tap(101, true));
  assert.equal(sent.length, 2, 'fail 不清 flag = 网络抖一下按钮就死了');
});

test('后端 CAS 拒绝(200 以外)也归零,并把「当前是什么态」原样透出', () => {
  const page = makePage();
  page.toggleStatus(tap(101, true));
  sent[0].success({ code: '500', msg: '主题当前是「未上架」，与你点击时看到的不一致，请刷新后重试' });

  assert.ok(toasts.some((t) => t && t.indexOf('未上架') >= 0),
    '拒绝文案要原样给用户,「操作失败」三个字没告诉他该怎么办:' + JSON.stringify(toasts));
  page.toggleStatus(tap(101, true));
  assert.equal(sent.length, 2);
});

// ---------- ★ 防死锁:异常路径 ----------

test('sendRequest 同步抛错 ⇒ flag 仍被归零(不留永久死锁)', () => {
  const page = makePage();
  throwOnSend = true;
  assert.throws(() => page.toggleStatus(tap(101, true)), /传输层同步炸了/);

  // 三个回调一个都没来过。不在 catch 里清就是「按钮从此点不动,热启动都不自愈」。
  throwOnSend = false;
  page.toggleStatus(tap(101, true));
  assert.equal(sent.length, 1, '同步抛错后必须还能再点');
});

test('onShow 无条件归零在途守卫(最后一道防死锁闸)', () => {
  const page = makePage();
  page.toggleStatus(tap(101, true));
  // 回调一个都不来 —— 模拟请求永远悬着 / 页面被顶掉
  assert.equal(sent.length, 1);
  page.toggleStatus(tap(101, true));
  assert.equal(sent.length, 1, '在途期间确实被挡住了(否则下一条断言没有意义)');

  page.onShow();

  page.toggleStatus(tap(101, true));
  assert.equal(sent.length, 2,
    'onShow 必须把 flag 归零:只在回调里清挡不住「回调永远不来」那一类,那正是死锁的形态');
});
