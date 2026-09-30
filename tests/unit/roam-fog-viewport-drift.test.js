'use strict';

// 视口变化时「遮 or 不遮」的分级契约。
//
// 背景:.fogscreen-guard 是 inset:0 的不透明层,拉起来整页就是纯黑。原实现在 regionchange
// begin 无条件拉黑,而 center 是数据绑定 —— 走路时每次定位回调都改它,同样派发 regionchange
// ⇒ 边走边揭全程黑闪。但也不能一律不遮:手势拖拽/缩放期间拿不到中间态 region,旧帧错位会一路
// 放大到松手,那时确实会把成片没探过的地名亮出来(遮原生文字正是 screen 雾存在的理由)。
//
// 分级判据:手势 / 缩放变化 / 帧视口漂移超过半个揭示半径 → 遮;程序跟随的米级位移 → 不遮。

const assert = require('assert');
const test = require('node:test');

let pageConfig;
global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest() {},
});
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  createSelectorQuery: () => ({
    select: () => ({ fields: () => ({ exec: (cb) => cb([{ node: null }]) }) }),
  }),
};
global.Page = (config) => { pageConfig = config; };

const CENTER = { lat: 31.23, lng: 121.47 };
// 当前帧对应的视口:中心恰好是 CENTER
const FRAME_REGION = {
  southwest: { latitude: 31.225, longitude: 121.465 },
  northeast: { latitude: 31.235, longitude: 121.475 },
};

function loadRoamPage() {
  delete require.cache[require.resolve('../../pages/roam/index.js')];
  require('../../pages/roam/index.js');
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = (patch, cb) => { Object.assign(page.data, patch); if (cb) cb(); };
  page._reveals = [];
  page._historyReveals = [];
  return page;
}

/** 摆好一个「screen 雾正常显示中」的页面:已有帧、没遮罩 */
function screenPageAt(center) {
  const page = loadRoamPage();
  page._fogMode = 'screen';
  page._mapScale = 17;
  page._fogScreenLastRegion = FRAME_REGION;
  page.data.center = center || { ...CENTER };
  page.data.fogScreenGuard = false;
  return page;
}

function cleanup(page) {
  ['_fogScreenRenderTimer', '_fogScreenRegionTimer'].forEach((key) => {
    if (page[key]) { clearTimeout(page[key]); page[key] = null; }
  });
}

test('走路跟随(causedBy=update)在 begin 不拉黑遮罩', () => {
  const page = screenPageAt();
  page.onRegionChange({ detail: { phase: 'begin', causedBy: 'update' } });
  assert.strictEqual(page.data.fogScreenGuard, false,
    '程序跟随导致的 regionchange 若照旧拉黑,边走边揭就是持续黑闪');
  cleanup(page);
});

test('手势拖拽在 begin 立刻拉黑(拖动期间没有中间态 region,错位会一路放大)', () => {
  const page = screenPageAt();
  page.onRegionChange({ detail: { phase: 'begin', causedBy: 'drag' } });
  assert.strictEqual(page.data.fogScreenGuard, true,
    '手势期间不遮 = 旧帧错位越拖越大,会把没探过的地名成片亮出来');
  cleanup(page);
});

test('end:帧视口漂移在半个揭示半径内 → 保留旧帧不拉黑', () => {
  // 约 11m 漂移,阈值 REVEAL_M/2 = 27.5m
  const page = screenPageAt({ lat: 31.2301, lng: 121.47 });
  page.onRegionChange({ detail: { phase: 'end', causedBy: 'update', scale: 17 } });
  assert.strictEqual(page.data.fogScreenGuard, false,
    '米级漂移只在视口边缘多露一条窄边,不该付一次全屏黑');
  cleanup(page);
});

test('end:帧视口漂移超过半个揭示半径 → 拉黑', () => {
  // 约 111m 漂移,远超阈值
  const page = screenPageAt({ lat: 31.231, lng: 121.47 });
  page.onRegionChange({ detail: { phase: 'end', causedBy: 'update', scale: 17 } });
  assert.strictEqual(page.data.fogScreenGuard, true,
    '视口真的走远了,旧帧覆盖的已不是当前画面,必须遮');
  cleanup(page);
});

test('end:缩放变了必拉黑(旧帧尺寸整个不对)', () => {
  const page = screenPageAt();
  page.onRegionChange({ detail: { phase: 'end', causedBy: 'update', scale: 15 } });
  assert.strictEqual(page.data.fogScreenGuard, true,
    '缩放变化下旧帧的洞半径全错,比错位更离谱');
  cleanup(page);
});

test('还没画过第一帧时按「太远」处理,宁遮勿漏', () => {
  const page = screenPageAt();
  page._fogScreenLastRegion = null;
  assert.strictEqual(page._screenFogDriftTooFar(), true);
  cleanup(page);
});

test('onShow 对卡住的 guard 补一次重试(否则全黑且无出口)', () => {
  const page = screenPageAt();
  // 复现死路:guard 拉起来了,但 fogScreenError 是 false ⇒ 重试入口 wx:if 不显示
  page.data.fogScreenGuard = true;
  page.data.fogScreenError = false;
  page.data.screen = 'map';
  let retried = 0;
  page.retryScreenFog = () => { retried += 1; };
  page.onShow();
  assert.strictEqual(retried, 1,
    'tabBar 页实例常驻,不在 onShow 自愈就只能杀进程');
  cleanup(page);
});

test('onShow 不去打扰正常显示中的雾', () => {
  const page = screenPageAt();
  page.data.fogScreenGuard = false;
  page.data.screen = 'map';
  let retried = 0;
  page.retryScreenFog = () => { retried += 1; };
  page.onShow();
  assert.strictEqual(retried, 0, '没卡住就别重建,重建会闪一次');
  cleanup(page);
});

// _animateZoom 有 12 步,每步都 setData({mapScale}) ⇒ 每步派发一次 regionchange end,
// 每步 scaleChanged 都为真。若照常处理,整个动画期间就是纯黑(回中 550ms / 暂停概览 650ms),
// 而且 160ms 的重绘去抖被每步重置,黑到动画结束还要再等一轮。
test('缩放动画期间不再逐帧拉黑', () => {
  const page = screenPageAt()
  page._zoomLock = true
  page.onRegionChange({ detail: { phase: 'end', causedBy: 'update', scale: 14 } })
  assert.strictEqual(page.data.fogScreenGuard, false,
    '动画每一步都拉黑 = 点一次暂停概览就全黑约 1 秒')
  cleanup(page)
})

test('缩放动画期间仍然同步 _mapScale', () => {
  const page = screenPageAt()
  page._mapScale = 17
  page._zoomLock = true
  page.onRegionChange({ detail: { phase: 'end', causedBy: 'update', scale: 14 } })
  assert.strictEqual(page._mapScale, 14,
    '漏掉这一步,动画收尾后第一次 end 会拿旧 scale 比出 scaleChanged=true,把省下的全黑原样加回去')
  cleanup(page)
})

test('拉远动画开场遮一次(洞会被放大成本不该露的区域)', () => {
  const page = screenPageAt()
  page.data.reducedMotion = false
  page._animateZoom(17, 14, 200, { lat: 31.23, lng: 121.47 })   // to < from = 拉远
  assert.strictEqual(page.data.fogScreenGuard, true,
    '拉远时同样像素对应更多米,旧帧的洞会把没探过的地名成片亮出来,这次黑不能省')
  if (page._zoomAnim) { clearInterval(page._zoomAnim); page._zoomAnim = null }
  cleanup(page)
})

test('拉近动画不遮(洞覆盖范围变小,偏保守)', () => {
  const page = screenPageAt()
  page.data.reducedMotion = false
  page._animateZoom(14, 17, 200, { lat: 31.23, lng: 121.47 })   // to > from = 拉近
  assert.strictEqual(page.data.fogScreenGuard, false,
    '拉近时旧帧露出的地理范围比该露的小,不泄露 ⇒ 不该付一次全黑')
  if (page._zoomAnim) { clearInterval(page._zoomAnim); page._zoomAnim = null }
  cleanup(page)
})

test('onShow 在非地图屏不触发重试', () => {
  const page = screenPageAt();
  page.data.fogScreenGuard = true;
  page.data.screen = 'intro';
  let retried = 0;
  page.retryScreenFog = () => { retried += 1; };
  page.onShow();
  assert.strictEqual(retried, 0, '没在地图屏就没有雾要救');
  cleanup(page);
});
