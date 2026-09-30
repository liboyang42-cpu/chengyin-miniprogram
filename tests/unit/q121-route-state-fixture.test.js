'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EVIDENCE_KIND,
  FIXTURES,
  TRANSITIONS,
  validateFixturePlan,
  validateManifest
} = require('../../scripts/verify-q121-route-state-fixture');

function entry(spec, index) {
  return {
    route: spec.route,
    state: spec.state,
    file: `/tmp/q121/${spec.file}`,
    md5: String(index + 1).padStart(32, '0'),
    visibleNodeCount: index + 1,
    evidenceKind: EVIDENCE_KIND,
    pageStack: [spec.pagePath]
  };
}

test('Q121 fixture plan covers six states with a route, a one-page stack, and a rendered visible-node assertion', () => {
  assert.strictEqual(validateFixturePlan(FIXTURES, TRANSITIONS), true);
  assert.deepStrictEqual(FIXTURES.map((fixture) => fixture.state), ['normal', 'form', 'success', 'error', 'empty', 'loading']);
});

test('Q121 plan makes normal to form to success a same-route state transition', () => {
  assert.deepStrictEqual(TRANSITIONS, [
    { from: 'normal', to: 'form', route: '/pages/club/apply/index' },
    { from: 'form', to: 'success', route: '/pages/club/apply/index' }
  ]);
});

test('Q121 nearby fixtures drive the pageState branch that the WXML actually renders', () => {
  const empty = FIXTURES.find((fixture) => fixture.state === 'empty');
  const loading = FIXTURES.find((fixture) => fixture.state === 'loading');
  const writes = [];
  empty.apply({ setData: (data) => writes.push(data) });
  loading.apply({ setData: (data) => writes.push(data) });
  assert.deepStrictEqual(writes, [
    { pageState: 'ready', merchants: [] },
    { pageState: 'loading', merchants: [] }
  ]);
});

test('Q121 manifest accepts six distinct controlled frames with visible-node and page-stack proof', () => {
  assert.strictEqual(validateManifest(FIXTURES.map(entry)), true);
});

test('Q121 manifest negative control rejects an identical-pixel state alias', () => {
  const entries = FIXTURES.map(entry);
  entries[5].md5 = entries[4].md5;
  assert.throws(() => validateManifest(entries), /MD5/);
});

test('Q121 manifest negative control rejects a multi-page stack', () => {
  const entries = FIXTURES.map(entry);
  entries[0].pageStack = ['pages/index/index', entries[0].pageStack[0]];
  assert.throws(() => validateManifest(entries), /pageStack/);
});

test('Q121 manifest negative control rejects zero rendered visible nodes', () => {
  const entries = FIXTURES.map(entry);
  entries[1].visibleNodeCount = 0;
  assert.throws(() => validateManifest(entries), /visibleNodeCount/);
});

test('Q121 driver does not use hidden, template, or outerWxml evidence and only disconnects on cleanup', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/verify-q121-route-state-fixture.js'), 'utf8');
  assert.doesNotMatch(source, /outerWxml|\.close\(\)|App\.exit|pkill/);
  assert.match(source, /await session\.mp\.disconnect\(\)/);
});
