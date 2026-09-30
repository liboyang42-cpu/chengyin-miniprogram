const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createNetworkStatus } = require('../../utils/network-status.js');

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('网络状态:启动读一次、变化时广播、同态不重复、退订后不再收到', () => {
  const wxApi = {};
  let onChange = null;
  wxApi.getNetworkType = (opts) => opts.success({ networkType: 'none' });
  wxApi.onNetworkStatusChange = (fn) => { onChange = fn; };
  const status = createNetworkStatus(wxApi);
  const seen = [];
  const off = status.subscribe((offline) => seen.push(offline));
  assert.deepEqual(seen, [true], '订阅时立即回放当前态');
  onChange({ isConnected: false });
  assert.deepEqual(seen, [true], '同态不重复广播');
  onChange({ isConnected: true });
  assert.deepEqual(seen, [true, false]);
  off();
  onChange({ isConnected: false });
  assert.deepEqual(seen, [true, false], '退订后不再收到');
});

test('app 装一次网络状态;cy-nav-bar 订阅/退订并在标题栏下挂 cy-offline-banner', () => {
  assert.match(read('app.js'), /this\.networkStatus = createNetworkStatus\(wx\)/);
  const js = read('components/cy/nav-bar/index.js');
  assert.match(js, /app\.networkStatus\.subscribe\(\(offline\) => this\.setData\(\{ offline \}\)\)/);
  assert.match(js, /detached\(\) \{\s*if \(this\._offNetwork\) this\._offNetwork\(\);/);
  const wxml = read('components/cy/nav-bar/index.wxml');
  assert.match(wxml, /wx:if="\{\{offline\}\}"[^>]*>\s*<cy-offline-banner \/>/);
  const json = JSON.parse(read('components/cy/nav-bar/index.json'));
  assert.equal(json.usingComponents['cy-offline-banner'], '/components/cy/offline-banner/index');
});
