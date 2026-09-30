'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => { cursor = cursor[part] || (cursor[part] = {}); });
  cursor[parts.at(-1)] = value;
}

function loadPage(settings = {}) {
  let config;
  const requests = [];
  const controls = [];
  const toasts = [];
  const tips = [];
  global.Page = (value) => { config = value; };
  global.Component = () => {};
  global.wx = {
    getStorageSync: () => '',
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    showToast: (options) => { toasts.push(options); },
  };
  global.getApp = () => ({
    globalData: { features: {} },
    getUserID: () => settings.userId || '',
    getUserType: () => 1,
    getPageSize: () => 10,
    setOpenID() {},
    tips: (message) => { tips.push(message); },
    sendRequest: (options) => {
      requests.push(options);
      const control = {
        aborted: false,
        abort() {
          this.aborted = true;
          if (settings.abortCompletesSync) {
            options.fail({ errMsg: 'request:fail abort' });
            options.complete();
          }
        },
      };
      controls.push(control);
      return control;
    },
  });
  if (settings.source) {
    // A-14-2 负控:按变异源码建模块,不污染 require 缓存
    const Module = require('node:module');
    const modulePath = path.resolve(__dirname, '../../pages/index/index.js');
    const m = new Module(modulePath, module);
    m.filename = modulePath;
    m.paths = Module._nodeModulePaths(path.dirname(modulePath));
    m._compile(settings.source, modulePath);
  } else {
    delete require.cache[require.resolve('../../pages/index/index.js')];
    require('../../pages/index/index.js');
  }
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setPath(page.data, key, value));
    if (callback) callback();
  };
  return { page, getRequest: () => requests.at(-1), requests, controls, toasts, tips };
}

test('首页列表首次加载和重试都立即进入 loading，失败后可恢复到 error', () => {
  const { page, getRequest } = loadPage();
  page.data.listErr.nearbyActivityList = true;
  page.getListData('nearbyActivityList', '/api/activity/list', {});
  assert.equal(page.data.listLoading.nearbyActivityList, true);
  assert.equal(page.data.listErr.nearbyActivityList, false);

  getRequest().fail({ errMsg: 'request:fail timeout' });
  assert.equal(page.data.listErr.nearbyActivityList, true);
  getRequest().complete();
  assert.equal(page.data.listLoading.nearbyActivityList, false);
});

test('同一首页列表的新请求会取消旧请求，迟到回调不得覆盖新条件或提前结束 loading', () => {
  const { page, requests, controls } = loadPage();
  page.getListData('nearbyActivityList', '/api/activity/list', { sort_type: 2 });
  page.getListData('nearbyActivityList', '/api/activity/list', { sort_type: 1 });
  assert.equal(controls[0].aborted, true, '第二次查询必须取消同列表旧请求');

  requests[0].success({ code: 200, data: { rows: [{ id: 1, name: '旧条件' }] } });
  requests[0].complete();
  assert.deepEqual(page.data.nearbyActivityList, []);
  assert.equal(page.data.listLoading.nearbyActivityList, true, '旧请求 complete 不得关闭新请求 loading');

  requests[1].success({ code: 200, data: { rows: [{ id: 2, name: '新条件' }] } });
  requests[1].complete();
  assert.equal(page.data.nearbyActivityList[0].name, '新条件');
  assert.equal(page.data.listLoading.nearbyActivityList, false);
});

test('首页离页会取消仍在途的列表请求', () => {
  const { page, controls } = loadPage({ abortCompletesSync: true });
  page.getListData('nearbyActivityList', '/api/activity/list', {});
  page.getListData('recommendedTopicList', '/api/topic/list', {});
  let unloadSetDataCalls = 0;
  const originalSetData = page.setData;
  page.setData = (...args) => {
    unloadSetDataCalls += 1;
    return originalSetData(...args);
  };
  page.onUnload();
  assert.deepEqual(controls.map((control) => control.aborted), [true, true]);
  assert.equal(unloadSetDataCalls, 0, 'abort 同步回调也不得在离页过程中继续 setData');
});

test('首页列表 200 空 payload 不得抛异常，必须进入可重试错误态', () => {
  const { page, getRequest } = loadPage();
  page.getListData('nearbyActivityList', '/api/activity/list', {});

  assert.doesNotThrow(() => getRequest().success({ code: 200, data: null }));
  getRequest().complete();

  assert.equal(page.data.listErr.nearbyActivityList, true);
  assert.equal(page.data.listLoading.nearbyActivityList, false);
});

test('首页私有用户信息 200 空 payload 不得崩溃或继续 loading', () => {
  const { page, getRequest, tips } = loadPage({ userId: 7 });
  page.getUserData();

  assert.doesNotThrow(() => getRequest().success({ code: 200, data: null }));

  assert.equal(page.data.isLoading, false);
  assert.deepEqual(tips, ['用户信息加载失败']);
});

test('首页私有用户信息 200 数组 payload 也必须按畸形响应拒绝', () => {
  const { page, getRequest, tips } = loadPage({ userId: 7 });
  page.getUserData();

  getRequest().success({ code: 200, data: [] });

  assert.deepEqual(tips, ['用户信息加载失败']);
  assert.deepEqual(page.data.userInfo, { avatar: '', nickname: '', point: '0' });
});

test('首页底部主题和活动列表 200 空 payload 都按加载失败处理', () => {
  const topic = loadPage();
  topic.page.loadBottomTopicList(1);
  assert.doesNotThrow(() => topic.requests[0].success({ code: 200, data: null }));
  assert.equal(topic.page.data.isBottomLoading, false);
  // A-14-2:失败不再只弹一次 toast,改为列表底部的行内重试标记(失败页)。
  assert.equal(topic.page.data.bottomTopicFailedPage, 1);
  assert.equal(topic.toasts.length, 0, '行内重试已承接失败反馈,不再叠 toast');

  const activity = loadPage();
  activity.page.loadBottomActivityList(1);
  assert.doesNotThrow(() => activity.requests[0].success({ code: 200, data: null }));
  assert.equal(activity.page.data.isBottomLoading, false);
  assert.equal(activity.page.data.bottomActivityFailedPage, 1);
  assert.equal(activity.toasts.length, 0, '行内重试已承接失败反馈,不再叠 toast');
});

test('A-14-2:底部信息流刷新失败落行内重试,重试复用失败页并在成功后清标记', () => {
  const { page, requests } = loadPage();
  page.loadBottomTopicList(1, true);
  const first = requests.at(-1);
  assert.equal(first.url, '/api/topic/list');
  first.fail({ errMsg: 'request:fail timeout' });
  assert.equal(page.data.bottomTopicFailedPage, 1, '失败页必须落进 data,wxml 才渲染行内重试');
  assert.equal(page.data.isBottomLoading, false);

  page.retryBottomTopic();
  const retry = requests.at(-1);
  assert.equal(retry.data.pageNum, 1, '重试沿用失败页');
  retry.success({ code: 200, data: { rows: [], total: 0 } });
  assert.equal(page.data.bottomTopicFailedPage, 0, '成功后清标记');
});

test('A-14-2:加载更多失败按翻页口径重试(pageNum 前进),活动列表同理', () => {
  const { page, requests } = loadPage();
  page.setData({ bottomTopicPageNo: 1, hasMoreBottomTopic: true });
  page.loadBottomTopicList(2);
  requests.at(-1).fail({ errMsg: 'request:fail timeout' });
  assert.equal(page.data.bottomTopicFailedPage, 2, '翻页失败记的是第 2 页');

  page.retryBottomTopic();
  assert.equal(requests.at(-1).data.pageNum, 2, '重试翻的是同一页,不从头再来');

  const activity = loadPage();
  activity.page.setData({ bottomActivityPageNo: 1, hasMoreBottomActivity: true });
  activity.page.loadBottomActivityList(2);
  activity.requests.at(-1).fail({ errMsg: 'request:fail timeout' });
  assert.equal(activity.page.data.bottomActivityFailedPage, 2);
  activity.page.retryBottomActivity();
  assert.equal(activity.requests.at(-1).data.pageNum, 2);
});

test('A-14-2:底部信息流行内重试入口接了两条线,负控撤掉失败标记必须真红', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.wxml'), 'utf8');
  // 行内重试元素本身带 `>` 比较表达式,正则按元素内逐条属性钉,不跨 `>` 匹配
  const errorBlock = (cond, handler) => {
    const start = wxml.indexOf('wx:if="{{' + cond + '}}"');
    const block = wxml.slice(start, wxml.indexOf('/>', start));
    return { start, block, handler };
  };
  const topicBlock = errorBlock('bottomTopicFailedPage', 'retryBottomTopic');
  assert.ok(topicBlock.start > -1, '主题流必须有行内重试元素');
  assert.match(topicBlock.block, /action="重试"/);
  assert.match(topicBlock.block, /bind:action="retryBottomTopic"/);
  const activityBlock = errorBlock('bottomActivityFailedPage', 'retryBottomActivity');
  assert.ok(activityBlock.start > -1, '活动流必须有行内重试元素');
  assert.match(activityBlock.block, /action="重试"/);
  assert.match(activityBlock.block, /bind:action="retryBottomActivity"/);
  const json = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.json'), 'utf8'));
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index');

  const js = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.js'), 'utf8');
  const broken = js.replaceAll('bottomTopicFailedPage: pageNo', 'bottomTopicFailedPage: 0');
  assert.notEqual(broken, js, '负控锚点失效:失败标记未命中');
  const { page, requests } = loadPage({ source: broken });
  page.loadBottomTopicList(1, true);
  requests.at(-1).fail({ errMsg: 'request:fail timeout' });
  assert.equal(page.data.bottomTopicFailedPage, 0, '负控必须复现「失败后没有任何行内重试入口」');
});

test('首页三类列表首次 loading 使用同构骨架，不得短暂冒充空态', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.wxml'), 'utf8');
  assert.match(wxml, /listLoading\.nearbyActivityList\s*&&\s*!nearbyActivityList\.length[\s\S]{0,220}<cy-skeleton[^>]*type="feed-card"/);
  assert.match(wxml, /listLoading\.recommendedTopicList\s*&&\s*!recoHero[\s\S]{0,220}<cy-skeleton[^>]*type="feed-card"/);
  assert.match(wxml, /listLoading\.upcomingActivityList\s*&&\s*!upcomingActivityList\.length[\s\S]{0,220}<cy-skeleton[^>]*type="feed-card"/);
});

test('首页旧内容重试时显示轻量同步态，离页会取消 onShow 延迟任务', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.wxml'), 'utf8');

  for (const condition of [
    'listLoading.recommendedTopicList && recoHero',
    'listLoading.nearbyActivityList && nearbyActivityList.length',
    'listLoading.upcomingActivityList && upcomingActivityList.length',
  ]) {
    assert.match(wxml, new RegExp(`wx:if="\\{\\{${condition.replace(/\./g, '\\.') }\\}\\}"[^>]*aria-role="status"`));
  }
  assert.match(wxml, /listErr\.recommendedTopicList && recoHero[\s\S]{0,260}bindtap="retryList"[\s\S]{0,180}已显示上次内容，本次刷新失败 · 重试/);
  assert.match(js, /this\._onShowRefreshTimer\s*=\s*setTimeout/);
  assert.match(js, /clearTimeout\(this\._onShowRefreshTimer\)/);
});

test('推荐主题切换后忽略旧 transition 尾帧，焦点卡不得重新变糊', async () => {
  const { page } = loadPage();
  page.data.recoCards = [{ id: 1 }, { id: 2 }];
  page.data.recoCurrent = 0;

  page.onRecoChange({ detail: { current: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 180));
  page.onRecoTransition({ detail: { dx: 500 } });

  assert.match(page.data.recoCardStyles[1], /--reco-card-scale:1\.0000;--reco-mask-opacity:0\.0000;--reco-blur:0\.00px/,
    '第 2 张成为当前项后，旧手势尾帧不能把它恢复成非焦点态');

  page._recoTransitionLocked = false;
  page.onRecoTransition({ detail: { dx: 500 } });
  assert.doesNotMatch(page.data.recoCardStyles[1], /--reco-card-scale:1\.0000;--reco-mask-opacity:0\.0000;--reco-blur:0\.00px/,
    '负控：不拦旧尾帧时必须能复现焦点卡重新变糊');
  clearTimeout(page._recoTransitionUnlockTimer);
});
