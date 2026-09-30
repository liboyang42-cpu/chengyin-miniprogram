// 相册全屏:照片一圈跟手转;手滑 / 点两侧停稳后只抛 change,当前第几张由页面管
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function glass(props) {
  let spec;
  const dir = path.dirname(require.resolve('../../pages/play/components/album-glass/index.js'));
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), {
    Component: value => { spec = value; },
    require: (p) => require(path.resolve(dir, p)),
    wx: { getWindowInfo: () => ({ windowWidth: 375 }) },
    setTimeout, clearTimeout, Date, Math,
  });
  const events = [];
  const c = Object.assign({ data: Object.assign({}, spec.data, props) }, spec.methods, {
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push(detail.cur); },
  });
  spec.lifetimes.attached.call(c);
  const drag = (from, to) => {
    c.onTouchStart({ touches: [{ clientX: from }] });
    c.onTouchMove({ touches: [{ clientX: to }] });
    c.onTouchEnd({ changedTouches: [{ clientX: to }] });
  };
  return { c, events, drag, cur: (v) => spec.properties.cur.observer.call(c, v) };
}
const imgs = [{ url: 'a' }, { url: 'b' }, { url: 'c' }, { url: 'd' }];

test('拖动时整圈跟手连续转(位置是小数,不是跳格)', () => {
  const { c } = glass({ images: imgs, cur: 0 });
  c.onTouchStart({ touches: [{ clientX: 300 }] });
  c.onTouchMove({ touches: [{ clientX: 300 - 375 * 0.6 * 0.5 }] });
  assert.equal(c._pos, 0.5);
});

test('往左滑过 40px 翻到下一张,往右滑回上一张;挪得太少回弹不翻', () => {
  const g = glass({ images: imgs, cur: 0 });
  g.drag(200, 150);
  assert.deepEqual(g.events, [1]);
  const back = glass({ images: imgs, cur: 0 });
  back.drag(150, 200);
  assert.deepEqual(back.events, [3], '第一张往前是最后一张');
  const tiny = glass({ images: imgs, cur: 0 });
  tiny.drag(200, 180);
  assert.deepEqual(tiny.events, []);
});

test('轻点右侧下一张、左侧上一张,点中间不动;页面改 cur 只转不回抛', () => {
  const g = glass({ images: imgs, cur: 0 });
  g.c.onTap({ detail: { x: 360 } });
  assert.deepEqual(g.events, [1]);
  const l = glass({ images: imgs, cur: 0 });
  l.c.onTap({ detail: { x: 10 } });
  l.c.onTap({ detail: { x: 187 } });
  assert.deepEqual(l.events, [3]);
  const p = glass({ images: imgs, cur: 0 });
  p.c.data.cur = 2;
  p.cur(2);
  assert.deepEqual(p.events, []);
});

test('卡片软阴影沿透视轮廓一次填充,空轮廓不绘制并恢复画布状态', () => {
  const { c } = glass({ images: imgs, cur: 0 });
  const calls = [];
  const ctx = Object.fromEntries(['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill'].map(name => [name, (...args) => calls.push([name, ...args])]));
  c._paintShadow(ctx, [], 2);
  assert.equal(calls.length, 0);
  c._paintShadow(ctx, [{ dx: 10, dy: 20, dh: 80 }, { dx: 11, dy: 18, dh: 84 }], 2);
  assert.equal(ctx.shadowBlur, 64);
  assert.equal(ctx.shadowOffsetY, 48);
  assert.deepEqual(calls, [['save'], ['beginPath'], ['moveTo', 10, 20], ['lineTo', 10, 20], ['lineTo', 11, 18], ['lineTo', 11, 102], ['lineTo', 10, 100], ['closePath'], ['fill'], ['restore']]);
});
