// cy-timeline 契约(2026-08-27 新建)
//
// 这个组件唯一的职责是回答「走到哪一站了」。它会骗人的方式只有三种,逐条钉死:
//   ① 状态色映射错位 —— 已拒绝画成绿点,页面照样渲染、零报错,看的人以为通过了。
//   ② 连线取错节点的状态 —— 用自己的状态画线,最后一段会把「还没走到」画成已完成色。
//   ③ 折叠只是视觉隐藏 —— 收起后节点仍在 DOM 里,无障碍读屏会把没展开的内容全念出来。
// 另加两处接入点的阶段映射:club 带队四站、citynode 据点申请四站。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// 被测源码跑在 vm 沙箱里,它造的数组/对象与本进程不同 realm,deepStrictEqual 会
// 因为原型不是同一个而判负。摊平成纯 JSON 再比,比的是值不是身份。
const plain = (value) => JSON.parse(JSON.stringify(value));

const WXSS = 'components/cy/timeline/index.wxss';
const WXML = 'components/cy/timeline/index.wxml';

// ---------------------------------------------------------------- 组件加载

function loadComponent(rel) {
  const abs = path.join(ROOT, rel);
  let captured = null;
  vm.runInNewContext(read(rel), {
    console,
    Component(config) { captured = config; },
    Behavior: (b) => b,
    require: createRequire(abs),
    Date,
    setTimeout,
    clearTimeout,
  }, { filename: abs });
  assert.ok(captured, rel + ' 必须注册 Component');
  return captured;
}

/** 把 Component 配置做成一个能 setData / triggerEvent 的假实例。 */
function instantiate(config, initial) {
  const events = [];
  const instance = Object.assign({}, config.methods, {
    data: Object.assign({}, config.data, initial || {}),
    setData(patch) { Object.assign(instance.data, patch); },
    triggerEvent(name, detail) { events.push({ name, detail }); },
  });
  return { instance, events };
}

// ---------------------------------------------------------------- ① 状态色映射

const STATUS_TOKEN = {
  done: '--cy-color-status-success',
  doing: '--cy-color-status-info',
  rejected: '--cy-color-status-danger',
};

/** 静态检查器:圆点四色映射 + 状态色不许当背景底。被负控用例反过来喂变异源码。 */
function checkStatusColorContract(wxss) {
  Object.keys(STATUS_TOKEN).forEach(function (status) {
    const rule = new RegExp('\\.cyt__dot--' + status + '\\s*\\{[^}]*background:\\s*var\\(' + STATUS_TOKEN[status] + '\\)');
    if (!rule.test(wxss)) throw new Error('圆点状态色映射缺失或错位:' + status + ' 应为 ' + STATUS_TOKEN[status]);
    const line = new RegExp('\\.cyt__line--' + status + '\\s*\\{[^}]*background:\\s*var\\(' + STATUS_TOKEN[status] + '\\)');
    if (!line.test(wxss)) throw new Error('连线状态色映射缺失或错位:' + status);
  });
  // 灰=未开始:必须是中性 token,一旦落到任何 status 色就说明「未开始」被画成了有结论的状态
  if (!/\.cyt__dot--todo\s*\{[^}]*background:\s*var\(--cy-color-text-tertiary\)/.test(wxss)) {
    throw new Error('未开始的圆点必须用中性灰 --cy-color-text-tertiary');
  }
  // 状态色只许出现在 .cyt__dot-- / .cyt__line-- 上;落到别的选择器就是彩色底
  const selectors = wxss.match(/^[^@\n{][^{\n]*\{[^}]*\}/gm) || [];
  selectors.forEach(function (block) {
    const head = block.slice(0, block.indexOf('{'));
    if (/--cy-color-status-(success|info|danger)\b/.test(block)
        && !/\.cyt__(dot|line)--/.test(head)) {
      throw new Error('状态色只能落在圆点/连线上,越界选择器:' + head.trim());
    }
  });
}

test('状态色映射:蓝=进行中 绿=已完成 红=已拒绝 灰=未开始,且只落在圆点与连线上', () => {
  checkStatusColorContract(read(WXSS));
});

test('负控:把「已完成」的绿改成红,检查器必须判红', () => {
  const original = read(WXSS);
  const mutated = original.replace(
    '.cyt__dot--done     { background: var(--cy-color-status-success); }',
    '.cyt__dot--done     { background: var(--cy-color-status-danger); }'
  );
  // 第一行先证明变异真的发生了 —— 否则下面的 throws 可能是别的原因红的
  assert.notEqual(mutated, original, '变异没生效,负控无效');
  assert.match(mutated, /\.cyt__dot--done\s+\{ background: var\(--cy-color-status-danger\); \}/);
  assert.doesNotThrow(() => checkStatusColorContract(original), '干净源码必须判绿');
  assert.throws(() => checkStatusColorContract(mutated), /已完成|映射缺失或错位/);
});

test('负控:把状态色搬到节点底色上,检查器必须判红', () => {
  const original = read(WXSS);
  const mutated = original + '\n.cyt__node--rejected { background: var(--cy-color-status-danger); }\n';
  assert.notEqual(mutated, original, '变异没生效,负控无效');
  assert.doesNotThrow(() => checkStatusColorContract(original));
  assert.throws(() => checkStatusColorContract(mutated), /只能落在圆点\/连线上/);
});

// ---------------------------------------------------------------- ② 归一化与连线

test('buildNodes:未知/缺失状态一律落灰,不许继承上一节点', () => {
  const config = loadComponent('components/cy/timeline/index.js');
  const { instance } = instantiate(config);
  const nodes = instance.buildNodes([
    { title: '集合', status: 'done' },
    { title: '控章', status: 'WHATEVER' },
    { title: '结算' },
  ]);
  assert.deepEqual(plain(nodes.map((n) => n.status)), ['done', 'todo', 'todo']);
  assert.deepEqual(plain(nodes.map((n) => n.statusText)), ['已完成', '未开始', '未开始']);
});

test('buildNodes:连线取【下一个】节点的状态,最后一节点不画线', () => {
  const config = loadComponent('components/cy/timeline/index.js');
  const { instance } = instantiate(config);
  const nodes = instance.buildNodes([
    { title: '一', status: 'done' },
    { title: '二', status: 'doing' },
    { title: '三', status: 'todo' },
  ]);
  // 已完成 → 进行中 这一段应当是「进行中」的蓝,不是上一站的绿
  assert.deepEqual(plain(nodes.map((n) => n.lineStatus)), ['doing', 'todo', 'todo']);
  assert.deepEqual(plain(nodes.map((n) => n.isLast)), [false, false, true]);
});

test('buildNodes:时间戳/说明/尾注原样带出,操作入口只给进行中的那一步', () => {
  const config = loadComponent('components/cy/timeline/index.js');
  const { instance } = instantiate(config);
  const nodes = instance.buildNodes([
    { title: '提交审核', time: '今天 14:11', desc: '等待审核', status: 'doing', action: '补齐资料' },
    { title: '已拒绝', time: '今天 14:12', note: '定价太高', status: 'rejected', action: '不该出现' },
    { title: '空节点' },
  ]);
  assert.equal(nodes[0].time, '今天 14:11');
  assert.equal(nodes[0].desc, '等待审核');
  assert.equal(nodes[0].action, '补齐资料');
  assert.equal(nodes[1].note, '定价太高');
  assert.equal(nodes[1].action, '', '非进行中的节点不给操作入口');
  assert.equal(nodes[2].time, '');
  assert.equal(nodes[2].note, '');
});

test('buildNodes:nodes 不是数组也不能崩', () => {
  const config = loadComponent('components/cy/timeline/index.js');
  const { instance } = instantiate(config);
  assert.deepEqual(plain(instance.buildNodes(null)), []);
  assert.deepEqual(plain(instance.buildNodes(undefined)), []);
});

// ---------------------------------------------------------------- ③ 折叠

test('折叠:收起时节点整块不渲染(wx:if,不是 hidden),尾注带引号', () => {
  const wxml = read(WXML);
  assert.match(wxml, /class="cyt__body"/);
  assert.match(wxml, /wx:if="\{\{!collapsible \|\| _open\}\}"/,
    '折叠必须用 wx:if 摘掉整块;只靠 display:none 的话读屏仍会念出没展开的内容');
  assert.match(wxml, /aria-expanded="\{\{_open\}\}"/, '折叠头必须播报展开态');
  assert.match(wxml, /“\{\{item\.note\}\}”/, '尾部备注(拒绝理由)要带引号显示');
  assert.match(wxml, /\{\{item\.time\}\}/, '每个节点都要能渲染时间戳');
});

test('折叠:onToggle 翻转并向外派 toggle 事件;非折叠模式不响应', () => {
  const config = loadComponent('components/cy/timeline/index.js');
  const open = instantiate(config, { collapsible: true, _open: false });
  open.instance.onToggle();
  assert.equal(open.instance.data._open, true);
  assert.deepEqual(plain(open.events), [{ name: 'toggle', detail: { expanded: true } }]);
  open.instance.onToggle();
  assert.equal(open.instance.data._open, false);

  const fixed = instantiate(config, { collapsible: false, _open: true });
  fixed.instance.onToggle();
  assert.equal(fixed.instance.data._open, true, '不可折叠时点击不该改变展开态');
  assert.deepEqual(plain(fixed.events), []);
});

// ---------------------------------------------------------------- 接入点:club 带队四站

function loadClubPage() {
  const abs = path.join(ROOT, 'pages/club/detail/index.js');
  let captured = null;
  const sandbox = {
    console,
    Page(config) { captured = config; },
    getApp: () => ({ globalData: {}, sendRequest() {} }),
    require: createRequire(abs),
    setTimeout,
    clearTimeout,
    Date,
    wx: new Proxy({}, { get: () => () => ({}) }),
  };
  vm.runInNewContext(read('pages/club/detail/index.js'), sandbox, { filename: abs });
  assert.ok(captured, 'club detail 必须注册 Page');
  return captured;
}

test('club 带队进度:四站按 ownerStage 推进,已走过的置绿、当前站置蓝', () => {
  const page = loadClubPage();
  const call = (stage, data) => {
    const self = Object.assign({}, page, { data: Object.assign({ topics: [], sentInvites: [] }, data) });
    return self.buildLeadTimeline.call(self, stage);
  };
  assert.deepEqual(plain(call('publish').nodes.map((n) => n.status)), ['doing', 'todo', 'todo', 'todo']);
  assert.deepEqual(plain(call('invite').nodes.map((n) => n.status)), ['done', 'doing', 'todo', 'todo']);
  assert.deepEqual(plain(call('pending').nodes.map((n) => n.status)), ['done', 'done', 'doing', 'todo']);
  assert.deepEqual(plain(call('accepted').nodes.map((n) => n.status)), ['done', 'done', 'done', 'done']);
  assert.equal(call('pending').summary, '带队进度 · 等待商家回应');
});

test('club 带队进度:loading/error/admin 不画时间线,而不是画一条全灰的', () => {
  const page = loadClubPage();
  const call = (stage) => {
    const self = Object.assign({}, page, { data: { topics: [], sentInvites: [] } });
    return self.buildLeadTimeline.call(self, stage);
  };
  ['loading', 'error', 'admin', 'unknown'].forEach((stage) => {
    assert.deepEqual(plain(call(stage)), { nodes: [], summary: '' }, stage + ' 不该有时间线');
  });
});

test('club 带队进度:邀请时间戳取最近一次发出的,不是列表首行', () => {
  const page = loadClubPage();
  const self = Object.assign({}, page, {
    data: {
      topics: [{ id: 1 }],
      sentInvites: [
        { status: 1, timeText: '08-20 09:00' },
        { status: 0, timeText: '08-26 18:30' },
        { status: 0, timeText: '08-22 11:00' },
      ],
    },
  });
  const nodes = self.buildLeadTimeline.call(self, 'pending').nodes;
  assert.equal(nodes[1].time, '08-26 18:30');
  assert.equal(nodes[1].desc, '已发出 3 份邀请');
  assert.equal(nodes[2].desc, '2 份等待商家回应');
});

// ---------------------------------------------------------------- 接入点:据点申请四站

function loadCityNodePage() {
  const abs = path.join(ROOT, 'pages/merchant/citynode/create/index.js');
  let captured = null;
  vm.runInNewContext(read('pages/merchant/citynode/create/index.js'), {
    console,
    Page(config) { captured = config; },
    getApp: () => ({ globalData: {}, sendRequest() {} }),
    require: createRequire(abs),
    setTimeout,
    clearTimeout,
    Date,
    wx: new Proxy({}, { get: () => () => ({}) }),
  }, { filename: abs });
  assert.ok(captured, 'citynode create 必须注册 Page');
  return captured;
}

test('据点申请进度:第一个没做完的就是当前站,平台审核只在提交后才亮', () => {
  const page = loadCityNodePage();
  const run = (data, times) => {
    const self = Object.assign({}, page, {
      data: Object.assign({ tpl: null, addressConfirmed: false, submittedApplicationId: null }, data),
      _stepTimes: times || {},
      setData(patch) { Object.assign(self.data, patch); },
    });
    self.refreshNodeTimeline.call(self);
    return self.data.nodeTimeline;
  };
  assert.deepEqual(plain(run({}).map((n) => n.status)), ['doing', 'todo', 'todo', 'todo']);
  assert.deepEqual(plain(run({ tpl: { id: 9 } }).map((n) => n.status)), ['done', 'doing', 'todo', 'todo']);
  assert.deepEqual(plain(run({ tpl: { id: 9 }, addressConfirmed: true }).map((n) => n.status)),
    ['done', 'done', 'doing', 'todo']);
  assert.deepEqual(
    plain(run({ tpl: { id: 9 }, addressConfirmed: true, submittedApplicationId: 77 }).map((n) => n.status)),
    ['done', 'done', 'done', 'doing'],
    '提交之后停在「平台审核 · 进行中」—— 客户端不许把审核结果画成已完成');
});

test('据点申请进度:先确认店址后配玩法,已完成的那站不能被画成未开始', () => {
  const page = loadCityNodePage();
  const self = Object.assign({}, page, {
    // 本页玩法卡与店址卡互相独立,商家完全可以倒着做 —— 这是真实可达的顺序,不是构造的边界。
    data: { tpl: null, addressConfirmed: true, submittedApplicationId: null },
    _stepTimes: { 1: '今天 10:05' },
    setData(patch) { Object.assign(self.data, patch); },
  });
  self.refreshNodeTimeline.call(self);
  assert.deepEqual(plain(self.data.nodeTimeline.map((n) => n.status)),
    ['doing', 'done', 'todo', 'todo'],
    '店址已确认还挂着完成时刻,却被画成未开始 —— 时间线自己打自己的脸');
});

test('据点申请进度:每一站带各自的完成时刻,没做的那站为空', () => {
  const page = loadCityNodePage();
  const self = Object.assign({}, page, {
    data: { tpl: { id: 9 }, addressConfirmed: true, submittedApplicationId: null },
    _stepTimes: { 0: '今天 10:01', 1: '今天 10:05' },
    setData(patch) { Object.assign(self.data, patch); },
  });
  self.refreshNodeTimeline.call(self);
  assert.deepEqual(plain(self.data.nodeTimeline.map((n) => n.time)), ['今天 10:01', '今天 10:05', '', '']);
});

test('据点申请进度:stampStep 只记第一次,重配玩法不覆盖原始完成时刻', () => {
  const page = loadCityNodePage();
  const self = Object.assign({}, page, { data: {}, setData() {} });
  self.stampStep.call(self, 0);
  const first = self._stepTimes[0];
  assert.match(first, /^今天 \d{2}:\d{2}$/);
  self.stampStep.call(self, 0);
  assert.equal(self._stepTimes[0], first);
});
