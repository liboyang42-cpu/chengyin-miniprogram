// 旧「承接商家」页下线 · 落点契约(设计文档《商家主页收编_承接商家页下线》§3.2 / §3.4 / §六)
//
// 钉三件事:
//   1. 9 个站内入口都直接生成 canonical,不再产生旧 route —— 兼容壳只给历史链接兜底,
//      不是站内长期导航方案,靠双请求跳转会一直付性能账。
//   2. 旧壳四种 query 各自落到哪里;猜不出目的地时不许瞎猜(猜错=把人送进别人的主页)。
//   3. 旧壳不实现 onShareTimeline。平台只允许朋友圈分享自定义 query、不能自定义 path,
//      落点恒为「用户当时站在哪一页」⇒ 从旧壳发朋友圈 = 持续把旧路径再播出去。
//
// 每条都配负控:把实现改回旧写法,断言必须真红。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('../helpers/ui-sandbox-vm.js'); // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const CANONICAL = '/pages/userinfo/userinfo?userId=88&tab=about';
const LEGACY_ROUTE = '/pages/merchant/profile/index';

/**
 * 在 vm 里跑真页面源码。mutate 用于负控:改一处实现,断言必须跟着红。
 * require 走真实现(不是桩)——落点地址正是本文件要保证的东西,桩掉就成了橡皮图章。
 */
function loadPage(rel, options) {
  const opts = options || {};
  const abs = path.join(ROOT, rel);
  let source = read(rel);
  if (opts.mutate) {
    const next = opts.mutate(source);
    assert.notEqual(next, source, `变异锚点失效:${rel}`);
    source = next;
  }

  const navigations = [];
  const requests = [];
  const toasts = [];
  let config = null;

  const app = Object.assign({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserRole: () => 'merchant',
    getUserType: () => 2,
    getUserID: () => 1,
    setUserRole() {}, setUserType() {},
    getRequestErrorMessage: (_res, fallback) => fallback,
    sendRequest: (request) => requests.push(request),
    tips() {},
  }, opts.app);

  const wx = Object.assign({
    navigateTo: (o) => navigations.push({ method: 'navigateTo', url: o.url }),
    redirectTo: (o) => navigations.push({ method: 'redirectTo', url: o.url }),
    switchTab: (o) => navigations.push({ method: 'switchTab', url: o.url }),
    navigateBack: () => navigations.push({ method: 'navigateBack', url: '' }),
    showToast: (o) => toasts.push(o.title),
    showModal() {}, showActionSheet() {},
    getStorageSync: () => '',
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    setNavigationBarColor() {}, setBackgroundColor() {},
    getLocation() {}, makePhoneCall() {}, openLocation() {}, previewImage() {},
    pageScrollTo() {}, createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) }),
  }, opts.wx);

  const sandbox = {
    getApp: () => app,
    getCurrentPages: () => opts.pageStack || [{}],
    Page: (definition) => { config = definition; },
    Component: () => {},
    require: (id) => require(path.resolve(path.dirname(abs), id)),
    wx,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.runInNewContext(source, sandbox, { filename: rel });
  assert.ok(config, `${rel} 没有注册 Page`);

  const page = Object.assign({}, config, {
    data: JSON.parse(JSON.stringify(config.data)),
    setData(patch, done) {
      Object.keys(patch).forEach((key) => {
        if (key.includes('.')) return;
        this.data[key] = patch[key];
      });
      if (done) done();
    },
  });
  return { page, navigations, requests, toasts, urls: () => navigations.map((n) => n.url) };
}

const tap = (dataset) => ({ currentTarget: { dataset: dataset } });

// ───────────────────────── canonical 生成器本身 ─────────────────────────

test('canonical 只描述主体与落点;主题上下文单独成 contextual deep link', () => {
  const { merchantHomeUrl } = require('../../utils/merchant-home-link.js');
  assert.equal(merchantHomeUrl(88), CANONICAL);
  assert.equal(merchantHomeUrl('88'), CANONICAL);
  // 稳定地址不许混进 topic —— 它会被转发卡片和收藏固化
  assert.equal(merchantHomeUrl(88, {}), CANONICAL);
  assert.equal(
    merchantHomeUrl(88, { topicId: 301, topicName: '苏河湾夜行' }),
    CANONICAL + '&topicId=301&topicName=%E8%8B%8F%E6%B2%B3%E6%B9%BE%E5%A4%9C%E8%A1%8C');
  // 只编码一次:二次编码会让落地页拿到 %25E8...
  assert.doesNotMatch(merchantHomeUrl(88, { topicId: 1, topicName: '夜行' }), /%25/);
  // 有 topicId 没名字时不发空键 —— 地址会被卡片固化,空 topicName= 是永久噪音
  assert.equal(merchantHomeUrl(88, { topicId: 301 }), CANONICAL + '&topicId=301');
  assert.equal(merchantHomeUrl(88, { topicId: 301, topicName: '' }), CANONICAL + '&topicId=301');
  // 没有主体 ID 就没有主页 —— 返回空串让调用方停住,不许拼出半截地址
  assert.equal(merchantHomeUrl(null), '');
  assert.equal(merchantHomeUrl(undefined), '');
  assert.equal(merchantHomeUrl(''), '');
});

// ───────────────────────── 9 个站内入口 ─────────────────────────

test('入口1 俱乐部详情商家卡 → canonical', () => {
  const { page, urls } = loadPage('pages/club/detail/index.js');
  page.goMerchantProfile(tap({ memberid: 88 }));
  assert.deepEqual(urls(), [CANONICAL]);
  // 卡片必须把 memberId 交出来,否则 handler 拿到的永远是 undefined
  // (2026-08-20 重设计:商家卡收进 cy-merchant-card,data-memberid 挂在组件实例上)
  assert.match(read('pages/club/detail/index.wxml'),
    /<cy-merchant-card[^>]*data-memberid="\{\{item\.memberId\}\}"[^>]*bind:tap="goMerchantProfile"/);
});

// 2026-09-17 B-06:原入口2(pricing/partner 的合作方档案 → canonical 商家主页)随该孤儿页
// 整页退役;其余站内入口契约不减。

test('入口3 附近合作商家 → 唯一带主题上下文的 contextual deep link', () => {
  const { page, urls } = loadPage('pages/coop/nearby/index.js');
  page.data.topicId = '301';
  page.data.topicName = '苏河湾夜行';
  page.openMerchant(tap({ memberid: 88 }));
  assert.deepEqual(urls(), [CANONICAL + '&topicId=301&topicName=%E8%8B%8F%E6%B2%B3%E6%B9%BE%E5%A4%9C%E8%A1%8C']);
  assert.match(read('pages/coop/nearby/index.wxml'),
    /bindtap="openMerchant" data-memberid="\{\{item\.memberId\}\}"/);
});

test('入口4 商家关系 → canonical(公开投影的 memberId)', () => {
  const { page, urls } = loadPage('pages/merchant/relation/index.js');
  page.goMerchant(tap({ memberid: 88 }));
  assert.deepEqual(urls(), [CANONICAL]);
  // (2026-08-20 重设计:cy-cell 行换成卡组件,memberId 挂在组件实例上)
  assert.match(read('pages/merchant/relation/index.wxml'),
    /<cy-merchant-card[^>]*data-memberid="\{\{item\.memberId\}\}"[^>]*bind:tap="goMerchant"/);
  // 俱乐部那支不受影响:它的主体本来就是 clubId
  assert.match(read('pages/merchant/relation/index.wxml'),
    /<cy-club-card[^>]*data-id="\{\{item\.id\}\}"[^>]*bind:tap="goClub"/);
});

test('入口5 商家营销不复活旧 profile 假入口', () => {
  const js = read('pages/merchant/marketing/index.js');
  assert.doesNotMatch(js, /action === ['"]review['"]/, '评价死入口不得复活');
  // 2026-09-18 UI-09 按用户稿 p07zJMtMOc1yT1AuLTKtSs 37:2 营销页只留 4 格,「口碑管理」入口删除(用户确认评价管理页暂无入口)
  assert.doesNotMatch(js, /pages\/merchant\/profile\/index/, '营销页不得跳旧承接商家页');
});

test('入口6 商家工作台分享 → 稳定 canonical,不带主题上下文', () => {
  const { page } = loadPage('pages/merchant/index/index.js');
  page.data.merchantInfo = { id: 7, memberId: 88, name: '城市运动装备馆' };
  const share = page.onShareAppMessage({ from: 'menu' });
  assert.equal(share.path, CANONICAL);
  assert.doesNotMatch(share.path, /topicId/, '分享路径会被卡片固化,不许混进当次上下文');

  // 没有会员主体时退回首页,而不是发一条打不开的链接
  const noSubject = loadPage('pages/merchant/index/index.js');
  noSubject.page.data.merchantInfo = { id: 7, name: '城市运动装备馆' };
  assert.equal(noSubject.page.onShareAppMessage({ from: 'menu' }).path, '/pages/index/index');
});

// 2026-09-23 CU-M-09:preview=1 现在被 userinfo 读取 → cy-profile previewSelf(按访客视角渲染自己)。
test('入口8 店铺装修预览 → canonical + preview=1(访客视角预览)', () => {
  const { page, urls } = loadPage('pages/merchant/decor/index.js');
  page.data.m = { id: 7, memberId: 88 };
  page.goPreview();
  assert.deepEqual(urls(), [CANONICAL + '&preview=1']);
  const host = fs.readFileSync(path.join(__dirname, '../../pages/userinfo/userinfo.js'), 'utf8');
  assert.match(host, /previewSelf: options\.preview === '1'/, 'userinfo 必须读 preview=1,否则又成死参');
});

test('入口9 全站搜索商家结果项 → canonical', () => {
  const { decorateItem } = require('../../utils/discover-search.js');
  const item = decorateItem('merchant', { id: 7, memberId: 88, name: '城市运动装备馆' });
  assert.equal(item.path, CANONICAL);
  // 没绑会员主体的行拼不出主页地址;宁可给不可打开,也不能拿行 id 当 userId
  const lead = decorateItem('merchant', { id: 7, name: '只在平台登记的店' });
  assert.equal(lead.path, '');
  // 其它三类的落点不受影响
  assert.equal(decorateItem('club', { id: 9, name: '夜行' }).path, '/pages/club/detail/index?id=9');
});

test('★负控:任一入口改回旧 route 或错用 merchantId 当主体 ID,契约必须真红', () => {
  // 改回旧 route
  assert.throws(() => {
    const broken = loadPage('pages/merchant/relation/index.js', {
      mutate: (s) => s.replace(
        'const url = merchantHomeUrl(e.currentTarget.dataset.memberid);',
        "const url = '/pages/merchant/profile/index?id=' + e.currentTarget.dataset.id;"),
    });
    broken.page.goMerchant(tap({ id: 7, memberid: 88 }));
    assert.deepEqual(broken.urls(), [CANONICAL]);
  }, assert.AssertionError, '入口改回旧 route 后落点契约没有判红');

  // 丢掉 tab=about:落地页会停在默认 tab,商家「关于」等于没被激活
  assert.throws(() => {
    const broken = loadPage('pages/merchant/decor/index.js', {
      mutate: (s) => s.replace(
        "const { merchantHomeUrl } = require('../../utils/merchant-home-link.js');",
        "const merchantHomeUrl = (id) => id ? '/pages/userinfo/userinfo?userId=' + id : '';"),
    });
    broken.page.data.m = { id: 7, memberId: 88 };
    broken.page.goPreview();
    assert.deepEqual(broken.urls(), [CANONICAL]);
  }, assert.AssertionError, '丢掉 tab=about 后落点契约没有判红');
});

test('★负控:站内除阶段B 的 POI 两处外,不得再生成旧 route', () => {
  const SCAN_DIRS = ['pages', 'components', 'utils', 'subpackageA', 'subpackageB', 'subpackageMember',
    'subpackageP3', 'subpackageRoam', 'style'];
  // 2026-08-11 POI 单一真源落地:scene-registry 与 searchmap 的 POI 分流已改走
  // poi-detail 宿主,站内旧 route 归零 —— 白名单清空。
  const ALLOWED = new Set();

  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const rel = dir + '/' + entry.name;
      if (entry.isDirectory()) return walk(rel);
      return /\.(js|wxml|wxs|json)$/.test(entry.name) ? [rel] : [];
    });

  const offenders = SCAN_DIRS
    .filter((dir) => fs.existsSync(path.join(ROOT, dir)))
    .flatMap(walk)
    .filter((rel) => !ALLOWED.has(rel) && read(rel).includes(LEGACY_ROUTE));
  assert.deepEqual(offenders, [], '仓库里又长出了指向旧「承接商家」页的链接');

  // 负控:检查器不是空转 —— 拿一份真含旧 route 的合成内容喂它必须被抓住
  // (站内已零残留,没有真文件可当样本,合成串防止匹配口径悄悄失效)
  assert.equal(`wx.navigateTo({ url: '${LEGACY_ROUTE}?id=7' })`.includes(LEGACY_ROUTE), true,
    '扫描口径失效:连已知含旧 route 的内容都识别不出来');
});

// ───────────────────────── 旧壳的四种 query 分支 ─────────────────────────

const SHELL = 'pages/merchant/profile/index.js';

function openShell(query, options) {
  const harness = loadPage(SHELL, options);
  harness.page.onLoad(query);
  return harness;
}

test('旧壳 · 仅 id:按 id 校验商家取 memberId,redirect 到稳定 canonical', () => {
  const shell = openShell({ id: '7' });
  assert.equal(shell.page.data.state, 'loading');
  assert.equal(shell.requests[0].url, '/api/merchant/public-home');
  assert.deepEqual(JSON.parse(shell.requests[0].data), { id: '7' });
  shell.requests[0].success({ code: '200', data: { id: 7, memberId: 88 } });
  assert.deepEqual(shell.navigations, [{ method: 'redirectTo', url: CANONICAL }]);
  assert.equal(shell.page.data.state, 'redirecting');
});

test('旧壳 · id + topic 上下文:转成 contextual deep link,主题一路不丢', () => {
  const shell = openShell({ id: '7', topicId: '301', topicName: '%E8%8B%8F%E6%B2%B3%E6%B9%BE%E5%A4%9C%E8%A1%8C' });
  shell.requests[0].success({ code: '200', data: { memberId: 88 } });
  assert.deepEqual(shell.urls(),
    [CANONICAL + '&topicId=301&topicName=%E8%8B%8F%E6%B2%B3%E6%B9%BE%E5%A4%9C%E8%A1%8C']);
  // 进来时解一次、出去时编一次 —— 不许二次编码
  assert.doesNotMatch(shell.urls()[0], /%25/);
});

test('旧壳 · 仅 poiId:直接 redirect 到据点深链宿主,不再走商家解析', () => {
  const shell = openShell({ poiId: '42' });
  assert.deepEqual(shell.navigations,
    [{ method: 'redirectTo', url: '/subpackageRoam/poi-detail/index?poiId=42' }]);
  assert.deepEqual(shell.requests, [], 'poiId 是 cityNodeId,不是 merchantId,不该去查商家');
});

test('旧壳 · 跳转本身失败时重试的是跳转,不是把它误报成参数无效', () => {
  let failRedirect = true;
  const shell = loadPage(SHELL, {
    wx: {
      redirectTo: (o) => { if (failRedirect) o.fail({ errMsg: 'redirectTo:fail' }); },
    },
  });
  shell.page.onLoad({ poiId: '42' });
  assert.equal(shell.page.data.state, 'network-error');
  failRedirect = false;
  shell.page.retryLoad();
  assert.equal(shell.page.data.state, 'redirecting');
  assert.equal(shell.page.data.state === 'invalid', false, 'poiId 那支没有解析步骤,不能退化成「参数无效」');
});

test('旧壳 · 猜不出目的地的三种 query:明确说无效,不猜', () => {
  for (const query of [{ topicId: '301' }, {}, { id: '7', poiId: '42' }]) {
    const shell = openShell(query);
    assert.equal(shell.page.data.state, 'invalid', `${JSON.stringify(query)} 不该被猜出一个目的地`);
    assert.deepEqual(shell.navigations, []);
    assert.deepEqual(shell.requests, []);
  }
});

test('旧壳 · 网络失败保留原 query 并可重试;后端判定不可公开只给说明', () => {
  const shell = openShell({ id: '7', topicId: '301', topicName: '%E5%A4%9C%E8%A1%8C' });
  shell.requests[0].fail({ errMsg: 'request:fail' });
  assert.equal(shell.page.data.state, 'network-error');
  assert.equal(shell.page.data.id, '7', '重试要用原 query,不能把它冲掉');
  assert.equal(shell.page.data.topicId, '301');
  shell.page.retryLoad();
  assert.equal(shell.requests.length, 2);
  shell.requests[1].success({ code: '200', data: { memberId: 88 } });
  assert.deepEqual(shell.urls(), [CANONICAL + '&topicId=301&topicName=%E5%A4%9C%E8%A1%8C']);

  const closed = openShell({ id: '7' });
  closed.requests[0].success({ code: 500, msg: '商家不存在或未开放' });
  assert.equal(closed.page.data.state, 'business-unavailable');
  assert.deepEqual(closed.navigations, []);
});

test('旧壳 · 冷启动没有上一页时只给回首页,有栈才额外给返回', () => {
  const cold = openShell({ topicId: '301' }, { pageStack: [{}] });
  assert.equal(cold.page.data.canBack, false, '冷启动壳里给「返回」等于把人困死');
  cold.page.goHome();
  assert.deepEqual(cold.navigations, [{ method: 'switchTab', url: '/pages/index/index' }]);

  const deep = openShell({ topicId: '301' }, { pageStack: [{}, {}] });
  assert.equal(deep.page.data.canBack, true);
});

// ───────────────────────── 分享 / 收藏输出合同 ─────────────────────────

test('★旧壳不得实现 onShareTimeline(平台只能自定义 query 不能自定义 path)', () => {
  const { page } = loadPage(SHELL);
  assert.equal(typeof page.onShareTimeline, 'undefined',
    '旧壳实现 onShareTimeline = 朋友圈卡片把旧路径焊死后持续再播出去');
  // 注释里解释「为什么不实现」不算实现 —— 只看真代码
  assert.doesNotMatch(stripComments(read(SHELL)), /onShareTimeline/);
});

test('旧壳的 onShareAppMessage 输出新 canonical,不复制旧路径', () => {
  const shell = openShell({ id: '7' });
  shell.requests[0].success({ code: '200', data: { memberId: 88 } });
  const share = shell.page.onShareAppMessage();
  assert.equal(share.path, CANONICAL);
  assert.doesNotMatch(share.path, /merchant\/profile/);

  // 还没解析出主体就转发:退回首页,不发一条打不开的链接
  const unresolved = loadPage(SHELL);
  assert.equal(unresolved.page.onShareAppMessage().path, '/pages/index/index');
});

test('★负控:旧壳恢复 onShareTimeline、或分享改回旧 route,必须真红', () => {
  assert.throws(() => {
    const broken = loadPage(SHELL, {
      mutate: (s) => s.replace('  onShareAppMessage() {',
        '  onShareTimeline() { return { query: "id=7" }; },\n\n  onShareAppMessage() {'),
    });
    assert.equal(typeof broken.page.onShareTimeline, 'undefined');
  }, assert.AssertionError, '旧壳恢复 onShareTimeline 后负控没有判红');

  assert.throws(() => {
    const broken = loadPage(SHELL, {
      mutate: (s) => s.replace(
        "    const url = merchantHomeUrl(this.data.memberId);",
        "    const url = '/pages/merchant/profile/index?id=' + this.data.id;"),
    });
    broken.page.data.id = '7';
    broken.page.data.memberId = '88';
    assert.doesNotMatch(broken.page.onShareAppMessage().path, /merchant\/profile/);
  }, assert.AssertionError, '分享改回旧 route 后负控没有判红');
});

test('★负控:旧壳把不确定的 query 猜成一个目的地时必须真红', () => {
  assert.throws(() => {
    const broken = loadPage(SHELL, {
      mutate: (s) => s.replace(
        '    if (id && poiId) return this.setInvalid();',
        '    if (id && poiId) return this.redirect(POI_HOST + \'?poiId=\' + poiId);'),
    });
    broken.page.onLoad({ id: '7', poiId: '42' });
    assert.equal(broken.page.data.state, 'invalid');
    assert.deepEqual(broken.navigations, []);
  }, assert.AssertionError, '旧壳开始猜目的地后负控没有判红');
});
