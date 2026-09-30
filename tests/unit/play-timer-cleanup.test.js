'use strict';

const assert = require('assert');
const test = require('node:test');

let pageConfig;
global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest() {}
});
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 })
};
global.Page = (config) => { pageConfig = config; };

function loadPlayPage() {
  delete require.cache[require.resolve('../../pages/play/index.js')];
  require('../../pages/play/index.js');
  return Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) });
}

test('游玩页卸载会清除所有会在销毁后写 UI 的命名 timeout', () => {
  const page = loadPlayPage();
  const cleared = [];
  const originalClearTimeout = global.clearTimeout;
  global.clearTimeout = (id) => { cleared.push(id); };
  try {
    page._navBubbleTimer = 0;
    page._burstTimer = 'burst';
    page._couponTimer = 'coupon';
    page.destroyAudio = () => {};
    page._stopLeadPoll = () => {};
    page._destroySessionClock = () => {};

    page.onUnload();

    assert.deepStrictEqual(cleared.sort(), [0, 'burst', 'coupon'].sort());
    assert.strictEqual(page._navBubbleTimer, null);
    assert.strictEqual(page._burstTimer, null);
    assert.strictEqual(page._couponTimer, null);
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
});

test('游玩页卸载会停掉章节旁白音频与故事流两个 timer(故事流没关就离页时)', () => {
  const page = loadPlayPage();
  const originalClearTimeout = global.clearTimeout;
  global.clearTimeout = () => {};
  try {
    page.destroyAudio = () => {};
    page._stopLeadPoll = () => {};
    page._destroySessionClock = () => {};

    let stopped = false;
    let destroyed = false;
    page._chapAudio = { stop() { stopped = true; }, destroy() { destroyed = true; } };
    page._storyTimer = 'story';
    page._settleTimer = 'settle';

    page.onUnload();

    assert.ok(stopped && destroyed, '章节旁白音频没被停+销毁 —— 离页后旁白会留在后台继续放');
    assert.strictEqual(page._chapAudio, null);
    assert.strictEqual(page._storyTimer, 0);
    assert.strictEqual(page._settleTimer, 0);
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
});
