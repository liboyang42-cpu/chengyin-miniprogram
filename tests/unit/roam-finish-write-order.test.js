const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')

const ROAM_PAGE = '../../pages/roam/index.js'

let pageConfig
let requests
let storage

global.getApp = () => ({
  getUserID: () => '9',
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getStorageSync: key => storage[key],
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
  getRandomValues: options => options.success({ randomValues: new Uint8Array(16).fill(17).buffer }),
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  showLoading() {},
  hideLoading() {},
  showToast() {},
}

global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  pageConfig = null
  requests = []
  storage = {}
})

function setByPath(target, path, value) {
  const parts = path.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage() {
  delete require.cache[require.resolve(ROAM_PAGE)]
  require(ROAM_PAGE)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([path, value]) => setByPath(page.data, path, value))
    if (callback) callback()
  }
  return page
}

// 保留真实结束、揭雾、地点与探店 handler，只替换地图渲染和本地存档。
function prepareArrive(page, distM) {
  page.data.visit = { active: false }
  page.data.screen = 'map'
  page.data.paused = false
  page.data.medal = { show: false }
  page._stats = { explorePct: 12, time: '00:03:00', distance: '0.0' }
  page._pois = []
  page._foundRoamPois = {}
  page._clientSessionKey = '11111111111111111111111111111111'
  page._sessionPhotos = []
  page._reveals = []
  page._pendingTiles = []
  page._dist = distM
  page._npc = null
  page._eventId = 0
  page._stopClock = () => {}
  page._stopReal = () => {}
  page._triggerCelebration = () => {}
  page._saveSession = () => {}
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const finishCalls = () => requests.filter((r) => r.url === '/api/roam/finish');
const revealCalls = () => requests.filter((r) => r.url === '/api/roam/reveal');

test('结束等待在途 reveal 和余下不足50格，再使用 bootstrap 回执的 sid', async () => {
  const page = loadPage(); prepareArrive(page, 44.528);
  page._pendingTiles = Array.from({ length: 201 }, (_, i) => String(i));
  page._flushReveal();
  page._arrive();
  assert.equal(finishCalls().length, 0);
  revealCalls()[0].success({ code: 200, data: { sessionId: 88 } });
  await tick();
  assert.equal(revealCalls().length, 2);
  assert.equal(finishCalls().length, 0);
  revealCalls()[1].success({ code: 200, data: { sessionId: 88 } });
  await tick();
  assert.equal(finishCalls().length, 1);
  assert.equal(finishCalls()[0].data.sessionId, '88');
});

test('揭雾失败保留队列、禁止 finish，人工重试成功后才结算', async () => {
  const page = loadPage(); prepareArrive(page, 10); page._roamSid = 88;
  page._pendingTiles = ['a'];
  page._arrive(); revealCalls()[0].fail(); await tick();
  assert.equal(finishCalls().length, 0);
  assert.deepEqual(page._pendingTiles, ['a']);
  assert.equal(page.data.finish.settleErr, 'reveal');
  page.retrySettle();
  revealCalls()[1].success({ code: 200, data: { sessionId: 88 } }); await tick();
  assert.equal(finishCalls().length, 1);
});

test('bootstrap HTTP异常沿用unknown，不清队列、不重放sid0、不结算', async () => {
  const page = loadPage(); prepareArrive(page, 10); page._pendingTiles = ['a'];
  page._arrive(); revealCalls()[0].successStatusAbnormal({ statusCode: 502 }); await tick();
  assert.equal(page.data.finish.settleErr, 'bootstrap');
  page.retrySettle(); await tick();
  assert.equal(revealCalls().length, 1); assert.equal(finishCalls().length, 0);
  assert.deepEqual(page._pendingTiles, ['a']);
});

test('重复结束和重试共享在途结算，空队列正常结算', async () => {
  const page = loadPage(); prepareArrive(page, 10); page._roamSid = 88;
  page._arrive(); page._arrive(); page.retrySettle();
  assert.equal(finishCalls().length, 1);
  finishCalls()[0].success({ code: 200, data: { totalXp: 5 } }); await tick();
  assert.equal(page.data.finish.xpAwarded, 5);
});

test('旧会话reveal回执不能写新sid、移除新队列或发finish', async () => {
  const page = loadPage(); prepareArrive(page, 10); page._roamWriteGeneration = 1;
  page._pendingTiles = ['old']; page._arrive();
  page._roamWriteGeneration = 2; page._pendingTiles = ['new']; page._roamSid = 99;
  revealCalls()[0].success({ code: 200, data: { sessionId: 88 } }); await tick();
  assert.equal(page._roamSid, 99); assert.deepEqual(page._pendingTiles, ['new']);
  assert.equal(finishCalls().length, 0);
});

function preparePoi(page) {
  page._roamSid = 88; page._player = { lat: 31, lng: 121 };
  page._pois = [{ id: 1, _roamId: 9, cat: 'landmark', state: 'near' }];
  page._syncMarkers = () => {}; page._syncSparkCircles = () => {};
}

test('地点确认成功回执处理后才结束，结束等待期间重复点击不重复结算', async () => {
  const page = loadPage(); prepareArrive(page, 10); preparePoi(page);
  page.discoverRoamPoi(1); page._arrive(); page._arrive();
  assert.equal(finishCalls().length, 0); assert.equal(page.data.screen, 'map');
  requests.find((r) => r.url === '/api/roam/poi/discover').success({ code: 200, data: { meaning: '确认' } });
  await tick();
  assert.equal(finishCalls().length, 1); assert.equal(finishCalls()[0].data.poiIds, '9');
});

test('地点失败保留地图和人工重试，重试成功后仍可正常结束', async () => {
  const page = loadPage(); prepareArrive(page, 10); preparePoi(page);
  page.data.paceCard = page._paceCardFor(page._pois[0]);
  page.discoverRoamPoi(1); page._arrive();
  requests.find((r) => r.url === '/api/roam/poi/discover').fail(); await tick();
  assert.equal(finishCalls().length, 0); assert.equal(page.data.screen, 'map');
  assert.equal(page.data.paceCard.checkinRetryable, true);
  page.retryRoamPoiDiscover();
  requests.filter((r) => r.url === '/api/roam/poi/discover')[1].success({ code: 200, data: {} }); await tick();
  page._arrive(); assert.equal(finishCalls().length, 1);
});

test('地点unknown保留既有不可盲重试提示，不结束', async () => {
  const page = loadPage(); prepareArrive(page, 10); preparePoi(page);
  page.discoverRoamPoi(1); page._arrive();
  requests.find((r) => r.url === '/api/roam/poi/discover').successStatusAbnormal({ statusCode: 502 }); await tick();
  assert.equal(page.data.screen, 'map'); assert.equal(page.data.paceCard.checkinRetryable, false);
  page.retryRoamPoiDiscover(); assert.equal(requests.filter((r) => r.url === '/api/roam/poi/discover').length, 1);
  assert.equal(finishCalls().length, 0);
});

test('真实探店失败不留失败态:卡收起,整趟仍可正常结束', async () => {
  const page = loadPage(); prepareArrive(page, 10); preparePoi(page);
  page._pois = [{ id: 1, _roamId: 9, cat: 'merchant', state: 'near' }];
  page._syncGoal = () => {};
  page.startVisit(1); page._arrive();
  assert.equal(finishCalls().length, 0); assert.equal(page.data.visit.active, true);
  requests.find((r) => r.url === '/api/roam/shop/visit').fail(); await tick();
  // 拍板 9-16:打卡不存在失败态 —— 失败只提示,浮卡收起,没有常驻失败卡/重试钮。
  assert.equal(page.data.visit.active, false, '失败后不许留失败浮卡');
  assert.equal(page.data.visit.checkinOk, false);
  assert.equal(page.data.visit.checkinErr, undefined);
  // 原病(C-12):失败浮卡常驻 + 没有放弃路径 ⇒ 玩家只能反复重试、连结算都做不了。
  // 现在失败态收起后,这一趟可以照常结束。
  page._arrive(); assert.equal(finishCalls().length, 1, '失败态收起后应能正常结束本次漫游');
});

test('探店失败后可重新打卡,成功后仍须玩家确认完成才结束', async () => {
  const page = loadPage(); prepareArrive(page, 10); preparePoi(page);
  page._pois = [{ id: 1, _roamId: 9, cat: 'merchant', state: 'near' }];
  page._syncGoal = () => {};
  page.startVisit(1);
  requests.find((r) => r.url === '/api/roam/shop/visit').fail(); await tick();
  // 走近后再点一次(与用户重新打卡同一条路),成功态照旧,仍需玩家自己确认完成。
  page.startVisit(1);
  requests.filter((r) => r.url === '/api/roam/shop/visit')[1].success({ code: 200, data: { recorded: true } }); await tick();
  assert.equal(page.data.visit.checkinOk, true);
  page._arrive(); assert.equal(finishCalls().length, 0, '不自动替玩家完成探店');
});

test('bootstrap成功壳缺少sid不能出队或结算', async () => {
  const page = loadPage(); prepareArrive(page, 10); page._pendingTiles = ['a'];
  page._arrive(); revealCalls()[0].success({ code: 200, data: {} }); await tick();
  assert.equal(finishCalls().length, 0); assert.deepEqual(page._pendingTiles, ['a']);
  assert.equal(page.data.finish.settleErr, 'bootstrap');
});

test('旧会话finish与discover回执不改新会话页面', async () => {
  const page = loadPage(); prepareArrive(page, 10); preparePoi(page);
  page._roamWriteGeneration = 1;
  page._postRoamFinish(10);
  page.discoverRoamPoi(1);
  page._roamWriteGeneration = 2;
  finishCalls()[0].success({ code: 200, data: { totalXp: 999 } });
  requests.find((r) => r.url === '/api/roam/poi/discover').success({ code: 200, data: {} }); await tick();
  assert.notEqual(page.data.finish.xpAwarded, 999); assert.deepEqual(page._foundRoamPois, {});
});
