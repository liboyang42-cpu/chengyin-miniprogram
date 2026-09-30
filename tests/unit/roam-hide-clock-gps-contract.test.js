const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.js'), 'utf8');

function onHideBody() {
  const start = source.indexOf('  onHide() {');
  assert.notEqual(start, -1, 'pages/roam/index.js 必须有 onHide');
  const end = source.indexOf('\n  onShow() {', start);
  assert.notEqual(end, -1, 'onHide 之后应紧跟 onShow');
  return source.slice(start, end);
}

test('X10 实时定位开着时 onHide 不得暂停会话时钟', () => {
  const body = onHideBody();
  assert.match(
    body,
    /if\s*\(\s*!this\._realOn\s*&&\s*this\._sessionClock/,
    'onHide 无条件 pause 会在锁屏时吞掉真实走过的时间:GPS 由 bgTracker 继续采集，'
      + '时钟却停了，而 onShow 不会自动恢复(恢复只有 togglePause 一条路)'
  );
});

test('X10 GPS 未开启时 onHide 仍要暂停时钟(不能把闸修成永不暂停)', () => {
  const body = onHideBody();
  assert.match(body, /this\._sessionClock\.pause\(\);/, '暂停分支必须还在');
  assert.match(body, /paused:\s*true/, '暂停后必须同步 HUD 的 paused 状态');
});

test('X10 释放定位的时机仍然只有 _stopReal —— onHide 不得顺手 release', () => {
  const body = onHideBody();
  assert.doesNotMatch(
    body,
    /bgTracker\.release/,
    'roam 与 play 共享 bgTracker 的引用计数所有权，切 tab 就 release 会把 play 的定位一起掐掉'
  );
});
