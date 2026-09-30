const test = require('node:test');
const assert = require('node:assert/strict');
const pp = require('../../utils/pixel-portrait.js');

/** 造一张 w×h 的假图,paint(x,y) 返回 [r,g,b]。 */
function makeImage(w, h, paint) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      const i = (y * w + x) * 4;
      rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
    }
  }
  return rgba;
}

test('按网格取色用的是整格平均,不是中心点采样', () => {
  // 左半黑右半白,中间一根「杂毛」。中心点采样会被杂毛带偏,平均值不会。
  // 杂毛刻意放在某一格的正中心 —— 只有这样才能区分「整格平均」和「中心点采样」。
  // 放在别处两种算法结果一样,这条断言就成了假绿(实测踩过)。
  const w = 32, h = 32, n = 4, cell = w / n;
  const SPECK_GX = 2, SPECK_GY = 2;
  const cx = Math.floor((SPECK_GX * cell + (SPECK_GX + 1) * cell) / 2);
  const cy = Math.floor((SPECK_GY * cell + (SPECK_GY + 1) * cell) / 2);
  const rgba = makeImage(w, h, (x, y) => {
    if (x === cx && y === cy) return [255, 0, 0];
    return x < 16 ? [0, 0, 0] : [255, 255, 255];
  });
  const grid = pp.sampleGrid(rgba, w, h, n);
  assert.deepEqual(grid[0], [0, 0, 0], '左上角应是纯黑');
  assert.deepEqual(grid[3], [255, 255, 255], '右上角应是纯白');
  const withSpeck = grid[SPECK_GY * n + SPECK_GX];
  assert.ok(withSpeck[0] > 240 && withSpeck[1] > 240,
    `一个像素把整格带偏了:${withSpeck} —— 说明取的是中心点而不是整格平均`);
});

test('量化把相近色并到一起 —— 不并的话铺出来是噪点', () => {
  // 20 个肉眼分不出的近似灰,应该收敛成一两个
  const grid = [];
  for (let i = 0; i < 20; i++) grid.push([100 + i, 100 + i, 100 + i]);
  const q = pp.quantize(grid, 14);
  assert.ok(q.palette.length <= 2, `相近色没并,收敛出了 ${q.palette.length} 个色`);
  assert.equal(q.indexes.length, grid.length);
});

test('量化保留真正不同的颜色', () => {
  const grid = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 128, 255]];
  const q = pp.quantize(grid, 14);
  assert.equal(q.palette.length, 4, '四个差异明显的色不该被并');
  // 每一格都要指到离它最近的那个色
  for (let i = 0; i < grid.length; i++) {
    assert.deepEqual(q.palette[q.indexes[i]], grid[i]);
  }
});

test('调色板有上限,再花的图也压得住', () => {
  const grid = [];
  for (let i = 0; i < 256; i++) grid.push([i, (i * 7) % 256, (i * 13) % 256]);
  const q = pp.quantize(grid, 8);
  assert.ok(q.palette.length <= 8, `超出上限:${q.palette.length}`);
  for (const idx of q.indexes) assert.ok(idx < q.palette.length, '有格子指向不存在的色');
});

test('纯色图不会得到空调色板 —— 空调色板会让绘制整个静默失败', () => {
  const q = pp.quantize([[7, 7, 7], [7, 7, 7], [7, 7, 7]], 14);
  assert.equal(q.palette.length, 1);
  assert.deepEqual(q.palette[0], [7, 7, 7]);
});

test('整条链路:照片进去,网格加调色板出来', () => {
  const rgba = makeImage(64, 64, (x) => (x < 32 ? [20, 30, 40] : [200, 210, 220]));
  const p = pp.buildPortrait(rgba, 64, 64, { grid: 32 });
  assert.equal(p.n, 32);
  assert.equal(p.indexes.length, 32 * 32);
  assert.equal(p.palette.length, 2);
  for (const c of p.palette) assert.match(c, /^#[0-9a-f]{6}$/);
  // 左右两半必须落到不同的色号,否则等于没画
  assert.notEqual(p.indexes[0], p.indexes[31]);
});

test('绘制:每格一笔,整数倍,不越界', () => {
  const calls = [];
  const ctx = { set fillStyle(v) {}, fillRect: (x, y, w, h) => calls.push({ x, y, w, h }) };
  const rgba = makeImage(32, 32, () => [10, 20, 30]);
  const p = pp.buildPortrait(rgba, 32, 32, { grid: 8 });
  const side = pp.drawPortrait(ctx, p, 5, 7, 3.9);   // 非整数倍必须夹掉
  assert.equal(side, 8 * 3);
  assert.equal(calls.length, 64);
  for (const c of calls) {
    assert.equal(c.w, 3, '3.9 倍必须夹成 3 倍,半像素会毁掉像素画');
    assert.equal(c.h, 3);
    assert.ok(c.x >= 5 && c.x + c.w <= 5 + side);
    assert.ok(c.y >= 7 && c.y + c.h <= 7 + side);
  }
});

test('裁剪框:比短边小一圈且偏上 —— 取满短边的话脸只剩十来格', () => {
  const c = pp.squareCrop(1080, 1920);
  assert.ok(c.size < 1080, '取满短边脸会太小,必须收紧');
  assert.ok(c.size > 1080 * 0.4, '收得太狠会把额头下巴切掉');
  assert.ok(c.x > 0, '横向居中');
  assert.ok(c.y < (1920 - c.size) / 2, '纵向应偏上,不是正中');

  // 正方形图也要收紧,而且框必须完全落在图内
  const s = pp.squareCrop(800, 800);
  assert.ok(s.size < 800);
  assert.ok(s.x >= 0 && s.x + s.size <= 800);
  assert.ok(s.y >= 0 && s.y + s.size <= 800);

  // 商家在裁剪页拖过之后,以他给的为准
  const manual = pp.squareCrop(1000, 1000, { zoom: 1, biasTop: 0 });
  assert.deepEqual(manual, { x: 0, y: 0, size: 1000 });

  // 极小图不能算出 0 或负数
  const tiny = pp.squareCrop(4, 4);
  assert.ok(tiny.size >= 1 && tiny.x >= 0 && tiny.y >= 0);
});
