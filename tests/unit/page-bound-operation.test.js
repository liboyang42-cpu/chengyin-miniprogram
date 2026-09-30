const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPageBoundOperation } = require('../../utils/page-bound-operation.js');

function harness() {
  const owner = {};
  const timers = [];
  let pages = [owner];
  const operation = createPageBoundOperation({
    owner,
    getPages: () => pages,
    setInterval(fn) { const timer = { fn, cleared: false }; timers.push(timer); return timer; },
    clearInterval(timer) { timer.cleared = true; },
  });
  return { owner, timers, operation, leave() { pages = []; } };
}

test('原页面离开页面栈后立即 abort 已绑定任务', () => {
  const h = harness();
  let aborted = 0;
  h.operation.attach({ abort() { aborted += 1; } });
  h.leave();
  h.timers[0].fn();
  assert.equal(aborted, 1);
  assert.equal(h.operation.isAborted(), true);
  assert.equal(h.timers[0].cleared, true);
});

test('页面已离开后才到的任务也必须立即 abort', () => {
  const h = harness();
  let aborted = 0;
  h.leave();
  h.timers[0].fn();
  h.operation.attach({ abort() { aborted += 1; } });
  assert.equal(aborted, 1);
});

test('页面已离开但轮询未 tick 时 attach 也必须同步 abort 新任务', () => {
  const h = harness();
  let aborted = 0;
  h.leave();
  h.operation.attach({ abort() { aborted += 1; } });
  assert.equal(aborted, 1);
  assert.equal(h.operation.isAborted(), true);
});

test('页面移除后即使轮询尚未触发，回调查询状态也必须同步 abort', () => {
  const h = harness();
  let aborted = 0;
  h.operation.attach({ abort() { aborted += 1; } });
  h.leave();

  assert.equal(h.operation.isAborted(), true);
  assert.equal(aborted, 1);
});

test('正常完成后停止监视，不再 abort 已结束任务', () => {
  const h = harness();
  let aborted = 0;
  h.operation.attach({ abort() { aborted += 1; } });
  h.operation.finish();
  h.leave();
  h.timers[0].fn();
  assert.equal(aborted, 0);
  assert.equal(h.timers[0].cleared, true);
});

test('abort 会通知 Promise 消费者一次，正常 finish 不通知', () => {
  const left = harness();
  let abortNotifications = 0;
  left.operation.onAbort(() => { abortNotifications += 1; });
  left.operation.abort();
  left.operation.abort();
  assert.equal(abortNotifications, 1);

  const completed = harness();
  completed.operation.onAbort(() => { abortNotifications += 1; });
  completed.operation.finish();
  assert.equal(abortNotifications, 1);
});

// 2026-09-06 原生 toast 全删:上传中的「提交中/上传中」提示改走 utils/loading.js,离页 abort 关的是 cyLoading
test('全局选图/选文件与两个直接上传页都接入离页 abort', () => {
  const root = path.resolve(__dirname, '../..');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const stamp = fs.readFileSync(path.join(root, 'subpackageP3/pages/stamp-camera/index/index.js'), 'utf8');
  const roam = fs.readFileSync(path.join(root, 'pages/roam/index.js'), 'utf8');
  assert.match(app, /createPageBoundOperation:\s*function/);
  assert.match(app, /operation\.attach\(that\.getUploadClient\(\)\.uploadAll/);
  assert.match(app, /wx\.chooseMedia\(\{[\s\S]*?success:\s*function \(res\) \{\s*if \(operation\.isAborted\(\)\) return;/,
    '选图系统回调到达时必须先同步确认页面仍在栈内，再开始裁剪');
  assert.match(app, /wx\.chooseMessageFile\(\{[\s\S]*?success:\s*function \(res\) \{\s*if \(operation\.isAborted\(\)\) return;/,
    '选文件系统回调到达时必须先同步确认页面仍在栈内，再开始上传');
  assert.match(app, /wx\.chooseMedia\(\{[\s\S]*?fail:\s*function \(res\) \{\s*if \(operation\.isAborted\(\)\) return;/,
    '选图失败回调迟到时不得在新页面弹窗');
  assert.match(app, /wx\.chooseMessageFile\(\{[\s\S]*?fail:\s*function \(res\) \{\s*if \(operation\.isAborted\(\)\) return;/,
    '选文件失败回调迟到时不得在新页面弹窗');
  assert.equal((app.match(/operation\.onAbort\(function \(\) \{ cyLoading\.hide\(\); \}\)/g) || []).length, 2,
    '选图与选文件上传离页后都必须立即清理全局 toast');
  assert.match(stamp, /this\._uploadOperation\.abort\(\)/);
  assert.match(stamp, /uploadOperation\.attach\(app\.getUploadClient\(\)\.uploadAll/);
  assert.match(roam, /this\._shareUploadOperation\.abort\(\)/);
  assert.match(roam, /operation\.attach\(app\.getUploadClient\(\)\.uploadAll/);
  assert.match(roam, /operation\.onAbort\(\(\) => reject\(/);
  // 0a74099f4 起离页判定并入同一分支、结果收进 cancelled() 工厂:两处都锁,缺一即红
  assert.match(roam, /const cancelled = \(\) => \(\{ ok: false,[^\n]*cancelled: true \}\)/);
  assert.match(roam, /if \(!current\(\) \|\| \(err && err\.cancelled\)\) return cancelled\(\);/);
});
