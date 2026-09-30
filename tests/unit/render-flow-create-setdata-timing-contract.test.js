// 渲染层「Framework inner error」创建期时序合同(2026-09-15)
//
// 现象(用户开发者工具 console 实拍,pages/coop/list/index):
//   [渲染层错误] Framework inner error (expect FLOW_INITIAL_CREATION end but get FLOW_CREATE_NODE)
//   [渲染层错误] (expect END descriptor with depth 0 but get FLOW_DATA_OBSERVER)
//
// 机理(读开发者工具内置框架源码坐实,不是猜):
//   · 页面创建时,数据线程开一个 FLOW_INITIAL_CREATION 的 operationFlow,创建根组件,
//     最后压入 end 标记再收口(见 devtools app.asar 的 doDataThreadInitCreation)。
//     页面 onLoad/onShow 就在这个流程内被同步调用。
//   · 该流程收口前,任何一次**真改变数据**的 setData 都在流程里留下步骤:
//       - 翻转 wx:if / 新建自定义组件节点 → 步骤 FLOW_CREATE_NODE;
//       - 改到带 observers 的子组件属性 → 观察者驱动的更新以 FLOW_DATA_OBSERVER
//         压进**当前活动流程**(updateValues 里 typeof 观察者边界为 number 那一支)。
//   · 流程收口时若队列里还排着这两种步骤,渲染层即抛上面两条 —
//     所以「创建期同步 setData」就是这一类报错的页面侧根因。
//
// 本页命中点(唯一页面自有创建期 setData):
//   pages/coop/list/index.js onLoad():?tab=sent 时同步 setData({tab:1, tabKey:'1'}) —
//   tab 翻转 wx:if 分支(FLOW_CREATE_NODE),tabKey 改 cy-tabs 的 active 属性、
//   触发其 observers('tabs, active') 同步 setData(FLOW_DATA_OBSERVER)。两条签名一一对上。
//   入口是活的:pages/club/detail/index.js:743/2879 两处 navigateTo('...?tab=sent')。
//
// 合同:onLoad 在创建流程内必须零 setData;tab 初值延到 wx.nextTick 再写,语义不变。
// 手势路径(onTabChange/switchToReceived)不在创建流程内,必须保持同步写(不许一起被延后)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const PAGE = 'pages/coop/list/index.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadPage(mutate) {
  let source = read(PAGE);
  if (mutate) {
    const changed = mutate(source);
    assert.ok(changed !== source, '负控锚点失效:生产源码未命中');
    source = changed;
  }
  let definition;
  const nextTicks = [];
  const requests = [];
  const app = {
    globalData: {}, getUserID: () => 1,
    sendRequest(o) { requests.push(o); },
  };
  const file = path.join(ROOT, PAGE);
  vm.runInNewContext(source, {
    Page: (p) => { definition = p; },
    getApp: () => app,
    wx: {
      stopPullDownRefresh() {},
      navigateTo() {},
      // 真机/工具里 wx.nextTick 的下一次时间片由框架跑;测试里手动收口,才能断言「延后」。
      nextTick(cb) { nextTicks.push(cb); },
    },
    setTimeout() {}, clearTimeout() {}, console,
    require(id) {
      if (id.includes('/toast')) return () => {};
      if (id.includes('/modal')) return { show: (o) => o.success({ confirm: true, content: '' }) };
      if (id.includes('/loading')) return { show() {}, hide() {} };
      if (id.includes('/merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (id.includes('checkout')) return {};
      return require(path.resolve(path.dirname(file), id));
    },
  });
  const syncWrites = [];
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { syncWrites.push(patch); Object.assign(this.data, patch); },
  });
  return {
    page, nextTicks, requests, syncWrites,
    runNextTicks() { while (nextTicks.length) nextTicks.shift()(); },
  };
}

// 创建期(createFlow)里跑一段页面生命周期,返回这段里发生过的同步 setData
function setDataInsideCreateFlow(harness, fn) {
  harness.syncWrites.length = 0;
  fn();
  return harness.syncWrites.slice();
}

test('RED/GREEN:?tab=sent 进页,onLoad 创建期内零 setData,nextTick 后才落地 tab/tabKey', () => {
  const h = loadPage();
  const during = setDataInsideCreateFlow(h, () => h.page.onLoad({ tab: 'sent' }));
  assert.deepEqual(during, [], 'onLoad 在 FLOW_INITIAL_CREATION 流程内同步 setData,正是两条渲染层报错的配方');
  assert.equal(h.nextTicks.length, 1, '?tab=sent 必须把初值写入排到下一时间片(一次就够)');
  assert.equal(h.page.data.tab, 0, 'nextTick 之前不许提前改 tab');
  assert.equal(h.page.data.tabKey, '0', 'nextTick 之前不许提前改 tabKey');
  h.runNextTicks();
  assert.equal(h.page.data.tab, 1, '延后写入丢了 ⇒ ?tab=sent 打开的还是「收到的」');
  assert.equal(h.page.data.tabKey, '1', 'tab 与 tabKey 必须一起落地(cy-tabs 靠 tabKey 高亮)');
});

test('零回归:无参 / 未知 tab 参数不排队、不写,落到默认「收到的」', () => {
  const plain = loadPage();
  const duringPlain = setDataInsideCreateFlow(plain, () => plain.page.onLoad());
  assert.deepEqual(duringPlain, []);
  assert.equal(plain.nextTicks.length, 0, '没有 ?tab=sent 就不该多排一拍');
  assert.equal(plain.page.data.tab, 0);
  assert.equal(plain.page.data.tabKey, '0');

  const pool = loadPage();
  pool.page.onLoad({ tab: 'pool' });
  assert.equal(pool.nextTicks.length, 0, '已删的 ?tab=pool 不该复活成延时分支');
  assert.equal(pool.page.data.tab, 0);

  // 2026-09-16:候选池页下线后新增 ?tab=received(scoped)入口,同样只允许延后写
  const received = loadPage();
  const duringReceived = setDataInsideCreateFlow(received, () => received.page.onLoad({ tab: 'received', scope: 'MERCHANT' }));
  assert.deepEqual(duringReceived, [], '?tab=received 不得在创建期同步写');
  received.runNextTicks();
  assert.equal(received.page.data.tab, 0, '?tab=received 的落点仍是默认「收到的」');
  assert.equal(received.page._operationScope, 'MERCHANT', 'scope 必须随入口落地,写动作按 owner 口径');
});

test('零回归:手势路径(onTabChange/switchToReceived)保持同步写,不许被一起延后', () => {
  const h = loadPage();
  h.page.onTabChange({ detail: { key: '1' } });
  assert.equal(h.page.data.tab, 1, '点 tab 要立刻响应(此时没有创建流程,同步写是安全的)');
  assert.equal(h.page.data.tabKey, '1');
  assert.equal(h.nextTicks.length, 0, '手势路径不得改走 nextTick');

  h.page.switchToReceived();
  assert.equal(h.page.data.tab, 0, '「去收到的确认」要立刻切回收件箱');
  assert.equal(h.page.data.tabKey, '0');
});

test('源码合同:onLoad 的 setData 必须包在 wx.nextTick 里(唯一页面自有创建期写)', () => {
  const js = read(PAGE);
  const start = js.indexOf('onLoad(options) {');
  assert.ok(start >= 0, '缺少 onLoad 锚点');
  const end = js.indexOf('\n  },', start);
  assert.ok(end > start, '缺少 onLoad 区块终点');
  const body = js.slice(start, end);
  assert.match(body, /wx\.nextTick\(\(\)\s*=>\s*this\.setData\(/, 'onLoad 里找不到「nextTick 包裹 setData」');
  // 该块里除延后写之外不得再有裸 setData(裸写 = 又回到创建流程里)
  const bare = body.replace(/wx\.nextTick\(\(\)\s*=>\s*this\.setData\([^)]*\)\);/g, '');
  assert.doesNotMatch(bare, /this\.setData\s*\(/, 'onLoad 里出现了没被 nextTick 包住的 setData');
});

test('负控①:把 onLoad 改回同步 setData,创建期零写门禁必须真红', () => {
  const h = loadPage((s) => s.replace(
    /wx\.nextTick\(\(\)\s*=>\s*this\.setData\(\{ tab: 1, tabKey: '1' \}\)\);/,
    "this.setData({ tab: 1, tabKey: '1' });"));
  const during = setDataInsideCreateFlow(h, () => h.page.onLoad({ tab: 'sent' }));
  assert.ok(during.length > 0, '负控失效:门禁抓不到同步 setData');
  assert.equal(during[0].tab, 1);
  assert.equal(during[0].tabKey, '1');
});

test('负控②:把 ?tab=sent 分支改瞎,落地断言必须真红', () => {
  const h = loadPage((s) => s.replace(
    "if (options && options.tab === 'sent') {",
    "if (options && options.tab === 'sent-never') {"));
  h.page.onLoad({ tab: 'sent' });
  h.runNextTicks();
  assert.equal(h.page.data.tab, 0, '负控失效:删掉写入后 tab 竟仍是 1');
  assert.equal(h.nextTicks.length, 0, '负控失效:删掉写入后仍排队');
});

test('负控③:误把手势路径也改成 nextTick,同步响应门禁必须真红', () => {
  const h = loadPage((s) => s.replace(
    'onTabChange(e) { this.setData({ tab: Number(e.detail.key), tabKey: e.detail.key }); }',
    'onTabChange(e) { wx.nextTick(() => this.setData({ tab: Number(e.detail.key), tabKey: e.detail.key })); }'));
  h.page.onTabChange({ detail: { key: '1' } });
  assert.equal(h.page.data.tab, 0, '负控失效:被延后了却已经切过去');
  assert.equal(h.nextTicks.length, 1, '负控失效:手势路径没有被改走 nextTick');
});
