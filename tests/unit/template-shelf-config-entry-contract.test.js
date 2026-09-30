// 模板货架「配置」入口契约(2026-08-27)。
//
// 在此之前货架上没有一个入口叫「配置」,而上货时商家唯一要做的事就是配置:
//   主题模板的按钮写「用模板」,点下去直接整包复制成草稿(圈层主题另开一个「去创建」);
//   游戏模板的按钮写「查看」,要「查看」→ 阅览半屏 →「查看此模板」→ 详情页 →
//   「开始应用」四步才摸得到节点配置页。
// 现在两个 tab 的主操作统一成「配置」:主题 → 简易发布器,游戏 → 节点配置页。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('../helpers/ui-sandbox-vm.js'); // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..');
const JS = fs.readFileSync(path.join(ROOT, 'pages/template/index.js'), 'utf8');

function loadPage(overrides, options) {
  const deferTemplateUse = !!(options && options.deferTemplateUse);
  let definition;
  const navigations = [];
  const toasts = [];
  const requests = [];
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: {} },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) {
      requests.push(options);
      if (options && typeof options.success === 'function' && options.url === '/api/template/topic-template/use'
        && !deferTemplateUse) {
        options.success({ code: '200', data: { topicId: 9001 } });
      }
    },
  };
  vm.runInNewContext(JS, {
    module: { exports: {} },
    console,
    getApp: () => app,
    Page(value) { definition = value; },
    setTimeout: () => 1,
    clearTimeout() {},
    require(request) {
      // 页面 onShow 要读「减少动态效果」偏好(utils/motion-preference.js),沙箱得给它这个模块;
      // 它自己会 guard 全局 wx,Node 侧取不到存储 ⇒ 与真机默认一致(动态效果开)。
      if (request === '../../utils/motion-preference.js') return require(path.join(ROOT, 'utils/motion-preference.js'));
      if (request === '../../utils/font-scale.js') return { readPageStyle: () => '' };
      if (request === '../../utils/mockData.js') return {};
      if (request === '../../utils/identity/identity-policy.js') return { isMerchantView: () => false };
      if (request === '../../utils/merchant-theme.js') return { merchantPageRestore() {}, merchantPageShow() {} };
      if (request === '../../utils/merchant-access-policy.js') {
        return {
          inactiveAccess: () => ({ active: false, canManageProjects: false }),
          normalizeMerchantAccess: (value) => value || { active: false, canManageProjects: false },
        };
      }
      if (request === '../../utils/circle-theme.js') return { PRIMARY_THEME_CODES: ['FITNESS'], themeOf: () => ({ candidates: [] }) };
      if (request === '../../utils/template-display.js') return { formatDurationMinutes: () => '' };
      if (request === '../../utils/response-shape.js') {
        return { isRecord: (v) => !!v && typeof v === 'object', isRecordList: Array.isArray };
      }
      if (request === '../../utils/analytics.js') return { track() {} };
      throw new Error(`unexpected require: ${request}`);
    },
    wx: {
      showToast(options) { toasts.push(options.title); },
      navigateTo(options) { navigations.push(options.url); },
      switchTab() {},
    },
  }, { filename: 'pages/template/index.js' });

  const page = Object.assign({}, definition);
  page.data = Object.assign(JSON.parse(JSON.stringify(definition.data)), overrides || {});
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return { page, navigations, toasts, requests };
}

const fire = (item) => ({ currentTarget: { dataset: { item } } });

// 2026-08-28 用户裁决撤掉货架按钮,「两个 tab 主操作文案统一为配置」契约随入口退役。

test('主题模板点卡走整包复制，打开专业编辑器而不是 AI 白纸', () => {
  const h = loadPage();
  h.page.primaryAction(fire({ _kind: 'topic', id: 21, _title: '风味巡游', productType: 2 }));
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/template/topic-template/use');
  assert.equal(h.requests[0].method, 'POST');
  assert.equal(h.requests[0].data.id, 21);
  assert.equal(h.navigations.length, 1);
  assert.equal(h.navigations[0], '/pages/publish/fabu/index?id=9001');
});

test('游戏模板点「配置」直接进节点配置页，不再绕详情页两层', () => {
  const h = loadPage();
  h.page.primaryAction(fire({ _kind: 'game', id: 307, _title: '闭眼味觉师' }));
  assert.deepEqual(h.navigations, ['/pages/publish/temp/index?id=307']);
});

test('实验预览的游戏模板不许进配置页 —— 它还没落库，配了也存不进去', () => {
  const h = loadPage();
  h.page.primaryAction(fire({ _kind: 'game', id: 'dev-1', _title: '预览', previewOnly: true }));
  assert.deepEqual(h.navigations, []);
  assert.equal(h.toasts.length, 1);
});

test('商家只读岗位点不动任何配置入口（WXML 漂移了也拦得住）', () => {
  for (const handler of ['goTopicConfig', 'goGameConfig']) {
    const h = loadPage({ operationScope: 'MERCHANT', merchantAccessLoaded: true, canManageMerchantProjects: false });
    h.page[handler](fire({ _kind: 'topic', id: 1, _title: 'T' }));
    assert.deepEqual(h.navigations, [], `${handler} 必须 fail-closed`);
    assert.equal(h.toasts.length, 1, `${handler} 要说明为什么点不动`);
  }
});

test('商家身份配置主题时带上 MERCHANT 作用域，草稿不会归到个人名下', () => {
  const h = loadPage({ operationScope: 'MERCHANT', merchantAccessLoaded: true, canManageMerchantProjects: true });
  h.page.goTopicConfig(fire({ _kind: 'topic', id: 1, _title: 'T', productType: 1 }));
  assert.equal(h.requests[0].data.scope, 'MERCHANT');
  assert.match(h.navigations[0], /scope=MERCHANT/);
  assert.match(h.navigations[0], /id=9001/);
});

// B-05:后端 /topic-template/use 每次调用都整包复制出新草稿,没有幂等键 ——
// 连点两下会在「我的项目」里多出一份一模一样的主题。
test('B-05:主题「配置」在途时连点不重复复制草稿,完成后恢复可点', () => {
  const h = loadPage({}, { deferTemplateUse: true });
  h.page.goTopicConfig(fire({ _kind: 'topic', id: 21, _title: '风味巡游' }));
  h.page.goTopicConfig(fire({ _kind: 'topic', id: 21, _title: '风味巡游' }));
  assert.equal(h.requests.length, 1, '第一次请求在途时第二次点击必须被挡住');

  h.requests[0].success({ code: '200', data: { topicId: 9001 } });
  assert.equal(h.navigations.length, 1, '成功后跳转一次');
  h.page.goTopicConfig(fire({ _kind: 'topic', id: 21, _title: '风味巡游' }));
  assert.equal(h.requests.length, 2, '上一次完成后必须恢复可点');
});

test('B-05:主题「配置」失败后也要解锁,不能把入口永久焊死', () => {
  const h = loadPage({}, { deferTemplateUse: true });
  h.page.goTopicConfig(fire({ _kind: 'topic', id: 21, _title: '风味巡游' }));
  h.requests[0].fail({ msg: '网络错误' });
  h.page.goTopicConfig(fire({ _kind: 'topic', id: 21, _title: '风味巡游' }));
  assert.equal(h.requests.length, 2, '失败必须放行下一次点击');
});
