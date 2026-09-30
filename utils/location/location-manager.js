// Phase 4 位置选址封装(用途:发布/资料填写时由用户主动选择地点)。
//
// 抽取 7 个选址调用点共享的不变量:坐标校验 / 取消静默 / 拒绝授权引导+提示 /
// 其它失败提示 / 成功归一化 {name,address,longitude,latitude}。各页只保留自己的字段映射与成功 toast。
// 依赖注入 wx(便于单测);不注入则回退全局 wx(生产路径)。不主动 getLocation 替代用户选择。
//
// 2026-08-20 底层由 wx.choosePoi 换 wx.chooseLocation:choosePoi 只在 type===2 才给坐标,
// 真机上大量 POI 选中后无坐标,被坐标闸拦成「未获取到该地点坐标」死循环;
// chooseLocation(地图选点,可搜索/拖点)恒带坐标,且天然选不出「仅城市」,原城市闸一并移除。

const cyToast = require('../toast.js');
const cyModal = require('../modal.js');
// toast 与 wx 一样可注入(单测断言提示文案);不注入走全站出口 utils/toast.js
function resolveToast(env) {
  if (env && typeof env.toast === 'function') return env.toast;
  return cyToast;
}
// 确认弹窗同样可注入;不注入走全站出口 utils/modal.js(与 wx.showModal 同形)
function resolveModal(env) {
  if (env && typeof env.modal === 'function') return env.modal;
  return cyModal.show;
}
function resolveWx(env) {
  if (env && env.wx) return env.wx;
  return (typeof wx !== 'undefined') ? wx : null;
}

// 坐标兜底闸:chooseLocation 正常必带坐标,这里防的是异常返回(空/0/越界)。
// 5 个调用点全都消费坐标,判据统一收在这里:没可用坐标就不算选到地点。
function hasCoords(poi) {
  if (!poi) return false;
  var lng = Number(poi.longitude);
  var lat = Number(poi.latitude);
  return isFinite(lng) && isFinite(lat) && lng !== 0 && lat !== 0
    && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function normalizePoi(poi) {
  poi = poi || {};
  return { name: poi.name, address: poi.address, longitude: poi.longitude, latitude: poi.latitude };
}

// 位置权限被拒时的“去设置”引导(原各页重复的 showLocationPermissionGuide)。
function showPermissionGuide(env, onGranted) {
  var _wx = resolveWx(env);
  var _modal = resolveModal(env);
  var _toast = resolveToast(env);
  if (!_wx) return;
  _modal({
    title: '需要位置权限',
    content: '请在小程序设置中开启位置权限，以便继续使用位置功能',
    confirmText: '去设置',
    success: function (res) {
      if (!res || !res.confirm) return;
      _wx.openSetting({
        success: function (settings) {
          var granted = settings && settings.authSetting && settings.authSetting['scope.userLocation'];
          if (granted && typeof onGranted === 'function') onGranted();
        }
      });
    },
  });
}

// 选址:封装 wx.chooseLocation。options:
//  - onPick(poi, raw):选到具体地点时回调,poi 已归一化(页面在此 setData / 可选成功 toast)。
//  - guideOnDeny:拒绝授权时是否弹“去设置”引导(默认 true;merchantapply1 传 false)。
function pickLocation(options, env) {
  options = options || {};
  var _wx = resolveWx(env);
  var _toast = resolveToast(env);
  if (!_wx) return;
  var onPick = options.onPick;
  var guideOnDeny = options.guideOnDeny !== false;

  _wx.chooseLocation({
    success: function (res) {
      if (!hasCoords(res)) {
        _toast('没找到该地点坐标，请换个词重选', { duration: 2000 });
        if (typeof options.onFail === 'function') {
          options.onFail({ code: 'POI_COORDS_MISSING', errMsg: 'chooseLocation:fail no coords' });
        }
        return;
      }
      if (typeof onPick === 'function') onPick(normalizePoi(res), res);
    },
    fail: function (err) {
      var msg = (err && err.errMsg) || '';
      if (msg.indexOf('cancel') >= 0) {
        if (typeof options.onCancel === 'function') options.onCancel(err);
        return; // 用户取消:静默
      }
      if (msg.indexOf('auth deny') >= 0 || msg.indexOf('permission') >= 0) {
        if (guideOnDeny) showPermissionGuide(env, function () { pickLocation(options, env); });
        _toast('需要位置权限，请在设置中开启');
        if (typeof options.onFail === 'function') options.onFail(err);
        return;
      }
      _toast('选择地点失败');
      if (typeof options.onFail === 'function') options.onFail(err);
    },
  });
}

// 当前定位：用于“重新定位/回到我附近”等用户主动动作。拒权、系统失败必须有可恢复反馈。
function getCurrentLocation(options, env) {
  options = options || {};
  var _wx = resolveWx(env);
  var _toast = resolveToast(env);
  if (!_wx || typeof _wx.getLocation !== 'function') {
    if (_wx) _toast('当前设备暂不支持定位');
    return null;
  }
  return _wx.getLocation({
    type: options.type || 'gcj02',
    isHighAccuracy: options.isHighAccuracy !== false,
    success: function (res) {
      if (!hasCoords(res)) {
        _toast('未获取到有效位置，请重试');
        if (typeof options.onFail === 'function') options.onFail(res);
        return;
      }
      if (typeof options.onSuccess === 'function') options.onSuccess(res);
    },
    fail: function (err) {
      var msg = err && err.errMsg || '';
      if (/auth deny|permission/i.test(msg)) {
        showPermissionGuide(env, function () { getCurrentLocation(options, env); });
        _toast('需要位置权限，请在设置中开启');
      } else {
        _toast('定位失败，请检查 GPS 后重试');
      }
      if (typeof options.onFail === 'function') options.onFail(err);
    }
  });
}

module.exports = {
  pickLocation: pickLocation,
  showPermissionGuide: showPermissionGuide,
  hasCoords: hasCoords,
  normalizePoi: normalizePoi,
  getCurrentLocation: getCurrentLocation,
};
