const test = require('node:test');
const assert = require('node:assert');
const { collageLayout } = require('../../subpackageP3/pages/stamp-album/index/layout.js');

const OPTS = { cols: 4, cellW: 90, cellH: 110, jitter: 16, maxRot: 12 };

test('确定性:同输入同输出(否则每次进页面邮票乱跳)', () => {
  assert.deepEqual(collageLayout(20, OPTS), collageLayout(20, OPTS));
});

test('数量与输入一致', () => {
  assert.equal(collageLayout(37, OPTS).length, 37);
});

test('旋转在 ±maxRot 内(超了会跟邻居叠成一团)', () => {
  for (const it of collageLayout(50, OPTS)) {
    assert.ok(Math.abs(it.rot) <= OPTS.maxRot, `rot ${it.rot} 越界`);
  }
});

test('抖动在 ±jitter/2 内,且不是网格(至少一半有偏移)', () => {
  const items = collageLayout(40, OPTS);
  let offset = 0;
  items.forEach((it, i) => {
    const baseX = (i % OPTS.cols) * OPTS.cellW;
    const dx = it.x - baseX;
    assert.ok(Math.abs(dx) <= OPTS.jitter / 2 + 1e-9, `dx ${dx} 越界`);
    if (Math.abs(dx) > 1) offset++;
  });
  assert.ok(offset > items.length / 2, '几乎没抖动就退化成网格了');
});

test('z 递增,后拍的压在上面', () => {
  const items = collageLayout(5, OPTS);
  for (let i = 1; i < items.length; i++) assert.ok(items[i].z > items[i - 1].z);
});

// 以下为补强护栏(评审:原 5 条只查 x 轴,y 恒零抖动 + rot 恒 0 + x 只加常数的假网格能骗过全部原测试)。

test('y 轴抖动在 ±jitter/2 内,且不是网格(至少一半有偏移)——原测试只查过 x,y 恒零也能过', () => {
  const items = collageLayout(40, OPTS);
  let offset = 0;
  items.forEach((it, i) => {
    const baseY = Math.floor(i / OPTS.cols) * OPTS.cellH;
    const dy = it.y - baseY;
    assert.ok(Math.abs(dy) <= OPTS.jitter / 2 + 1e-9, `dy ${dy} 越界`);
    if (Math.abs(dy) > 1) offset++;
  });
  assert.ok(offset > items.length / 2, 'y 几乎没抖动就退化成网格了');
});

test('抖动要有方差,不能是所有元素加同一个常数偏移(常数偏移也能让 |dx|/|dy|>1 过半,但那不是散落)', () => {
  const items = collageLayout(40, OPTS);
  const dxSet = new Set();
  const dySet = new Set();
  items.forEach((it, i) => {
    const baseX = (i % OPTS.cols) * OPTS.cellW;
    const baseY = Math.floor(i / OPTS.cols) * OPTS.cellH;
    dxSet.add((it.x - baseX).toFixed(2));
    dySet.add((it.y - baseY).toFixed(2));
  });
  assert.ok(dxSet.size > items.length / 4, `dx 取值只有 ${dxSet.size} 种,像是常数偏移而非散落`);
  assert.ok(dySet.size > items.length / 4, `dy 取值只有 ${dySet.size} 种,像是常数偏移而非散落`);
});

test('rot 不能恒为 0,且取值要有多样性', () => {
  const items = collageLayout(40, OPTS);
  const rotSet = new Set();
  let nonZero = false;
  items.forEach((it) => {
    if (Math.abs(it.rot) > 0.5) nonZero = true;
    rotSet.add(it.rot.toFixed(1));
  });
  assert.ok(nonZero, 'rot 全部趋近 0,没有真旋转');
  assert.ok(rotSet.size > items.length / 4, `rot 取值只有 ${rotSet.size} 种,没有多样性`);
});
