'use strict'

/**
 * CU-M-167(2026-09-24 走查)· 新建 AI 店铺角色时,「保存名字」只改临时显示,离开后丢失。
 *
 * 走查现象:隔离商家从品牌中心 → AI 店铺角色 → 名字,输入「探店小助手」点「保存」,
 * 弹层关闭、页面标题立刻显示新名字(=明确的已保存回执);返回时却弹「还没有保存」,
 * 选放弃后重进,名字还是「填写名字」。
 * 根因:saveField 在 hasProfile=false 时只 setData 就 return,一个请求都不发;
 * 真正建档要再走「角色形象 → 保存形象」,而页面从没说过这层前置关系。
 * 后端也不允许只存名字:/npc/save 里 avatar 为空直接 error("请选择形象")。
 *
 * 修复:没有档案时,「保存」连同屏幕上预览着的那个形象一起走 save() 这条既有持久化路径
 * —— 所见即所存,不再给一次假的回执。
 *
 * 负控在测试内联:把 saveField 那一支改回「只关弹层不发请求」,落库与离开两条断言必须真红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pixelAvatar = require('../../utils/pixel-avatar.js');

const ROOT = path.resolve(__dirname, '../..');
const JS_PATH = 'pages/merchant/decor/ai-npc/index.js';
const PAGE_JS = fs.readFileSync(path.join(ROOT, JS_PATH), 'utf8');
const FIRST = pixelAvatar.AVATAR_IDS[0];

/** 等微任务队列跑完(save() 里 avatar 解析走的是 Promise)。 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function loadPage(source) {
  const requests = [];
  const nav = [];
  let definition = null;
  const noop = () => {};
  const app = {
    globalData: {},
    sendRequest: (options) => { requests.push(options); return { abort: noop }; },
    getUploadClient: () => ({ uploadAll: noop }),
  };
  const file = path.join(ROOT, JS_PATH);
  vm.runInNewContext(source == null ? PAGE_JS : source, {
    Page: (value) => { definition = value; },
    getApp: () => app,
    getCurrentPages: () => [{ route: 'pages/merchant/decor/ai-npc/index' }],
    wx: { navigateBack: () => nav.push('back'), redirectTo: (o) => nav.push(o.url) },
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
    _drawPreview: noop,
  });
  // 后端读档案:空资料(avatar 为空串)⇒ hasProfile=false
  page._saved = { avatar: '', name: '', greeting: '', persona: '', knowledge: '' };
  page.data.loading = false;
  return { page, requests, nav };
}

/** 走查那一步:在名字弹层输入并点「保存」。 */
async function saveName(page, requests, value) {
  page.editField({ currentTarget: { dataset: { key: 'name' } } });
  page.data.field.value = value;
  page.saveField();
  await flush();
  const request = requests[requests.length - 1];
  return request ? { request, payload: JSON.parse(request.data) } : null;
}

test('CU-M-167 首次保存名字真的落库,并带上屏幕上预览的那个形象', async () => {
  const { page, requests } = loadPage();
  assert.equal(page.data.hasProfile, false, '前置:空资料');

  const sent = await saveName(page, requests, '探店小助手');
  assert.ok(sent, '点「保存」必须发出一个请求,不能只改显示');
  assert.equal(sent.request.url, '/api/merchant/npc/save');
  assert.equal(sent.payload.name, '探店小助手');
  assert.equal(sent.payload.avatar, 'px1:' + FIRST, '建档要带上正在预览的那个形象(后端 avatar 为空会拒)');

  sent.request.success({ code: 200, msg: '已保存' });
  await flush();
  assert.equal(page.data.field, null, '保存成功后关掉弹层');
  assert.equal(page.data.hasProfile, true);
  assert.equal(page.data.name, '探店小助手');
});

test('CU-M-167 保存成功后返回不再弹「还没有保存」(走查里内容就是这么丢的)', async () => {
  const { page, requests } = loadPage();
  const sent = await saveName(page, requests, '探店小助手');
  sent.request.success({ code: 200, msg: '已保存' });
  await flush();

  page.onNavBack();
  assert.equal(page.data.discardVisible, false, '已经落库的内容不得再被判成未保存');
});

test('保存失败时弹层留着并把原因写在里面(不能假称已保存)', async () => {
  const { page, requests } = loadPage();
  const sent = await saveName(page, requests, '探店小助手');
  sent.request.success({ code: 500, msg: '形象未保存，请重试' });
  await flush();

  assert.ok(page.data.field, '失败不许关弹层,否则用户只看到一个静默丢失');
  assert.equal(page.data.saveError, '形象未保存，请重试');
  assert.equal(page.data.hasProfile, false, '没存上就不能自称已建档');
});

test('先填招呼语:没有名字时回到名字这一栏,内容不丢(建档必填名字)', async () => {
  const { page, requests } = loadPage();
  page.editField({ currentTarget: { dataset: { key: 'greeting' } } });
  page.data.field.value = '欢迎来到店里';
  page.saveField();
  await flush();

  assert.equal(requests.length, 0, '名字都没有时不发建档请求');
  assert.equal(page.data.field.key, 'name', '直接把用户带到缺的那一栏');
  assert.equal(page.data.greeting, '欢迎来到店里', '招呼语得留在页面态里,不许白写');

  page.data.field.value = '探店小助手';
  const sent = await saveNameAfterGreeting(page, requests);
  assert.ok(sent, '补上名字后这次要真发出去');
  assert.equal(sent.payload.greeting, '欢迎来到店里');
  assert.equal(sent.payload.name, '探店小助手');
});

async function saveNameAfterGreeting(page, requests) {
  page.saveField();
  await flush();
  const request = requests[requests.length - 1];
  return request ? { request, payload: JSON.parse(request.data) } : null;
}

test('负控:把「保存」改回只关弹层不发请求时,上面几条必须真红', async () => {
  const regressed = PAGE_JS.replace(
    'this.save(() => this.setData({ field: null }));',
    'this.setData({ field: null });'
  );
  assert.notEqual(regressed, PAGE_JS, '负控锚点失效:saveField 的建档调用已改名,扫描口径需同步');
  const { page, requests } = loadPage(regressed);
  page.editField({ currentTarget: { dataset: { key: 'name' } } });
  page.data.field.value = '探店小助手';
  page.saveField();
  await flush();

  assert.equal(requests.length, 0, '这就是走查里的旧行为:一次请求都不发');
  assert.equal(page.data.field, null);
  assert.equal(page.data.hasProfile, false);
  page.onNavBack();
  assert.equal(page.data.discardVisible, true, '旧行为下离开必被「还没有保存」拦下');
  assert.throws(() => assert.equal(page.data.discardVisible, false), assert.AssertionError);
});
