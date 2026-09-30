const { test } = require('node:test');
const assert = require('node:assert/strict');

test('不注册占位探索页', () => {
  const appConfig = require('../../app.json');

  assert.equal(appConfig.pages.includes('pages/explore/index'), false);
});

// 2026-08-19 产品决策变更(用户拍板):启用后台定位。
// 原来这条断言写死「不得声明后台定位」,那是「我们不做后台采集」这个决策的留痕。
// 变更理由:在架路线是 2–4.5 小时、7.8–10.5 公里的步行/骑行(cms_topic 真实数据),
// 玩家必然锁屏塞兜,前台定位一断就丢轨迹段、走到点位也判不出到达。
// 微信侧 wx.startLocationUpdateBackground 权限已开通。
// ⚠️ 断言方向反过来了,但**守的东西没有变少**:仍然钉死必须声明 requiredBackgroundModes,
//    否则声明了私有接口却跑不起来 —— 那是「权限拿了、功能是空的」的静默失效。
//    真正的合规防线在 utils/location/bg-tracker.js 的引用计数 + 其单测负控。
test('启用微信隐私检查,并按后台定位形态完整声明', () => {
  const appConfig = require('../../app.json');

  assert.equal(appConfig.__usePrivacyCheck__, true);
  assert.deepEqual(appConfig.requiredBackgroundModes, ['location'],
    '声明了后台定位私有接口就必须同时声明 requiredBackgroundModes,否则接口调不起来');
  assert.equal(appConfig.requiredPrivateInfos.includes('startLocationUpdateBackground'), true);
  assert.equal(appConfig.requiredPrivateInfos.includes('getLocation'), true);
  assert.equal(appConfig.requiredPrivateInfos.includes('startLocationUpdate'), true);
  assert.equal(appConfig.requiredPrivateInfos.includes('onLocationChange'), true);
  assert.equal(appConfig.pages.includes('pages/privacy/index'), true);
  assert.equal(appConfig.pages.includes('pages/deregister/index'), true);
});
