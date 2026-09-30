const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function mountPage(relativePath, appOverrides, wxOverrides) {
  const requests = [];
  const app = Object.assign({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 1,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) { requests.push(options); },
  }, appOverrides || {});
  const wx = Object.assign({
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    navigateTo() {},
    navigateBack() {},
    reLaunch() {},
    showToast() {},
    showModal() {},
    pageScrollTo() {},
    setNavigationBarColor() {},
    setBackgroundColor() {},
  }, wxOverrides || {});
  let definition;
  global.getApp = () => app;
  global.wx = wx;
  global.Page = (config) => { definition = config; };
  const absolutePath = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(absolutePath)];
  require(absolutePath);
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return { page, requests };
}

function mountComponent(relativePath, data) {
  const requests = [];
  let definition;
  global.getApp = () => ({ sendRequest(options) { requests.push(options); } });
  global.wx = { showToast() {} };
  global.Component = (config) => { definition = config; };
  const absolutePath = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(absolutePath)];
  require(absolutePath);
  const instance = {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), data || {}),
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent() {},
  };
  for (const [name, method] of Object.entries(definition.methods)) {
    instance[name] = method.bind(instance);
  }
  return { instance, requests };
}

test('R4 我的项目:业务、网络与畸形200失败不得进入真空态', () => {
  const scenarios = [
    ['business', (request) => request.success({ code: '500', msg: '服务繁忙' })],
    ['network', (request) => request.fail({ errMsg: 'request:fail' })],
    ['malformed-200', (request) => request.success({ code: '200', data: { rows: {} } })],
  ];
  for (const [name, reply] of scenarios) {
    const { page, requests } = mountPage('subpackageA/pages/myproject/index.js');
    page.data.list = [{ id: 99, title: '旧项目' }];
    page.loadProjects();
    assert.equal(page.data.projectState, 'loading', `${name} 前必须先进 loading`);
    reply(requests[0]);
    assert.equal(page.data.projectState, 'error', `${name} 不得被解释成 empty`);
    assert.equal(page.data.list[0].id, 99, `${name} 不得清空已有业务上下文`);
    assert.ok(page.data.projectErrorMsg);
  }

  const valid = mountPage('subpackageA/pages/myproject/index.js');
  valid.page.loadProjects();
  valid.requests[0].success({ code: '200', data: { rows: [], total: 0 } });
  assert.equal(valid.page.data.projectState, 'ready');
  assert.deepEqual(valid.page.data.list, []);

  const wxml = read('subpackageA/pages/myproject/index.wxml');
  assert.match(wxml, /projectState === 'loading'[\s\S]*kind="loading"/);
  assert.match(wxml, /projectState === 'error'[\s\S]*<cy-error[\s\S]*bind:retry="loadProjects"/);
  assert.match(wxml, /projectState === 'ready' && list\.length === 0/,
    '只有有效响应的 ready + [] 才能渲染真空态');
});

test('商家客户名册拒绝非对象和含空元素的分页载荷', () => {
  for (const data of [{ rows: {} }, { rows: [null] }]) {
    const { page, requests } = mountPage('pages/merchant/customer/index.js');
    page.load(false);
    assert.doesNotThrow(() => requests[0].success({ code: '200', data }));
    assert.equal(page.data.error, '客户名单加载失败');
  }
});

test('R6 找商家承接:任一份名单加载失败都不得冒充「附近没有商家」', async () => {
  // 2026-08-10:章节邀约页并进 coop/nearby。带主题时要拿两份名单(附近 + 可承接章节),
  // 少一份就少一批可邀商家 —— 照常渲染等于用空态冒充失败态。
  const scenarios = [
    ['business', (request) => request.success({ code: '500', msg: '名单加载失败' })],
    ['network', (request) => request.fail({ errMsg: 'request:fail' })],
    ['malformed-200', (request) => request.success({ code: '200', data: {} })],
  ];
  for (const [name, reply] of scenarios) {
    const { page, requests } = mountPage('pages/coop/nearby/index.js');
    page.data.topicId = '7';
    page.fetch(121.4, 31.2);
    assert.equal(requests.length, 2, '带主题时必须同时取附近与可承接两份名单');
    requests[0].success({ code: '200', data: [{ id: 1, name: '河畔咖啡' }] });
    reply(requests[1]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(page.data.pageState, 'error', `${name} 不得进空态`);
  }

  const valid = mountPage('pages/coop/nearby/index.js');
  valid.page.data.topicId = '7';
  valid.page.fetch(121.4, 31.2);
  valid.requests[0].success({ code: '200', data: [{ id: 1, memberId: 42, name: '河畔咖啡', distance: 900 }] });
  valid.requests[1].success({ code: '200', data: [{ id: 2, memberId: 43, name: '外滩空间', chapterName: '第二章', distance: 120 }] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(valid.page.data.pageState, 'ready');
  // 从近到远:120m 的排在 900m 前面;可承接章节降为副标题
  assert.deepEqual(valid.page.data.merchants.map((m) => m.name), ['外滩空间', '河畔咖啡']);
  assert.equal(valid.page.data.merchants[0].chapterText, '可承接 · 第二章');

  const wxml = read('pages/coop/nearby/index.wxml');
  assert.match(wxml, /<cy-error\b[^>]*wx:elif="\{\{pageState === 'error'\}\}"/);
  // 行内不再直接发邀请 —— 点开商家主页再发起合作
  assert.doesNotMatch(wxml, /catchtap="goInvite"/);
  assert.match(wxml, /bindtap="openMerchant"/);
});

test('R6 商家承接候选:加载失败保留上下文并提供重试', () => {
  const scenarios = [
    ['business', (request) => request.success({ code: '500', msg: '候选章节加载失败' })],
    ['network', (request) => request.fail({ errMsg: 'request:fail' })],
    ['malformed-200', (request) => request.success({ code: '200', data: {} })],
  ];
  for (const [name, reply] of scenarios) {
    const { page, requests } = mountPage('pages/topic/merchantinfo/merchantinfo.js');
    page.data.topicId = 42;
    page.data.allChaptersList = [{ id: 9, name: '旧章节' }];
    page.loadMerchantRecruitmentChapters();
    reply(requests[0]);
    assert.equal(page.data.chapterRecruitmentState, 'error', `${name} 不得进候选空态`);
    assert.equal(page.data.allChaptersList[0].id, 9, `${name} 不得清空已有候选上下文`);
    assert.ok(page.data.chapterRecruitmentError);
  }

  const valid = mountPage('pages/topic/merchantinfo/merchantinfo.js');
  valid.page.data.topicId = 42;
  valid.page.loadMerchantRecruitmentChapters();
  valid.requests[0].success({ code: '200', data: [] });
  assert.equal(valid.page.data.chapterRecruitmentState, 'ready');
  assert.deepEqual(valid.page.data.allChaptersList, []);

  const failedEntry = mountPage('pages/topic/merchantinfo/merchantinfo.js');
  Object.assign(failedEntry.page.data, {
    info: {
      productType: 2,
      memberId: 2,
      merchantStatus: 1,
      merchantSignUpStartDate: '2020-01-01',
      merchantSignUpEndDate: '2030-01-01',
    },
    chapterRecruitmentState: 'error',
    chapterRecruitmentError: '候选章节加载失败',
    allChaptersList: [],
    myChapterApplications: [],
  });
  failedEntry.page.bmClick2();
  assert.equal(failedEntry.page.data.topicShow, true, '失败时不得用 toast 把承接入口无声拦在弹层外');

  /* 2026-09-08 稿 159:346:「选承接标的」这一层换成了 cy-chapter-target-picker,
     加载中 / 失败 / 缺品类 / 空这四态跟着搬进组件。契约要守的还是同一件事 ——
     四态各说各的话,「还没读到」不能印成「主办方没开放章节」。
     所以这里分两截查:页面必须把状态**透传**下去,组件里必须真的按状态分支。 */
  const wxml = read('pages/topic/merchantinfo/merchantinfo.wxml');
  assert.match(wxml, /<cy-chapter-target-picker[\s\S]*?chapters-state="\{\{chapterRecruitmentState\}\}"/,
    '页面必须把章节取数状态透传给选标的弹层,否则组件只能猜');
  assert.match(wxml, /<cy-chapter-target-picker[\s\S]*?bind:retrychapters="loadMerchantRecruitmentChapters"/,
    '失败态的重试必须回到页面的取数方法');

  const picker = read('pages/topic/components/cy/chapter-target-picker/index.wxml');
  assert.match(picker, /chaptersState === 'loading'[\s\S]*?<cy-error\b[^>]*wx:elif="\{\{chaptersState === 'error'\}\}"[^>]*bind:retry="onRetryChapters"/);
  assert.match(picker, /chaptersState === 'category-missing'[\s\S]*完善商家品类/);
  assert.match(picker, /chaptersState === 'ready' && !rows\.length[\s\S]*暂时没有开放的章节/);
});

test('R7 商家详情直达:业务、网络与畸形200失败都进 error 而非 ready', () => {
  const scenarios = [
    ['business', (request) => request.success({ code: '500', msg: '商家不存在' })],
    ['network', (request) => request.fail({ errMsg: 'request:fail' })],
    ['missing-data', (request) => request.success({ code: '200' })],
    ['malformed-data', (request) => request.success({ code: '200', data: {} })],
  ];
  for (const [name, reply] of scenarios) {
    const { instance, requests } = mountComponent(
      'components/cy/scene-roam-poi-detail/index.js',
      { poiId: '', merchantId: '7' },
    );
    instance._load();
    reply(requests[0]);
    assert.equal(instance.data.state, 'error', `${name} 不得标记 ready`);
    assert.equal(instance.data.merchant, null);
    assert.ok(instance.data.errorText);
  }

  const valid = mountComponent(
    'components/cy/scene-roam-poi-detail/index.js',
    { poiId: '', merchantId: '7' },
  );
  valid.instance._load();
  valid.requests[0].success({ code: '200', data: { id: 7, name: '城瘾小店' } });
  assert.equal(valid.instance.data.state, 'ready');

  const wxml = read('components/cy/scene-roam-poi-detail/index.wxml');
  assert.match(wxml, /<cy-error\b[^>]*wx:elif="\{\{state === 'error'\}\}"[^>]*sub="\{\{errorText\}\}"[^>]*bind:retry="retry"/);
  assert.match(wxml, /state === 'ready'/, '主体必须只在明确 ready 时渲染,不得用 wx:else 兜未知态');
});
