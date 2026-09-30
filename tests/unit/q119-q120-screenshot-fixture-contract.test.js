'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EVIDENCE_KIND,
  FIXTURES,
  assertPreCaptureSessionQuiescent,
  resetAndReadViewportScrollTop,
  restoreSessionIsolation,
  validateFixturePlan,
  validateManifest,
  validateSessionSnapshot
} = require('../../scripts/verify-q119-q120-screenshot-fixture');

function entry(fixture, index) {
  return {
    route: fixture.route,
    state: fixture.state,
    file: `/tmp/fixture/${fixture.file}`,
    md5: String(index + 1).padStart(32, '0'),
    visibleNodeCount: index + 1,
    pageStack: [fixture.pagePath],
    scrollTop: 0,
    stableWaitMs: 450,
    overlays: [],
    evidenceKind: EVIDENCE_KIND
  };
}

test('Q119/Q120 plan covers normal/error/empty/loading with a first-screen exclusive node and stable composition metadata', () => {
  assert.equal(validateFixturePlan(FIXTURES), true);
  assert.deepEqual(FIXTURES.map((fixture) => fixture.state), ['normal', 'error', 'empty', 'loading']);
  const exclusiveAssertions = new Set();
  for (const fixture of FIXTURES) {
    assert.ok(fixture.visible.selector);
    assert.ok(fixture.exclusive.selector);
    const key = `${fixture.exclusive.selector}:${fixture.exclusive.dataPath || ''}:${fixture.exclusive.expected || ''}`;
    assert.ok(!exclusiveAssertions.has(key));
    exclusiveAssertions.add(key);
  }
});

test('Q119/Q120 manifest accepts isolated, top-of-page, settled and overlay-free frames', () => {
  assert.equal(validateManifest(FIXTURES.map(entry)), true);
});

test('Q119/Q120 negative control rejects a non-top scroll position', () => {
  const entries = FIXTURES.map(entry);
  entries[1].scrollTop = 120;
  assert.throws(() => validateManifest(entries), /scrollTop/);
});

test('Q119/Q120 negative control rejects a stale overlay and duplicate pixels', () => {
  const entries = FIXTURES.map(entry);
  entries[2].overlays = ['.wx-toast'];
  assert.throws(() => validateManifest(entries), /overlay/);
  entries[2].overlays = [];
  entries[3].md5 = entries[2].md5;
  assert.throws(() => validateManifest(entries), /MD5/);
});

test('Q119/Q120 negative control rejects a route that aliases another state', () => {
  const entries = FIXTURES.map(entry);
  entries[1].route = entries[0].route;
  entries[1].pageStack = [entries[0].route.slice(1)];
  assert.throws(() => validateManifest(entries), /route\/state\/file/);
});

test('Q119/Q120 plan rejects duplicate state-exclusive assertions', () => {
  const invalid = FIXTURES.map((fixture) => ({ ...fixture, exclusive: { ...fixture.exclusive } }));
  invalid[3].exclusive = { ...invalid[2].exclusive };
  assert.throws(() => validateFixturePlan(invalid), /专属断言重复/);
});

test('Q120 reads back viewport scrollTop after resetting it to zero', async () => {
  const calls = [];
  const scrollTop = await resetAndReadViewportScrollTop({
    pageScrollTo: async (options) => calls.push(options),
    evaluate: async () => 0
  });
  assert.deepEqual(calls, [{ scrollTop: 0, duration: 0 }]);
  assert.equal(scrollTop, 0);
});

test('Q119 session evidence exposes booleans only and rejects a post-isolation session change', () => {
  const anonymous = { hasAuthorization: false, hasUserId: false, hasRole: false, hasUserInfo: false };
  assert.deepEqual(validateSessionSnapshot({ ...anonymous, interceptedRequests: 0 }, { ...anonymous, interceptedRequests: 1 }), true);
  assert.throws(() => validateSessionSnapshot(anonymous, { ...anonymous, hasRole: true }), /session/);
  assert.throws(() => validateSessionSnapshot({ ...anonymous, authorization: 'secret' }, anonymous), /session/);
});

test('Q119 capture refuses to begin when a pre-isolation callback changes the session during the quiet window', async () => {
  const before = { hasAuthorization: false, hasUserId: false, hasRole: false, hasUserInfo: false, interceptedRequests: 0 };
  const stableMp = { evaluate: async () => ({ ...before }) };
  assert.equal(await assertPreCaptureSessionQuiescent(stableMp, before, async () => {}), true);

  const changedMp = { evaluate: async () => ({ ...before, hasRole: true }) };
  await assert.rejects(() => assertPreCaptureSessionQuiescent(changedMp, before, async () => {}), /session/);
});

test('Q119 cleanup restores its request interception before disconnecting', async () => {
  let source = '';
  await restoreSessionIsolation({ evaluate: async (callback) => { source = String(callback); } });
  assert.match(source, /wx\.request = marker\.originalRequest/);
  assert.match(source, /wx\.getLocation = marker\.originalGetLocation/);
  assert.match(source, /delete globalThis\.__q119Fixture/);
});
