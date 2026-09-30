// 发布流第三步开关(spec §2.1)—— 行为测试:钉的是上送体,不是开关长什么样。
//
// 2026-09-15 裁决 12B:公开承接池「邀请俱乐部带队」专业版与简易版统一默认开,主办仍可手动关。
// 本文件钉住五条行为:
//  · 城市定向:开关在,上送体按表单值(开=1 / 关=0);
//  · 存量 0 不回填成 1(编辑回填如实显示,保存保持关);
//  · 自由探索按 spec §2.1 没有俱乐部带队,回填带来的 1 必须在上送体里归 0
//    (服务端 assertClubLeadOnlyForCityOrienteering 对「自由探索+1」直接抛);
//  · 新建默认开(formData 初值 true);
//  · 归属俱乐部的主题(clubId 锁死)不开放公开承接池,存量回填的 1 也归 0(2026-09-15 补充裁决)。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../pages/publish/fabu/index.js';

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
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
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

/** 带 id 打开编辑器并喂回 edit-detail;productType/openClubPool 由调用方指定。 */
function openForEdit(topicPatch, loadOptions) {
  const page = makePage();
  page.onLoad(Object.assign({ id: '77' }, loadOptions || {}));
  const detailReq = sent.find((r) => r.url === '/api/topic/edit-detail');
  assert.ok(detailReq, '带 id 进入必须去拉主题详情回填');
  detailReq.success({
    code: '200',
    data: {
      editScope: 'FULL',
      topic: Object.assign({
        id: 77,
        name: '午夜巴士',
        subtitle: '一条老线路',
        description: '沿着 71 路走一遍',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        imgUrl: 'cover.jpg',
        categoryIds: '3',
        productType: 1,
        merchantStatus: 0,
        openClubPool: 1,
        recruitDeadline: '2026-08-20',
        publishMode: 'pro',
      }, topicPatch),
      chapters: [{ id: 5, name: '第一章', cmsTopicNodeList: [{ id: 51, name: '外滩', address: '中山东一路', nodeTime: 20 }] }],
      tickets: [{ id: 9, name: '早鸟票', price: 19.9, totalInventory: 100, startTime: '2026-09-01', endTime: '2026-09-30' }],
      collaboratorIds: [],
    },
  });
  return page;
}

function submitBody(page) {
  sent = [];
  page._doSubmit();
  const req = sent.find((r) => r.url === '/api/topic/update' || r.url === '/api/topic/create');
  assert.ok(req, '提交必须打出 create/update 请求');
  return JSON.parse(req.data);
}

// 2026-09-15 裁决 12B:统一默认开,主办仍可手动关 ⇒ 上送体必须如实反映开关。
test('新建默认:openClubPool 初值为 true(专业版开关默认开)', () => {
  const page = makePage();
  assert.equal(page.data.formData.openClubPool, true,
    '裁决 12B 前默认关;改回默认关前先改这条断言的理由');
});

test('城市定向:回填开着 → 上送 1', () => {
  const page = openForEdit({ productType: 1, openClubPool: 1 });
  assert.equal(page.data.formData.openClubPool, true, '回填如实反映库里的值,读侧不撒谎');
  assert.equal(submitBody(page).openClubPool, 1, '开关开着就必须按开着上送');
});

test('城市定向:存量关着 → 上送 0(不回填成开)', () => {
  const page = openForEdit({ productType: 1, openClubPool: 0 });
  assert.equal(page.data.formData.openClubPool, false, '存量 0 编辑时保持关');
  assert.equal(submitBody(page).openClubPool, 0, '存量数据不回填:没动开关就不许悄悄打开');
});

test('自由探索:开关不露面,回填带来的 1 必须在上送体里归 0', () => {
  const page = openForEdit({ productType: 2, openClubPool: 1 });
  // 回填仍然如实反映库里的旧值 —— 归一化只发生在上送这一处,读侧不撒谎。
  assert.equal(page.data.formData.openClubPool, true);
  assert.equal(submitBody(page).openClubPool, 0,
    '自由探索按 spec §2.1 没有俱乐部带队;送 1 出去后端会直接抛,发布硬失败');
});

test('俱乐部自己发的团(clubId 锁死):不开放公开承接池,上送恒 0', () => {
  const page = openForEdit({ productType: 1, openClubPool: 1, clubId: 9 }, { clubId: '9' });
  assert.equal(page._lockClub, true, 'clubId 进入即锁定归属俱乐部 = 俱乐部侧发布');
  assert.ok(page.data.formData.clubId, '归属俱乐部已锁进表单');
  assert.equal(submitBody(page).openClubPool, 0,
    '2026-09-15 补充裁决:俱乐部自办团不进公开承接池;存量回填的 1 也必须在上送体归 0');
});

// 上面五条只钉住「送出去的值」。展示层还得单独钉一条:上送归一会把自由探索/俱乐部自办团的
// 值默默改成 0,所以一旦 wx:if 漏了对应条件,就会出现一个「点得动、状态还留在屏幕上、
// 提交时被无声丢弃」的开关 —— 界面在骗人,而行为测试全绿。
test('step3:「邀请俱乐部带队」在、绑活方法、只对非俱乐部城市定向露出;商家池那条仍在', () => {
  const fs = require('fs');
  const path = require('path');
  const wxml = fs.readFileSync(
    path.join(__dirname, '../../pages/publish/fabu/step3.wxml'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '../../pages/publish/fabu/topic-detail-sheet.wxml'), 'utf8');

  // ⚠️ 判据要挑【控件】不挑文案:说明注释里也写着「邀请俱乐部带队」五个字,
  // 直接 includes 文案会被注释误伤(本仓「注释不算数」那一类坑)。先剥注释再判。
  const live = wxml.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(/checked="\{\{formData\.openClubPool\}\}"/.test(live), '开关必须在版面上');
  assert.ok(live.includes('onClubPoolChange'), '绑定必须在');
  assert.ok(live.indexOf('wx:if="{{formData.productType === 1 && !formData.clubId}}">俱乐部承接</view>') >= 0,
    '只对「非俱乐部城市定向」露出:自由探索撞服务端带队闸;俱乐部自办团不进公开池,'
    + '两处露出的都是点得动却不生效的死开关');
  assert.ok(!/wx:if="\{\{formData\.productType === 1\}\}">俱乐部承接/.test(live),
    '旧条件(不看 clubId)不能回潮 —— 那正是「界面在骗人」的形态');

  // 2026-09-05 用户拍板,推翻 spec §2.2/§2.3 的「两个角色两个名字」:
  //   现码切名字用的判据是 lockClub(= 进这一页时带没带 clubId),**跟身份无关** ——
  //   同一个俱乐部主理人从俱乐部入口进来看到「愿意商家参与」、从「我的主题」进来看到
  //   「开放给商家市场」,同一个人同一件事两个说法。这句话描述的是【主题的属性】,
  //   不是读者的身份,所以统一成一个名字。
  //   结构与文案的完整断言(含负控)在 publish-schedule-recruit-sections-contract.test.js。
  assert.ok(live.includes('开放给商家承接'), '商家池开关必须在,且是统一文案');
  assert.ok(!live.includes('开放给商家市场') && !live.includes('愿意商家参与'),
    '按入口切的两个旧名字都不该再出现(注释除外)');
});
