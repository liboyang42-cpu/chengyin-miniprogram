'use strict';

// screen 主路径失败必须显式全黑并可重试，不能回到会浮出腾讯文字的 map 内雾。
// 旧 overlay/poly helper 仍须 fail-closed 为有雾，不能静默清空。

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

function loadRoamPage() {
  delete require.cache[require.resolve('../../pages/roam/index.js')];
  require('../../pages/roam/index.js');
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = (patch, cb) => { Object.assign(page.data, patch); if (cb) cb(); };
  page._c = { lat: 31.23, lng: 121.47 };
  page._reveals = [];
  page._historyReveals = [];
  return page;
}

function makeFogContext() {
  const calls = { arcs: [], fills: 0, gradients: 0 };
  const context = {
    createRadialGradient() {
      calls.gradients++;
      return { addColorStop() {} };
    },
    beginPath() {},
    arc(x, y, radius) { calls.arcs.push({ x, y, radius }); },
    fill() { calls.fills++; },
  };
  return { calls, context };
}

function radialContourError(fog, radiusM) {
  const { CELL, HALF, N, st } = fog;
  const lo = Math.max(0, Math.floor((HALF - radiusM - CELL * 2) / CELL));
  const hi = Math.min(N - 2, Math.ceil((HALF + radiusM + CELL * 2) / CELL));
  let maxErrorM = 0;
  let edgeCount = 0;
  for (let j = lo; j <= hi; j++) {
    for (let i = lo; i <= hi; i++) {
      const k = j * N + i;
      const clear = st[k] === 0;
      if (clear !== (st[k + 1] === 0)) {
        const x = (i + 1) * CELL - HALF;
        [j * CELL - HALF, (j + 1) * CELL - HALF].forEach((y) => {
          maxErrorM = Math.max(maxErrorM, Math.abs(Math.hypot(x, y) - radiusM));
        });
        edgeCount++;
      }
      if (clear !== (st[k + N] === 0)) {
        const y = (j + 1) * CELL - HALF;
        [i * CELL - HALF, (i + 1) * CELL - HALF].forEach((x) => {
          maxErrorM = Math.max(maxErrorM, Math.abs(Math.hypot(x, y) - radiusM));
        });
        edgeCount++;
      }
    }
  }
  assert.ok(edgeCount > 0, '必须找到已探索区与雾区的边界');
  return maxErrorM;
}

function offsetPoint(center, eastM, northM) {
  return {
    lat: center.lat + northM / 111320,
    lng: center.lng + eastM / (111320 * Math.cos(center.lat * Math.PI / 180)),
  };
}

function fogStateAtOffset(fog, eastM, northM) {
  const i = Math.floor((eastM + fog.HALF) / fog.CELL);
  const j = Math.floor((northM + fog.HALF) / fog.CELL);
  return fog.st[j * fog.N + i];
}

test('screen canvas 不可用时显式阻断并可重试，不在背后白画 poly', async () => {
  const page = loadRoamPage();
  const ready = await page._setupFog();
  assert.strictEqual(ready, false);
  assert.strictEqual(page._fogMode, 'blocked');
  assert.strictEqual(page._fog, undefined, 'blocked 状态不应继续构建永远不可见的旧网格');
  assert.deepStrictEqual(page.data.fogPolys, [], 'blocked 状态不能把旧 map polygon 当作可用降级');
  assert.strictEqual(page.data.fogScreenGuard, true, 'screen 不可用时必须以全黑层遮住原生文字');
  assert.strictEqual(page.data.fogScreenError, true, 'screen 不可用时必须给用户可重试状态');
});

test('旧 overlay helper 中途失败仍回落到 poly,不清空雾', () => {
  const page = loadRoamPage();
  page._fogMode = 'overlay';           // 假装真机走上了 overlay
  page.data.fogPolys = [];
  page._fogFallbackToPoly();
  assert.strictEqual(page._fogMode, 'poly');
  assert.ok(page.data.fogPolys.length > 0, 'overlay 失败后必须仍有雾');
});

test('页面销毁后在途 getRegion 回调不能继续绘制或 setData', () => {
  const page = loadRoamPage();
  let regionSuccess;
  let draws = 0;
  page._fogLifecycleGen = 7;
  page._fogMode = 'screen';
  page._fogScreenG = {};
  page._fogScreenSize = { width: 400, height: 800 };
  page._mapCtx = { getRegion({ success }) { regionSuccess = success; } };
  page._drawScreenFog = () => { draws++; };

  page._renderScreenFog();
  assert.strictEqual(typeof regionSuccess, 'function', '应先留下一个真实在途地图回调');
  page._disposeFogRenderer();
  regionSuccess({
    southwest: { latitude: 31.22, longitude: 121.46 },
    northeast: { latitude: 31.24, longitude: 121.48 },
  });

  assert.strictEqual(draws, 0, '旧页面世代的 region 回调必须失效');
});

test('canvas setup 在页面销毁后到货也不能复活旧 renderer', async () => {
  const page = loadRoamPage();
  let selectorResult;
  const originalQuery = wx.createSelectorQuery;
  wx.createSelectorQuery = () => ({
    select: () => ({ fields: () => ({ exec(cb) { selectorResult = cb; } }) }),
  });
  try {
    page._fogLifecycleGen = 11;
    const setup = page._setupFog(11);
    page._disposeFogRenderer();
    selectorResult([{ node: { getContext: () => ({ scale() {} }) }, width: 400, height: 800 }]);
    assert.strictEqual(await setup, false, '销毁必须结清旧 setup Promise');
    assert.strictEqual(page._fogMode, null, '迟到 canvas 不能复活 screen 模式');
    assert.strictEqual(page._fogScreenG, null, '迟到 canvas 不能重新挂回绘图上下文');
  } finally {
    wx.createSelectorQuery = originalQuery;
  }
});

test('当前 screen image 解码失败时保持全黑，不回退到会浮字的 map polygon', () => {
  const page = loadRoamPage();
  page._fogLifecycleGen = 3;
  page._fogScreenVersion = 8;
  page._fogMode = 'screen';
  page.data.fogScreenLayers = [{ generation: 3, version: 8, src: '/tmp/fog-8.png', loaded: false }];
  page.data.fogScreenGuard = false;

  page.onFogScreenError({
    currentTarget: { dataset: { generation: 3, version: 8 } },
    detail: { errMsg: 'decode failed' },
  });

  assert.strictEqual(page._fogMode, 'screen', 'image 失败不能退回 map 内 poly');
  assert.strictEqual(page.data.fogScreenGuard, true, 'image 失败必须立刻全黑 fail-closed');
  assert.strictEqual(page.data.fogScreenError, true, 'image 失败必须显示可重试状态');
});

test('全黑等待或失败态直接拦住原生 POI，不允许盲点到店', () => {
  const page = loadRoamPage();
  const originalGetApp = global.getApp;
  let requests = 0;
  global.getApp = () => ({ globalData: { user_id: 9, features: {} }, sendRequest() { requests++; } });
  page.data.fogScreenGuard = true;
  page._fogMode = 'poly';
  try {
    page.onPoiTap({ detail: { name: '黑雾下的店', latitude: 31.23, longitude: 121.47 } });
    assert.strictEqual(requests, 0, '全黑 guard 下的原生 POI 事件必须在请求前终止');
  } finally {
    global.getApp = originalGetApp;
  }
});

test('地图视野变化立即全黑并作废在途 image，直到新版本 load', () => {
  const page = loadRoamPage();
  page._fogLifecycleGen = 4;
  page._fogMode = 'screen';
  page._fogScreenVersion = 12;
  page.data.fogScreenGuard = false;
  page.data.fogScreenLayers = [{ generation: 4, version: 12, src: '/tmp/fog-12.png', loaded: false }];
  let scheduled = 0;
  page._scheduleScreenFogRender = () => { scheduled++; };

  page.onRegionChange({ detail: { phase: 'begin', causedBy: 'drag' } });
  assert.strictEqual(page.data.fogScreenGuard, true, '拖拽开始必须先盖全黑层');
  assert.strictEqual(page._fogScreenVersion, 13, '拖拽开始必须作废在途 image 世代');
  page.onFogScreenLoad({ currentTarget: { dataset: { generation: 4, version: 12 } } });
  assert.strictEqual(page.data.fogScreenGuard, true, '迟到的旧 image load 不能撤掉过渡黑层');

  page.onRegionChange({ detail: { phase: 'end', causedBy: 'drag', scale: 17 } });
  assert.strictEqual(scheduled, 1, '拖拽结束必须安排当前视野的新遮罩');
  assert.strictEqual(page.data.fogScreenGuard, true, '新 image load 前必须继续全黑');
});

test('首张当前世代 image load 前不启动计时或持续定位', () => {
  const page = loadRoamPage();
  page._fogLifecycleGen = 6;
  page._fogMode = 'screen';
  page._fogScreenG = {};
  page._fogStartPending = { p: page._c, startTracking: true, generation: 6 };
  page._addReveal = () => {};
  let clocks = 0;
  let locations = 0;
  page._startClock = () => { clocks++; };
  page._startReal = () => { locations++; };

  page._activateRoamAfterFog(page._c, true, 6);
  assert.strictEqual(clocks, 0, 'canvas context 就绪后不能提前计时');
  assert.strictEqual(locations, 0, 'canvas context 就绪后不能提前持续定位');

  page.data.fogScreenReady = true;
  page._completeRoamAfterFogLoad(6);
  assert.strictEqual(clocks, 1, '首张 image load 后应启动一次计时');
  assert.strictEqual(locations, 1, '首张 image load 后应启动一次持续定位');
  page._completeRoamAfterFogLoad(6);
  assert.strictEqual(clocks, 1, '重复 load 不得重复启动计时');
  assert.strictEqual(locations, 1, '重复 load 不得重复启动持续定位');
});

test('已探索点会在雾上擦出洞(降级路径的擦除真的生效)', async () => {
  const page = loadRoamPage();
  page._fogToPoly();
  const before = page._fog.st.reduce((a, b) => a + b, 0);
  page._fogApplyReveal({ lat: 31.23, lng: 121.47 });
  const after = page._fog.st.reduce((a, b) => a + b, 0);
  assert.ok(after < before, '揭雾后网格总浓度必须下降');
});

test('overlay 揭雾使用单色硬边圆,不再创建径向渐变', () => {
  const page = loadRoamPage();
  const { calls, context } = makeFogContext();
  page._fogG = context;
  page._stampReveal(page._c, 1);
  assert.strictEqual(calls.gradients, 0, '硬边揭雾不应创建径向渐变');
  assert.strictEqual(calls.arcs.length, 1, '揭雾应绘制一个圆形擦除区');
  assert.ok(calls.arcs[0].radius > 0, '圆形擦除区必须有有效半径');
  assert.strictEqual(calls.fills, 1, '圆形擦除区必须真正填充');
});

test('poly 揭雾只有清除与全雾两态,不存在透明度过渡环', async () => {
  const page = loadRoamPage();
  page._fogToPoly();
  page._fogApplyReveal(page._c);
  const positiveLevels = new Set(page._fog.st);
  positiveLevels.delete(0);
  assert.strictEqual(positiveLevels.size, 1, '硬边迷雾不应保留多档透明度过渡环');
});

test('poly 硬边圆的完整阶梯轮廓误差不超过 1.4m', async () => {
  const page = loadRoamPage();
  page._fogToPoly();
  page._fogApplyReveal(page._c);
  const errorM = radialContourError(page._fog, 55);
  assert.ok(errorM <= 1.4, '径向轮廓误差 ' + errorM.toFixed(2) + 'm,硬边仍有明显台阶');
});

test('poly 连续 1km L 形路线仍保持百个量级 polygon 与小体积 setData', async (t) => {
  const page = loadRoamPage();
  page._fogToPoly();
  const route = Array.from({ length: 51 }, (_, i) => offsetPoint(page._c, (i - 25) * 10, 0))
    .concat(Array.from({ length: 51 }, (_, i) => offsetPoint(page._c, 250, i * 10)));
  route.forEach((point) => page._fogApplyReveal(point));
  page._updateFogNow();
  const polygonCount = page.data.fogPolys.length;
  const payloadBytes = Buffer.byteLength(JSON.stringify(page.data.fogPolys));
  t.diagnostic('fogPolys=' + polygonCount + ',setData=' + (payloadBytes / 1024).toFixed(1) + 'KiB');
  assert.ok(polygonCount < 500, '连续路线 polygon 数量失控:' + polygonCount);
  assert.ok(payloadBytes < 256 * 1024, 'fogPolys setData 体积失控:' + payloadBytes + 'B');
});

test('poly 800 个离散历史点会保留揭雾且压住 polygon/setData 上限', (t) => {
  const page = loadRoamPage();
  page._player = page._c;
  page._initFogGrid();
  const samples = [];
  for (let northM = -2400; northM <= 2400 && samples.length < 800; northM += 100) {
    for (let eastM = -2400; eastM <= 2400 && samples.length < 800; eastM += 100) {
      samples.push({ eastM, northM, point: offsetPoint(page._c, eastM, northM) });
    }
  }
  page._historyReveals = samples.map((sample) => sample.point);
  page._applyHistoryFog();
  page._updateFogNow();
  samples.forEach(({ eastM, northM }) => {
    assert.strictEqual(fogStateAtOffset(page._fog, eastM, northM), 0, '离散历史揭雾点不能被性能降级吞掉');
  });
  assert.ok(fogStateAtOffset(page._fog, -2350, -2350) > 0,
    '四个 55m 揭雾圆之间的未探索间隙必须保留雾,不能靠过度揭雾压 polygon');
  page._fogApplyReveal(page._c);
  const nextRevealErrorM = radialContourError(page._fog, 55);
  assert.ok(nextRevealErrorM <= 1.4,
    '超限保护后新揭雾仍须保持精细硬边,当前误差 ' + nextRevealErrorM.toFixed(2) + 'm');
  page._updateFogNow();
  const polygonCount = page.data.fogPolys.length;
  const payloadBytes = Buffer.byteLength(JSON.stringify(page.data.fogPolys));
  assert.ok(polygonCount > 4, '玩家周边的新揭雾必须进入 map-polygons,不能只剩全雾挡板');
  t.diagnostic('fogPolys=' + polygonCount + ',setData=' + (payloadBytes / 1024).toFixed(1) + 'KiB');
  assert.ok(polygonCount < 500, '离散历史 polygon 数量失控:' + polygonCount);
  assert.ok(payloadBytes < 256 * 1024, '离散历史 setData 体积失控:' + payloadBytes + 'B');

  const backtrack = samples[400].point;
  page._player = backtrack;
  page._reveals = [];
  page._gridHit = {};
  page._accumulateTile = () => {};
  let scheduled = 0;
  page._scheduleFogUpdate = () => { scheduled++; page._updateFogNow(); };
  page._addReveal(backtrack);
  assert.strictEqual(scheduled, 1, '裁窗后回走已探索区也必须重算玩家周边,不能被旧全雾挡板盖住');
  assert.ok(page.data.fogPolys.length > 4, '回走点周边必须重新显示已揭区域,不能只剩全雾挡板');
});

test('poly 最小渲染窗仍碎片过多时 fail-closed 为全雾,绝不发超限或空数组', () => {
  const page = loadRoamPage();
  page._player = page._c;
  page._initFogGrid();
  const F = page._fog;
  const lo = Math.floor((F.HALF - 80) / F.CELL);
  const hi = Math.floor((F.HALF + 80) / F.CELL);
  for (let j = lo; j <= hi; j++) {
    for (let i = lo; i <= hi; i++) F.st[j * F.N + i] = (i + j) % 2;
  }
  page._updateFogNow();
  assert.ok(page.data.fogPolys.length > 0, '极端碎片时不能退成什么都不画');
  assert.strictEqual(page.data.fogPolys.length, 1, '极端碎片必须收口成单块全雾,不能继续发送碎片 polygons');
  assert.strictEqual(page.data.fogPolys[0].fillColor, page._fogBandColor(1),
    'fail-closed 只能回到全雾,不能通过降低浓度或透明来伪装通过');
});
