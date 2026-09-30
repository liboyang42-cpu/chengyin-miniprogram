const test = require('node:test');
const assert = require('node:assert/strict');
const { createWriteActionWorkflow } = require('../../utils/write-action-workflow.js');

test('相同业务键 single-flight，完成后才解锁', () => {
  let done;
  let starts = 0;
  const workflow = createWriteActionWorkflow();
  assert.equal(workflow.run('code:1', cb => { starts += 1; done = cb; }, () => {}), true);
  assert.equal(workflow.run('code:1', () => { starts += 1; }, () => {}), false);
  assert.equal(starts, 1);
  done({ status: 'success' });
  assert.equal(workflow.run('code:1', () => { starts += 1; }, () => {}), true);
  assert.equal(starts, 2);
  workflow.destroy();
});

test('永不回调的写请求到 deadline 进入 unknown 并 abort', () => {
  const timers = [];
  let aborted = 0;
  let result;
  const workflow = createWriteActionWorkflow({
    deadlineMs: 1000,
    setTimer(fn) { const timer = { fn }; timers.push(timer); return timer; },
    clearTimer() {},
  });
  workflow.run('verify:x', () => ({ abort() { aborted += 1; } }), value => { result = value; });
  timers[0].fn();
  assert.equal(aborted, 1);
  assert.equal(result.status, 'unknown');
  assert.equal(workflow.isBusy('verify:x'), true, 'unknown 必须保持锁定，直到权威回读后显式释放');
  assert.equal(workflow.run('verify:x', () => {}, () => {}), false, 'unknown 不得立即重发写操作');
  workflow.reset('verify:x');
  assert.equal(workflow.isBusy('verify:x'), false);
});

test('abort 同步触发 fail 时 deadline 仍保持 unknown', () => {
  const timers = [];
  let done;
  let result;
  const workflow = createWriteActionWorkflow({
    deadlineMs: 1000,
    setTimer(fn) { const timer = { fn }; timers.push(timer); return timer; },
    clearTimer() {},
  });
  workflow.run('verify:sync-abort', cb => {
    done = cb;
    return { abort() { done({ status: 'failed' }); } };
  }, value => { result = value; });

  timers[0].fn();

  assert.equal(result.status, 'unknown');
});

test('destroy abort 所有在途任务并屏蔽迟到回调', () => {
  let late;
  let callbacks = 0;
  let aborted = 0;
  const workflow = createWriteActionWorkflow();
  workflow.run('a', cb => { late = cb; return { abort() { aborted += 1; } }; }, () => { callbacks += 1; });
  workflow.destroy();
  late({ status: 'success' });
  assert.equal(aborted, 1);
  assert.equal(callbacks, 0);
});

test('页面重进可恢复 unknown 业务键锁，未回读前仍不能重新 run', () => {
  const workflow = createWriteActionWorkflow();
  assert.equal(workflow.hold('STATION_PAUSE:8'), true);
  assert.equal(workflow.isBusy('STATION_PAUSE:8'), true);
  assert.equal(workflow.run('STATION_PAUSE:8', () => {}, () => {}), false);
  workflow.reset('STATION_PAUSE:8');
  assert.equal(workflow.isBusy('STATION_PAUSE:8'), false);
  workflow.destroy();
});
