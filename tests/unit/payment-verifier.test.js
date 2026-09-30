const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentVerifier } = require('../../utils/checkout/payment-verifier.js');

function fakeClock() {
  let now = 0; let nextId = 1; const jobs = [];
  return {
    now: () => now,
    setTimer(fn, ms) {
      const job = { id: nextId++, at: now + Math.max(0, ms), fn, cancelled: false };
      jobs.push(job);
      return job.id;
    },
    clearTimer(id) {
      const job = jobs.find((item) => item.id === id);
      if (job) job.cancelled = true;
    },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = jobs.filter((item) => !item.cancelled && item.at <= target)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        due.cancelled = true;
        now = due.at;
        due.fn();
      }
      now = target;
    },
  };
}

function harness(options) {
  options = options || {};
  const clock = fakeClock();
  const pending = []; let requests = 0; let aborts = 0;
  const verify = createPaymentVerifier({
    requestStatus(ref, requestOptions, cb) {
      requests++;
      pending.push({ ref, requestOptions, cb });
      return { abort() { aborts++; } };
    },
    classify: options.classify || function (res) { return res && res.state || 'pending'; },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    perRequestTimeoutMs: options.perRequestTimeoutMs || 30,
    totalDeadlineMs: options.totalDeadlineMs || 100,
    intervalMs: options.intervalMs || 10,
  });
  return {
    clock, pending, verify,
    requestCount: () => requests,
    abortCount: () => aborts,
  };
}

test('单次状态请求永不回调，也必须在墙钟 deadline 后进入 unknown', () => {
  const h = harness(); const results = [];
  h.verify({ orderSn: 'A' }, (result) => results.push(result));
  assert.equal(h.requestCount(), 1);

  h.clock.advance(101);

  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'unknown');
  assert.match(results[0].errMsg, /订单查看/);
  assert.ok(h.abortCount() >= 1, '每次超时都应 abort 在途请求');
});

test('pending 按间隔重查，服务端 success 后只回调一次', () => {
  const h = harness(); const results = [];
  h.verify({ orderSn: 'B' }, (result) => results.push(result));
  h.pending[0].cb({ state: 'pending' });
  h.clock.advance(10);
  assert.equal(h.requestCount(), 2);
  h.pending[1].cb({ state: 'success', record: 7 });
  h.clock.advance(200);

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].status, 'success');
});

test('服务端明确 failed 立即结束，不伪装 unknown', () => {
  const h = harness(); const results = [];
  h.verify({ orderSn: 'C' }, (result) => results.push(result));
  h.pending[0].cb({ state: 'failed', reason: 'closed' });

  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'failed');
  assert.equal(h.requestCount(), 1);
});

test('destroy 会 abort 请求、清 timer，并屏蔽迟到回调', () => {
  const h = harness(); const results = [];
  const control = h.verify({ orderSn: 'D' }, (result) => results.push(result));
  control.destroy();
  h.pending[0].cb({ state: 'success' });
  h.clock.advance(200);

  assert.equal(h.abortCount(), 1);
  assert.equal(results.length, 0);
  assert.equal(h.requestCount(), 1);
});
