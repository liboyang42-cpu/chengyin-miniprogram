const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../subpackageP3/pages/badge-wall/index/index.js');
const WXML_PATH = path.resolve(__dirname, '../../subpackageP3/pages/badge-wall/index/index.wxml');
const JSON_PATH = path.resolve(__dirname, '../../subpackageP3/pages/badge-wall/index/index.json');
const UI_STATE_REQUEST_PATH = path.resolve(__dirname, '../../utils/ui-state-request.js');
const fs = require('node:fs');

let pageConfig;
let requests;

global.getApp = () => ({
  sendRequest(options) { requests.push(options); },
});

global.wx = {
  getWindowInfo: () => ({ statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20, pixelRatio: 2 }),
  // 错误态恢复补丁(applyBadges → initCanvas)在 harness 无 canvas 环境也会走到:
  // 给一个查不到节点的空实现,页面自会落 glFail,不再异步炸 unhandledRejection。
  createSelectorQuery: () => {
    const q = { in: () => q, select: () => q, fields: () => q, exec: (cb) => { if (cb) cb([null]); } };
    return q;
  },
};

global.Page = (config) => { pageConfig = config; };

function setByPath(target, key, value) {
  const parts = key.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
}

function loadPage() {
  delete require.cache[require.resolve(PAGE_PATH)];
  pageConfig = null;
  require(PAGE_PATH);
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(page.data, key, value));
    if (callback) callback();
  };
  return page;
}

async function loadWall(page, wall, wallV2, options = {}) {
  page.loadData();
  assert.equal(requests.length, 2, '勋章墙必须同时读取城市勋章与身份卡目录');
  const wallStatus = options.wallStatus || '200';
  const wallV2Status = options.wallV2Status || '200';
  if (wallStatus === 'fail') requests[0].fail();
  else requests[0].success({ code: wallStatus, data: wall });
  if (wallV2Status === 'fail') requests[1].fail();
  else requests[1].success({ code: wallV2Status, data: wallV2 });
  await new Promise((resolve) => setImmediate(resolve));
}

function assertCityDetails(badge) {
  assert.equal(badge.time, '2026-07-27');
  assert.equal(badge.cond, '完成绑定此勋章模板的城市节点');
}

test('城市勋章详情使用后端 getTime，并消费后端明确返回的真实获得条件', async () => {
  requests = [];
  const page = loadPage();
  await loadWall(page, {
    medals: [{
      templateId: 18,
      medalName: '梧桐下的十分钟',
      medalImg: '/medal/wutong.png',
      topicId: 7,
      getTime: '2026-07-27 08:30:00',
      condition: '完成绑定此勋章模板的城市节点',
    }],
  }, { identity: [] });

  assert.equal(page.data.badges.length, 1);
  assert.equal(page.data.loadFail, false);
  assert.equal(page.data.partialFail, false);
  const badge = page.data.badges[0];
  assert.equal(badge.name, '梧桐下的十分钟');
  assert.equal(badge.rarity, 1);
  assert.equal(badge.tierKey, 'CITY');
  assert.equal(badge.tierZh, '城市纪念章');
  assert.equal(badge.locked, false);
  assert.equal(badge.source, '城市纪念章 · 节点通关');
  assert.equal(badge.desc, '完成带勋章的城市节点点亮,这一枚来自你走过的路。');
  assertCityDetails(badge);
});

test('成就行不是城市节点勋章，不得继承城市条件；日期仍来自 getTime', async () => {
  requests = [];
  const page = loadPage();
  await loadWall(page, {
    medals: [{
      kind: 'achievement',
      badgeCode: 'ROAM_TILES_50',
      medalName: '城市点亮 50 格',
      medalImg: '',
      getTime: '2026-07-26T11:12:13+08:00',
    }],
  }, { identity: [] });

  const badge = page.data.badges[0];
  assert.equal(badge.time, '2026-07-26');
  assert.equal(badge.locked, false);
  assert.equal(badge.cond, '');
  assert.equal(badge.source, '成长成就');
  assert.notEqual(badge.desc, '完成带勋章的城市节点点亮,这一枚来自你走过的路。');
});

test('身份卡保持未解锁/已解锁与 unlockTime/unlockHint 语义', async () => {
  requests = [];
  const page = loadPage();
  await loadWall(page, { medals: [] }, {
    identity: [
      {
        badgeCode: 'ID_CITY_PROPOSAL', badgeName: '城市提案', category: 'CREATE',
        statement: '我向这座城,提交了第一个玩法。', unlocked: false,
        unlockHint: '发布第一个可被体验的城市任务',
      },
      {
        badgeCode: 'FIRST_STEP', badgeName: '开始在场', category: 'EXPLORE',
        statement: '我不是路过,我开始在场。', unlocked: true,
        unlockTime: '2026-07-25 09:10:11', unlockHint: '完成你的第一个有效节点',
      },
    ],
  });

  const locked = page.data.badges.find((badge) => badge.name === '城市提案');
  const unlocked = page.data.badges.find((badge) => badge.name === '开始在场');
  assert.equal(locked.locked, true);
  assert.equal(locked.time, '');
  assert.equal(locked.cond, '发布第一个可被体验的城市任务');
  assert.equal(unlocked.locked, false);
  assert.equal(unlocked.time, '2026-07-25');
  assert.equal(unlocked.cond, '完成你的第一个有效节点');
});

test('城市勋章接口失败时保留身份卡，并显示可理解的部分数据重试态', async () => {
  requests = [];
  const page = loadPage();
  let engineStopped = 0;
  page.engine = { setBadges() {}, stop() { engineStopped += 1; }, closeDetail() {} };
  await loadWall(page, null, {
    identity: [{
      badgeCode: 'FIRST_STEP', badgeName: '开始在场', category: 'EXPLORE',
      statement: '我不是路过,我开始在场。', unlocked: true,
      unlockTime: '2026-07-25 09:10:11', unlockHint: '完成你的第一个有效节点',
    }],
  }, { wallStatus: 'fail' });

  assert.equal(page.data.loadFail, false);
  assert.equal(page.data.partialFail, true);
  assert.equal(page.data.badges.length, 1, '身份卡仍应可见');
  assert.equal(page.data.badges[0].name, '开始在场');
  assert.equal(engineStopped, 1, '部分失败切走 canvas 时必须停止 WebGL RAF');
});

test('城市勋章 partial 失败时必须关闭旧城市详情并清空详情快照', async () => {
  requests = [];
  const page = loadPage();
  let detailClosed = 0;
  let engineStopped = 0;
  page.engine = {
    setBadges() {},
    stop() { engineStopped += 1; },
    closeDetail() { detailClosed += 1; },
  };
  page.data.sheetOn = true;
  page.data.sheet = {
    name: '旧城市纪念章', rarZh: '城市纪念章', rarColor: '#30d158',
    desc: '旧内容', time: '2026-07-27', source: '旧来源', cond: '旧条件'
  };

  await loadWall(page, null, {
    identity: [{
      badgeCode: 'FIRST_STEP', badgeName: '开始在场', category: 'EXPLORE', unlocked: true,
    }],
  }, { wallStatus: 'fail' });

  assert.equal(page.data.partialFail, true);
  assert.equal(page.data.sheetOn, false, '部分失败不能继续展示旧详情 sheet');
  assert.deepEqual(page.data.sheet, {
    name: '', rarZh: '', rarColor: '', desc: '', time: '', source: '', cond: ''
  });
  assert.equal(detailClosed, 1, '部分失败必须关闭 WebGL 详情');
  assert.equal(engineStopped, 1);
});

test('城市勋章与身份卡接口同时失败时进入完整错误态', async () => {
  requests = [];
  const page = loadPage();
  await loadWall(page, null, null, { wallStatus: 'fail', wallV2Status: 'fail' });

  assert.equal(page.data.loadFail, true);
  assert.equal(page.data.partialFail, false);
  assert.equal(page.data.badges.length, 0);
});

test('身份卡目录为非数组或含非对象项时进入完整错误态，不把坏 payload 当成空墙', async () => {
  for (const identity of [{}, [null], ['bad-row']]) {
    requests = [];
    const page = loadPage();
    await loadWall(page, { medals: [] }, { identity });
    assert.equal(page.data.loadFail, true, `identity=${JSON.stringify(identity)} 应 fail-closed`);
    assert.equal(page.data.partialFail, false);
    assert.deepEqual(page.data.badges, []);
  }
});

test('城市纪念章列表为坏结构时保留真实身份卡并进入部分错误态', async () => {
  for (const medals of [{}, [null], ['bad-row']]) {
    requests = [];
    const page = loadPage();
    await loadWall(page, { medals }, {
      identity: [{ badgeCode: 'FIRST_STEP', badgeName: '开始在场', category: 'EXPLORE', unlocked: true }],
    });
    assert.equal(page.data.loadFail, false);
    assert.equal(page.data.partialFail, true, `medals=${JSON.stringify(medals)} 应标记结果不完整`);
    assert.equal(page.data.badges.length, 1);
    assert.equal(page.data.badges[0].name, '开始在场');
  }
});

test('勋章墙接管请求错误显示，两个接口必须关闭 request-client 自动 toast', () => {
  const source = fs.readFileSync(PAGE_PATH, 'utf8');
  const reqBlock = source.slice(source.indexOf('function req('), source.indexOf('Page({'));
  const requestWrapper = fs.readFileSync(UI_STATE_REQUEST_PATH, 'utf8');
  assert.match(reqBlock, /sendUiStateRequest\(app,\s*url,/);
  assert.match(requestWrapper, /silentError:\s*true/);
  assert.match(requestWrapper, /case '\/api\/medal\/wall'/);
  assert.match(requestWrapper, /case '\/api\/badge\/wall-v2'/);
});

test('错误态返回页面时不能在隐藏 canvas 上重启 WebGL RAF', async () => {
  requests = [];
  const page = loadPage();
  page.data.viewMode = 'wall';
  let engineStarted = 0;
  page.engine = {
    setBadges() {},
    stop() {},
    closeDetail() {},
    start() { engineStarted += 1; },
  };

  await loadWall(page, null, null, { wallStatus: 'fail', wallV2Status: 'fail' });
  page.onShow();
  assert.equal(engineStarted, 0, '错误态 canvas 已隐藏，onShow 不得重启引擎');

  page.data.loadFail = false;
  page.data.partialFail = false;
  page.data.glFail = false;
  page.onShow();
  assert.equal(engineStarted, 1, '健康态返回页面仍应恢复引擎');
});
test('部分成功后重试若身份卡接口失败，必须清掉旧墙面快照', async () => {
  requests = [];
  const page = loadPage();
  let detailClosed = 0;
  let engineStopped = 0;
  page.engine = {
    setBadges() {},
    stop() { engineStopped += 1; },
    closeDetail() { detailClosed += 1; },
  };
  page.data.sheetOn = true;
  page.data.sheet = { name: '旧卡', rarZh: '探索', rarColor: '#30d158', desc: '旧内容', time: '2026-07-27', source: '旧来源', cond: '旧条件' };
  await loadWall(page, {
    medals: [{ medalName: '梧桐下的十分钟', getTime: '2026-07-27 08:30:00', condition: '完成绑定此勋章模板的城市节点' }]
  }, {
    identity: [{ badgeCode: 'FIRST_STEP', badgeName: '开始在场', category: 'EXPLORE', unlocked: true }]
  }, { wallStatus: 'fail' });
  assert.equal(page.data.partialFail, true);
  assert.equal(page.data.badges.length, 1);
  assert.equal(detailClosed, 1);

  requests = [];
  await loadWall(page, null, null, { wallV2Status: 'fail' });
  assert.equal(page.data.loadFail, true);
  assert.equal(page.data.partialFail, false);
  assert.deepEqual(page.data.badges, []);
  assert.equal(page.data.sheetOn, false);
  assert.deepEqual(page.data.sheet, { name: '', rarZh: '', rarColor: '', desc: '', time: '', source: '', cond: '' });
  assert.equal(detailClosed, 2);
  assert.equal(engineStopped, 2);
});

test('失败后成功重试必须重新绑定恢复后的 canvas 引擎', async () => {
  requests = [];
  const page = loadPage();
  let engineStopped = 0;
  let canvasRebound = 0;
  page.engine = {
    setBadges() {},
    stop() { engineStopped += 1; },
    closeDetail() {},
    destroy() {},
  };
  page.initCanvas = () => { canvasRebound += 1; };
  await loadWall(page, null, {
    identity: [{ badgeCode: 'FIRST_STEP', badgeName: '开始在场', category: 'EXPLORE', unlocked: true }]
  }, { wallStatus: 'fail' });
  assert.equal(page.data.partialFail, true);
  assert.equal(engineStopped, 1);

  requests = [];
  await loadWall(page, { medals: [] }, {
    identity: [{ badgeCode: 'FIRST_STEP', badgeName: '开始在场', category: 'EXPLORE', unlocked: true }]
  });
  assert.equal(page.data.partialFail, false);
  assert.equal(canvasRebound, 1);
});

test('完整失败后隐藏 canvas 造成 glFail 时，健康重试必须清除 glFail 并重新绑定', async () => {
  requests = [];
  const page = loadPage();
  const originalInitCanvas = page.initCanvas;
  const previousSelectorQuery = wx.createSelectorQuery;
  let selectorCalls = 0;
  wx.createSelectorQuery = () => ({
    in() { return this; },
    select() { return this; },
    fields() { return this; },
    exec(callback) {
      selectorCalls += 1;
      callback([]);
    },
  });

  try {
    page.data.viewMode = 'wall';
    await loadWall(page, null, null, { wallStatus: 'fail', wallV2Status: 'fail' });
    assert.equal(page.data.loadFail, true);

    // onReady 发生在错误态时 canvas 被隐藏，查询不到节点会置 glFail。
    originalInitCanvas.call(page);
    assert.equal(selectorCalls, 1);
    assert.equal(page.data.glFail, true);

    let canvasRebound = 0;
    page.initCanvas = () => { canvasRebound += 1; };
    requests = [];
    await loadWall(page, { medals: [] }, {
      identity: [{ badgeCode: 'FIRST_STEP', badgeName: '开始在场', category: 'EXPLORE', unlocked: true }],
    });

    assert.equal(page.data.loadFail, false);
    assert.equal(page.data.partialFail, false);
    assert.equal(page.data.glFail, false, '健康重试必须清除错误态遗留的 glFail');
    assert.equal(canvasRebound, 1, '健康重试必须重新绑定 canvas 引擎');
  } finally {
    wx.createSelectorQuery = previousSelectorQuery;
  }
});

test('纯 glFail 后两个接口健康重试必须清除 glFail 并重新绑定 canvas', async () => {
  requests = [];
  const page = loadPage();
  page.data.viewMode = 'wall';
  page.data.glFail = true;
  let canvasRebound = 0;
  page.initCanvas = () => { canvasRebound += 1; };

  await loadWall(page, { medals: [] }, { identity: [] });

  assert.equal(page.data.loadFail, false);
  assert.equal(page.data.partialFail, false);
  assert.equal(page.data.glFail, false, '纯 glFail 的健康重试必须清除渲染错误态');
  assert.equal(canvasRebound, 1, '纯 glFail 的健康重试必须重新绑定 canvas 引擎');
});
test('详情模板只在真实 cond 存在时显示条件行', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  assert.match(wxml, /class="bw-sm bw-sm--wide" wx:if="\{\{sheet\.cond\}\}"/);
  assert.match(wxml, /获得条件/);
  assert.match(wxml, /如何点亮/);
  assertErrorRetryContract(wxml);
  assert.match(wxml, /部分勋章数据未到达/);
  assert.match(wxml, /当前结果不完整，请重试获取全部勋章/);
});

test('列表视图没有 WebGL 引擎时仍可打开勋章详情', () => {
  const page = loadPage();
  page.data.viewMode = 'list';
  page.data.badges = [{
    name: '开始在场', rarity: 0, tierKey: 'EXPLORE', tierZh: '探索',
    locked: false, time: '2026-08-07', source: '城市身份卡', desc: '我开始在场。', cond: '',
  }];
  page.engine = null;

  assert.doesNotThrow(() => page.onFbTap({ currentTarget: { dataset: { idx: 0 } } }));
  assert.equal(page.data.sheetOn, true);
  assert.equal(page.data.sheet.name, '开始在场');
});

function assertErrorRetryContract(wxml) {
  assert.match(wxml, /wx:if="\{\{loadFail \|\| partialFail \|\| \(glFail && viewMode === 'wall'\)\}\}"/);
  assert.match(wxml, /glFail \? '勋章墙渲染失败'/);
  assert.match(wxml, /<cy-error class="bw-error-state"[\s\S]*retry="重试" bind:retry="loadData"/);
  assert.match(wxml, /<scroll-view class="bw-list" scroll-y wx:if="\{\{viewMode === 'list' && badges\.length && !loadFail && !partialFail\}\}"/);
  assert.doesNotMatch(wxml, /bw-err-btn|class="bw-err"/);
}

test('负控：glFail 不按墙模式隔离或列表重新依赖 WebGL 时契约必须变红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  assertErrorRetryContract(wxml);

  const globalGlFail = wxml.replace("loadFail || partialFail || (glFail && viewMode === 'wall')", 'loadFail || partialFail || glFail');
  assert.throws(() => assertErrorRetryContract(globalGlFail));

  const listDependsOnGl = wxml.replace(
    "viewMode === 'list' && badges.length && !loadFail && !partialFail",
    "viewMode === 'list' && badges.length && !loadFail && !partialFail && !glFail",
  );
  assert.throws(() => assertErrorRetryContract(listDependsOnGl));
});

function assertCanvasOnlyRendersWhenDataIsHealthy(wxml) {
  assert.match(wxml, /<canvas wx:if="\{\{!glFail && !loadFail && !partialFail\}\}"/);
}

test('接口失败时切走原生 canvas，错误提示不能被 WebGL 层遮住', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  assertCanvasOnlyRendersWhenDataIsHealthy(wxml);
  assert.throws(() => assertCanvasOnlyRendersWhenDataIsHealthy(
    wxml.replace('!glFail && !loadFail && !partialFail', '!glFail')
  ));
});

function assertStaticFallbackContract(wxml, pageJson) {
  assert.doesNotMatch(wxml, /🎖️/, '静态降级不能保留正式界面 emoji');
  assert.match(wxml, /<cy-icon\s+name="star"\s+size="48"\s*\/>/);
  assert.match(wxml, /aria-role="img"/);
  assert.match(wxml, /aria-label="默认勋章图标"/);
  assert.equal(pageJson.usingComponents && pageJson.usingComponents['cy-icon'], '/components/cy/icon/index');
}

test('静态降级占位符使用已注册 cy-icon，并提供明确文本无障碍 fallback', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  const pageJson = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  assertStaticFallbackContract(wxml, pageJson);
});

test('负控：静态降级删掉 cy-icon 注册或回退 emoji 时契约必须变红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  const pageJson = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  assertStaticFallbackContract(wxml, pageJson);

  const missingRegistration = { ...pageJson, usingComponents: { ...pageJson.usingComponents } };
  delete missingRegistration.usingComponents['cy-icon'];
  assert.throws(() => assertStaticFallbackContract(wxml, missingRegistration));

  const emojiFallback = wxml.replace(/<cy-icon\s+name="star"\s+size="48"\s*\/>/, '🎖️');
  assert.throws(() => assertStaticFallbackContract(emojiFallback, pageJson));
});

test('负控：缺少 getTime/真实条件时详情断言必须变红', async () => {
  requests = [];
  const page = loadPage();
  await loadWall(page, {
    medals: [{
      templateId: 18,
      medalName: '没有来源字段的勋章',
      awardTime: '2026-07-27 08:30:00',
      createTime: '2026-07-27 08:30:00',
    }],
  }, { identity: [] });
  const badge = page.data.badges[0];
  assert.equal(badge.time, '', '缺少 getTime 时不能从 awardTime/createTime 伪造获得日期');
  assert.equal(badge.cond, '', '缺少后端 condition 时不能由 templateId 伪造获得条件');
  assert.throws(() => assertCityDetails(badge), /2026-07-27|完成绑定此勋章模板的城市节点/);
});

test('负控：不可解析的获得日期不应把原始垃圾带入详情', async () => {
  requests = [];
  const page = loadPage();
  await loadWall(page, {
    medals: [{ templateId: 18, medalName: '坏日期勋章', getTime: 'not-a-date', condition: '完成绑定此勋章模板的城市节点' }],
  }, { identity: [] });

  assert.equal(page.data.badges[0].time, '');
  assert.equal(page.data.badges[0].cond, '完成绑定此勋章模板的城市节点');
});

test('负控：形似 YYYY-MM-DD 但月日不存在时不应带入详情', async () => {
  requests = [];
  const page = loadPage();
  await loadWall(page, {
    medals: [{ templateId: 18, medalName: '坏日期勋章', getTime: '2026-99-99', condition: '完成绑定此勋章模板的城市节点' }],
  }, { identity: [] });

  assert.equal(page.data.badges[0].time, '');
});

test('负控：日期前缀后的不可解析 suffix 不应被透传', async () => {
  for (const getTime of ['2024-01-01 garbage', '2024-01-01T25:00:00']) {
    requests = [];
    const page = loadPage();
    await loadWall(page, {
      medals: [{ templateId: 18, medalName: '坏日期后缀', getTime, condition: '完成绑定此勋章模板的城市节点' }],
    }, { identity: [] });

    assert.equal(page.data.badges[0].time, '', getTime);
  }
});

test('日期 wire 非契约类型与非有限数字必须 fail-closed，合法字符串与 finite timestamp 保持兼容', async () => {
  for (const getTime of [[0], ['2026-07-27'], { year: 2026, month: 7, day: 27 }, Infinity, -Infinity, NaN]) {
    requests = [];
    const page = loadPage();
    await loadWall(page, {
      medals: [{ medalName: '非契约日期', getTime, condition: '后端条件' }],
    }, { identity: [] });
    assert.equal(page.data.badges[0].time, '', `非契约日期应为空: ${String(getTime)}`);
  }

  for (const [getTime, expected] of [
    ['2026-07-27 08:30:00', '2026-07-27'],
    [Date.UTC(2026, 6, 27, 12, 0, 0), '2026-07-27'],
  ]) {
    requests = [];
    const page = loadPage();
    await loadWall(page, {
      medals: [{ medalName: '合法日期', getTime, condition: '后端条件' }],
    }, { identity: [] });
    assert.equal(page.data.badges[0].time, expected);
  }
});

test('displayDate 对零值、负值与任意 JS Date 可解析字符串 fail-closed', async () => {
  for (const getTime of [
    0, '0', -1, '07/27/2026', 'March 7, 2026',
    [], [0], {}, true, false, NaN, Infinity, -Infinity,
  ]) {
    requests = [];
    const page = loadPage();
    await loadWall(page, {
      medals: [{ medalName: '非契约日期', getTime, condition: '后端条件' }],
    }, { identity: [] });
    assert.equal(page.data.badges[0].time, '', `非契约日期应为空: ${String(getTime)}`);
  }
});

test('displayDate 严格校验 wire 时间并按中国日历日显示，不受 TZ=UTC 影响', async () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    for (const [getTime, expected] of [
      ['2026-07-27', '2026-07-27'],
      ['2026-07-26T16:00:00Z', '2026-07-27'],
      ['2026-07-26T23:59:59.123+08:00', '2026-07-26'],
      [Date.UTC(2026, 6, 26, 16, 0, 0), '2026-07-27'],
    ]) {
      requests = [];
      const page = loadPage();
      await loadWall(page, {
        medals: [{ medalName: '中国日期', getTime, condition: '后端条件' }],
      }, { identity: [] });
      assert.equal(page.data.badges[0].time, expected, String(getTime));
    }
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test('displayDate 对非法日期时间、毫秒与时区 suffix fail-closed', async () => {
  for (const getTime of [
    '2026-02-29',
    '2026-07-27T24:00:00',
    '2026-07-27T12:60:00',
    '2026-07-27T12:00:60',
    '2026-07-27T12:00:00.1234Z',
    '2026-07-27T12:00:00+24:00',
    '2026-07-27T12:00:00+08:60',
  ]) {
    requests = [];
    const page = loadPage();
    await loadWall(page, {
      medals: [{ medalName: '坏 wire 日期', getTime, condition: '后端条件' }],
    }, { identity: [] });
    assert.equal(page.data.badges[0].time, '', getTime);
  }
});

// 2026-09-24 用户:「勋章墙城市身份卡不用写」「上面的那些颜色说明也要删掉」
test('★列表不写「城市身份卡」分组标题、详情来源不带它;图例数据不再产出', async () => {
  requests = [];
  const page = loadPage();
  await loadWall(page, { medals: [] }, {
    identity: [{ badgeCode: 'FIRST_STEP', badgeName: '开始在场', category: 'EXPLORE', unlocked: false }]
  });
  assert.equal(page.data.badgeGroups.length, 1);
  assert.equal(page.data.badgeGroups[0].title, '', '身份卡那一组不写标题');
  assert.ok(!/城市身份卡/.test(page.data.badges[0].source), '来源里不写城市身份卡');
  assert.ok(!('legend' in page.data), '图例删了就不该再产出数据');
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  assert.match(wxml, /<text class="bw-list-h" wx:if="\{\{group\.title\}\}">/, '没有标题的分组不渲染标题行');
});

test('★勋章没名字时的兜底名也不写「城市身份卡」;截图素材 B66/B67 不再塞图例与身份卡标题', async () => {
  requests = [];
  const page = loadPage();
  await loadWall(page, { medals: [] }, { identity: [{ badgeCode: 'FIRST_STEP', badgeName: '', category: 'EXPLORE', unlocked: false }] });
  assert.ok(page.data.badges[0].name, '兜底名不能是空');
  assert.ok(!/城市身份卡/.test(page.data.badges[0].name), '兜底名还是城市身份卡');
  assert.ok(!('rarKey' in page.data.sheet), 'rarKey 没人读了');
  const fx = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../scripts/fixtures.json'), 'utf8'));
  for (const id of ['B66', 'B67']) {
    assert.ok(!('legend' in fx[id].data) && fx[id].switchKeys.indexOf('legend') < 0, id + ' 还在塞图例');
    assert.ok(!/城市身份卡/.test(JSON.stringify(fx[id])), id + ' 还写着城市身份卡');
  }
  for (const f of ['../../scripts/shot-matrix.js', '../../scripts/_gen_fixtures.js']) {
    const src = fs.readFileSync(path.resolve(__dirname, f), 'utf8');
    const b66 = src.split('\n').filter((l) => /B66/.test(l) || /badgeGroups: \[\{ key: 'identity'/.test(l)).join('\n');
    assert.ok(!/城市身份卡/.test(b66), f + ' 的 B66 还写着城市身份卡');
  }
});
