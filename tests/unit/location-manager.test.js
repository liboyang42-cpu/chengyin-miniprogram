// Phase 4 位置选址封装 location-manager —— 先写失败测试(TDD RED)。
//
// 抽取 7 个 choosePoi 调用点共享的:城市校验拦截 / 取消静默 / 拒绝引导+提示 / 其它失败提示 /
// 成功归一化 {name,address,longitude,latitude}。依赖注入 wx,可脱离真机单测;另测不注入→回退全局 wx。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickLocation, showPermissionGuide, normalizePoi, getCurrentLocation } = require('../../utils/location/location-manager.js');

function makeWx(over) {
  const calls = { toasts: [], modals: [], openSetting: 0 };
  let chooseCb = null;
  const wx = Object.assign({
    chooseLocation: (opts) => { chooseCb = opts; },
    showToast: (o) => calls.toasts.push(o && o.title),
    showModal: (o) => { calls.modals.push(o); if (o && o.success) o.success({ confirm: true }); },
    openSetting: (opts) => { calls.openSetting++; if (opts && opts.success) opts.success({ authSetting: {} }); },
  }, over);
  // 与 wx 同样注入 toast,断言文案走同一个 calls.toasts
  const toast = (title) => calls.toasts.push(title);
  const modal = (o) => wx.showModal(o);   // 确认弹窗同样注入,断言仍看 calls.modals
  return {
    wx, toast, modal, calls,
    succeed: (res) => chooseCb.success(res),
    failWith: (errMsg) => chooseCb.fail({ errMsg }),
  };
}

test('normalizePoi:取 name/address/longitude/latitude', () => {
  assert.deepEqual(
    normalizePoi({ name: 'A', address: 'B', longitude: 1, latitude: 2, extra: 'x' }),
    { name: 'A', address: 'B', longitude: 1, latitude: 2 }
  );
});

test('正常成功 → onPick 收到归一化 poi + 原始 res,无错误 toast', () => {
  const m = makeWx();
  let picked = null; let raw = null;
  pickLocation({ onPick: (p, r) => { picked = p; raw = r; } }, { wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });
  m.succeed({ type: 0, name: '星巴克', address: '南京路1号', longitude: 121.1, latitude: 31.2, poiId: 'x' });
  assert.deepEqual(picked, { name: '星巴克', address: '南京路1号', longitude: 121.1, latitude: 31.2 });
  assert.equal(raw.poiId, 'x');
  assert.equal(m.calls.toasts.length, 0);
});

test('POI 只有地址没有坐标 → 精确命中坐标闸，不得回调 onPick', () => {
  const m = makeWx();
  let picked = null; let failed = null;
  pickLocation({
    onPick: (p) => { picked = p; },
    onFail: (err) => { failed = err; },
  }, { wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });
  m.succeed({ type: 0, name: '旧码头', address: '滨江路 8 号' });

  assert.equal(picked, null);
  assert.deepEqual(m.calls.toasts, ['没找到该地点坐标，请换个词重选']);
  assert.equal(failed && failed.code, 'POI_COORDS_MISSING',
    '必须由坐标闸给出可指认错误码，不能被相邻的城市/权限闸接住');
});

test('POI 坐标越界也不算可用坐标，不能录入成功', () => {
  const m = makeWx();
  let picked = null; let failed = null;
  pickLocation({
    onPick: (p) => { picked = p; },
    onFail: (err) => { failed = err; },
  }, { wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });
  m.succeed({ type: 0, name: '错误坐标地点', address: '测试路 1 号', longitude: 181, latitude: 31.2 });

  assert.equal(picked, null);
  assert.deepEqual(m.calls.toasts, ['没找到该地点坐标，请换个词重选']);
  assert.equal(failed && failed.code, 'POI_COORDS_MISSING');
});

test('用户取消 → 静默,无 toast、不引导', () => {
  const m = makeWx();
  let picked = null;
  pickLocation({ onPick: (p) => { picked = p; } }, { wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });
  m.failWith('chooseLocation:fail cancel');
  assert.equal(m.calls.toasts.length, 0);
  assert.equal(m.calls.modals.length, 0);
  assert.equal(picked, null);
});

test('拒绝授权(默认 guideOnDeny)→ 引导 modal + 「需要位置权限」toast', () => {
  const m = makeWx();
  pickLocation({ onPick: () => {} }, { wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });
  m.failWith('chooseLocation:fail auth deny');
  assert.equal(m.calls.modals.length, 1, '弹引导');
  assert.equal(m.calls.openSetting, 1, 'confirm 后去设置');
  assert.deepEqual(m.calls.toasts, ['需要位置权限，请在设置中开启']);
});

test('拒绝授权 guideOnDeny=false(如 merchantapply1)→ 不引导,仍 toast', () => {
  const m = makeWx();
  pickLocation({ onPick: () => {}, guideOnDeny: false }, { wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });
  m.failWith('chooseLocation:fail permission denied');
  assert.equal(m.calls.modals.length, 0, '不引导');
  assert.deepEqual(m.calls.toasts, ['需要位置权限，请在设置中开启']);
});

test('其它失败 → 「选择地点失败」toast,不引导', () => {
  const m = makeWx();
  pickLocation({ onPick: () => {} }, { wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });
  m.failWith('chooseLocation:fail system error');
  assert.deepEqual(m.calls.toasts, ['选择地点失败']);
  assert.equal(m.calls.modals.length, 0);
});

test('showPermissionGuide → 去设置 modal,confirm 调 openSetting', () => {
  const m = makeWx();
  showPermissionGuide({ wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });
  assert.equal(m.calls.modals.length, 1);
  assert.equal(m.calls.modals[0].confirmText, '去设置');
  assert.equal(m.calls.openSetting, 1);
});

test('设置页授予位置权限后自动继续原动作', () => {
  let chooseCount = 0;
  const m = makeWx({
    chooseLocation: (options) => { chooseCount++; if (chooseCount === 1) options.fail({ errMsg: 'auth deny' }); },
    openSetting: (options) => {
      m.calls.openSetting++;
      options.success({ authSetting: { 'scope.userLocation': true } });
    }
  });

  pickLocation({ onPick() {} }, { wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });

  assert.equal(chooseCount, 2, '授权成功后必须重新打开选址，而不是让用户自己猜下一步');
});

test('不注入 env → 回退全局 wx(Phase1 教训:生产无注入路径也要覆盖)', () => {
  const m = makeWx();
  global.wx = m.wx;
  try {
    let picked = null;
    pickLocation({ onPick: (p) => { picked = p; } });
    m.succeed({ type: 0, name: '点A', address: '路A', longitude: 1, latitude: 2 });
    assert.deepEqual(picked, { name: '点A', address: '路A', longitude: 1, latitude: 2 });
  } finally {
    delete global.wx;
  }
});

test('当前定位拒权给设置入口，GPS/系统失败给明确重试文案', () => {
  let callback;
  const m = makeWx({ getLocation: options => { callback = options; } });
  getCurrentLocation({}, { wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });
  callback.fail({ errMsg: 'getLocation:fail auth deny' });
  assert.equal(m.calls.modals.length, 1);
  assert.ok(m.calls.toasts.includes('需要位置权限，请在设置中开启'));

  m.calls.toasts.length = 0;
  getCurrentLocation({}, { wx: m.wx, toast: m.toast, modal: m.modal, modal: m.modal });
  callback.fail({ errMsg: 'getLocation:fail system location disabled' });
  assert.deepEqual(m.calls.toasts, ['定位失败，请检查 GPS 后重试']);
});
