const test = require('node:test');
const assert = require('node:assert/strict');
const { createD20Renderer, faces, orientFace, rotate } = require('../../pages/play/utils/d20-renderer.js');

test('D20 是闭合的二十面体，每个权威点数都能朝向玩家且相对面之和为 21', () => {
  assert.equal(faces.length, 20);
  const edges = new Map();
  const vertices = new Set();
  for (const face of faces) {
    face.points.forEach((p, i) => {
      vertices.add(p.join(','));
      const edge = [p.join(','), face.points[(i + 1) % 3].join(',')].sort().join('|');
      edges.set(edge, (edges.get(edge) || 0) + 1);
    });
    const q = orientFace(face.value);
    const normal = rotate(q, face.normal);
    assert.ok(Math.abs(normal[0]) < 1e-10 && Math.abs(normal[1]) < 1e-10 && normal[2] > .999);
    const top = rotate(q, face.up);
    assert.ok(top[1] > .999, '正面的数字必须朝上');
    const opposite = faces.find((f) => f.normal.every((n, i) => Math.abs(n + face.normal[i]) < 1e-10));
    assert.equal(face.value + opposite.value, 21);
  }
  assert.equal(vertices.size, 12);
  assert.equal(edges.size, 30);
  assert.ok([...edges.values()].every((count) => count === 2));
  assert.deepEqual(faces.map((f) => f.value).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
});

test('双骰落面后未选中者渐隐，权威骰移至中央放大，减少动态和销毁均停止动画', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  function surface() {
    let calls = [];
    let id = 0;
    const frames = new Map();
    const ctx = { clearRect() { calls = []; }, createRadialGradient() { return { addColorStop() {} }; } };
    for (const method of ['setTransform', 'save', 'restore', 'translate', 'scale', 'fillRect', 'beginPath',
      'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'clip', 'transform', 'fillText']) {
      ctx[method] = (...args) => calls.push([method].concat(args));
    }
    Object.defineProperty(ctx, 'globalAlpha', { set(value) { calls.push(['alpha', value]); } });
    return {
      getContext() { return ctx; },
      requestAnimationFrame(fn) { frames.set(++id, fn); return id; },
      cancelAnimationFrame(key) { frames.delete(key); },
      step() { const [key, fn] = frames.entries().next().value; frames.delete(key); fn(); },
      get calls() { return calls; }, get pending() { return frames.size; },
    };
  }
  const canvas = surface();
  let done = 0;
  let error = null;
  const dice = createD20Renderer(canvas, 320, 220, 2, 2, () => done++, (e) => { error = e; });
  const before = canvas.calls;
  dice.roll(false);
  t.mock.timers.tick(250); canvas.step();
  assert.notDeepEqual(canvas.calls, before, '旋转必须改变投影面的坐标');
  dice.settle([1, 20], 20, false);
  t.mock.timers.tick(1200); canvas.step();
  assert.equal(done, 0, '双骰落面后应先展示选择动画，再完成');
  t.mock.timers.tick(500); canvas.step();
  assert.ok(canvas.calls.some((c) => c[0] === 'alpha' && c[1] > 0 && c[1] < 1), '另一颗逐渐淡出');
  const centers = canvas.calls.filter((c) => c[0] === 'translate').map((c) => c[1]);
  assert.ok(centers.some((x) => x > 160 && x < 240), '选中的骰子在移向中间');
  t.mock.timers.tick(500); canvas.step();
  assert.equal(done, 1);
  assert.equal(canvas.pending, 0);
  assert.deepEqual(canvas.calls.filter((c) => c[0] === 'translate').map((c) => c[1]), [160]);
  assert.ok(canvas.calls.find((c) => c[0] === 'scale')[1] > 320 / 2 * .33, '中央骰子放大');
  const expected = surface();
  createD20Renderer(expected, 320, 220, 2, 2, () => {}).settle([1, 20], 20, true);
  assert.deepEqual(canvas.calls, expected.calls, '动画终态与恢复页面一致，保留权威选中的骰子');
  assert.ok(!canvas.calls.some((c) => c[0] === 'fillText' && c[1] === '取用'));
  assert.ok(canvas.calls.some((c) => c[0] === 'fillText' && c[1] === '20'));
  dice.roll(true);
  assert.equal(canvas.pending, 0);
  dice.settle([20, 1], 1, true);
  assert.equal(done, 2);
  assert.deepEqual(canvas.calls.filter((c) => c[0] === 'translate').map((c) => c[1]), [160]);
  assert.ok(canvas.calls.some((c) => c[0] === 'fillText' && c[1] === '1'), '劣势仍按权威取小，不改成取大');
  assert.throws(() => dice.settle([21, 1], 1, true), /1–20/);
  dice.roll(false);
  canvas.getContext().fill = () => { throw new Error('canvas unavailable'); };
  canvas.step();
  assert.match(error.message, /canvas unavailable/);
  assert.equal(canvas.pending, 0, '动画帧异常必须停止并回调可见错误处理');
  dice.dispose();
  assert.equal(canvas.pending, 0);
});

test('画布错误不拦截检定请求；慢回包进入落面动画时取消请求超时', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'], now: 1000 });
  const fs = require('node:fs');
  const vm = require('node:vm');
  let definition;
  vm.runInNewContext(fs.readFileSync(require.resolve('../../pages/play/components/playkit-diceroll/index.js'), 'utf8'), {
    Component(config) { definition = config; }, require() { return {}; }, setTimeout, clearTimeout,
  });
  function instance(renderer) {
    return Object.assign({ data: { mode: 'd20', d20Rolling: false, result: null }, _d20: renderer,
      setData(patch) { Object.assign(this.data, patch); }, sent: 0, triggerEvent() { this.sent++; },
    }, definition.methods);
  }
  const broken = instance({ roll() { throw new Error('canvas lost'); }, dispose() {} });
  broken.onRoll();
  assert.equal(broken.sent, 1);
  assert.equal(broken.data.d20Rolling, false);
  assert.equal(broken.data.d20Error, true);
  const activeRenderer = { dispose() { throw new Error('结果回填不应销毁画布'); } };
  const active = instance(activeRenderer);
  Object.assign(active.data, { show: true, rollMode: 'advantage', d20Rolling: true });
  active._d20Mounted = true;
  active._d20Key = 'true:d20:advantage';
  definition.observers['show, mode, rollMode'].call(active);
  assert.equal(active._d20, activeRenderer);
  assert.equal(active.data.d20Rolling, true, '相同属性的重复通知不能打断动画');
  const slow = instance({ roll() {}, settle() {}, dispose() {} });
  slow.onRoll();
  slow.onRoll();
  assert.equal(slow.sent, 1, '转动中不能重复发请求');
  t.mock.timers.tick(7500);
  definition.observers.result.call(slow, { values: [20], kept: 20 });
  t.mock.timers.tick(600);
  assert.equal(slow.data.d20Rolling, true, '旧的请求超时不能提前解除落面动画');
  slow._destroyD20();
});
