// 把商家上传的照片处理成像素头像 —— 就是那批风格里「pixel」那一档:
// 先按网格取色,再把颜色收敛到有限调色板,最后一格一格铺方块。
//
// 为什么要量化:照片每一格的颜色都差着一两个数值,不收敛的话铺出来是一片噪点,
// 看着像糊掉的照片而不是像素画。有限色板才是这个画风成立的原因。
//
// 这里只做纯计算:进来是像素数组,出去是网格 + 调色板。取像素(getImageData)、
// 画回去(fillRect)、导出图片都在页面里 —— 拆开是为了能测,断言得动网格,
// 断言不动 canvas。

'use strict';

/** 网格边长。与预设形象保持一致,合成时两边才对得齐。 */
const GRID = 32;

/** 调色板上限。再多就压不住照片噪点,再少人脸会糊成色块。 */
const MAX_COLORS = 14;

/** 两色相距多少以内算同一色。取自实测:小于这个值人眼分不出,大于则会丢掉五官暗部。 */
const MERGE_DISTANCE = 26;

function dist(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 按网格取色:每格取该格内所有像素的平均值。
 *
 * 用平均而不是中心点采样 —— 中心点采样会让一根头发丝决定整格的颜色,
 * 出来的图会有随机的噪点;平均值至少是那一格真实的样子。
 *
 * @param rgba   Uint8ClampedArray,来自 canvas 的 getImageData().data
 * @param width/height  源图尺寸
 * @param n      网格边长
 * @returns n*n 个 [r,g,b],行优先
 */
function sampleGrid(rgba, width, height, n) {
  const grid = new Array(n * n);
  for (let gy = 0; gy < n; gy++) {
    const y0 = Math.floor(gy * height / n), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * height / n));
    for (let gx = 0; gx < n; gx++) {
      const x0 = Math.floor(gx * width / n), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * width / n));
      let r = 0, g = 0, b = 0, count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2];
          count++;
        }
      }
      grid[gy * n + gx] = count
        ? [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
        : [0, 0, 0];
    }
  }
  return grid;
}

/**
 * 收敛到有限调色板。
 *
 * 按出现频次挑种子:出现得多的颜色先占位,离已有种子太近的直接并进去。
 * 这样保下来的是「画面里真的有的颜色」,而不是数学上均匀分布的颜色 ——
 * 后者会把大片肤色切成好几档,反而更花。
 *
 * @returns { palette: [[r,g,b]...], indexes: Uint8Array }
 */
function quantize(grid, maxColors) {
  const limit = Math.max(2, Number(maxColors) || MAX_COLORS);
  const freq = new Map();
  for (const c of grid) {
    const key = c[0] + ',' + c[1] + ',' + c[2];
    const hit = freq.get(key);
    if (hit) hit.n++;
    else freq.set(key, { c: c, n: 1 });
  }
  const ordered = Array.from(freq.values()).sort((a, b) => b.n - a.n);

  const palette = [];
  for (const item of ordered) {
    if (palette.length >= limit) break;
    let tooClose = false;
    for (const p of palette) {
      if (dist(item.c, p) <= MERGE_DISTANCE) { tooClose = true; break; }
    }
    if (!tooClose) palette.push(item.c);
  }
  // 极端情况:整张图就一个色(纯色背景、全黑),也要保证调色板非空
  if (!palette.length) palette.push(ordered.length ? ordered[0].c : [0, 0, 0]);

  const indexes = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    let best = 0, bestD = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const d = dist(grid[i], palette[p]);
      if (d < bestD) { bestD = d; best = p; }
    }
    indexes[i] = best;
  }
  return { palette: palette, indexes: indexes };
}

/** [r,g,b] → '#RRGGBB'。canvas 的 fillStyle 认这个。 */
function toHex(c) {
  const h = (v) => {
    const s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
    return s.length < 2 ? '0' + s : s;
  };
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}

/**
 * 一步到位:照片像素 → 可直接绘制的网格。
 *
 * @returns { n, palette: ['#RRGGBB'...], indexes: Uint8Array }
 */
function buildPortrait(rgba, width, height, opts) {
  const o = opts || {};
  const n = Math.max(8, Math.floor(Number(o.grid) || GRID));
  const grid = sampleGrid(rgba, width, height, n);
  const q = quantize(grid, o.maxColors || MAX_COLORS);
  return { n: n, palette: q.palette.map(toHex), indexes: q.indexes };
}

/**
 * 把处理好的网格画进 canvas。
 *
 * scale 必须是整数 —— 非整数倍产生半像素,像素画一糊就没了全部价值。
 * 与 pixel-avatar 的 fitScale 同一条规矩。
 */
function drawPortrait(ctx, portrait, originX, originY, scale) {
  const s = Math.max(1, Math.floor(Number(scale) || 1));
  const n = portrait.n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = portrait.palette[portrait.indexes[y * n + x]];
      ctx.fillRect(originX + x * s, originY + y * s, s, s);
    }
  }
  return n * s;
}

/**
 * 猜一个脸所在的正方形区域,作为裁剪框的初始值。
 *
 * 两个默认值都是拿真实半身照试出来的:
 *   zoom 取短边的一半多一点 —— 取满短边的话,32 格里脸只占十来格,认不出人;
 *   纵向偏上 —— 半身照的脸在上部,取正中会把胸口当主体。
 *
 * 这只是初始框。商家能在裁剪页里自己拖,拖过就以他拖的为准 ——
 * 没有人脸检测的情况下,让人自己框比任何启发式都准。
 *
 * @returns { x, y, size } 供 drawImage 的源矩形使用
 */
function squareCrop(width, height, opts) {
  const o = (typeof opts === 'number') ? { biasTop: opts } : (opts || {});
  const zoom = Math.max(0.1, Math.min(1, Number(o.zoom) || 0.55));
  const bias = o.biasTop === undefined ? 0.10 : Math.max(0, Math.min(1, Number(o.biasTop)));
  const size = Math.max(1, Math.round(Math.min(width, height) * zoom));
  const x = Math.max(0, Math.round((width - size) / 2));
  const y = Math.max(0, Math.min(height - size, Math.round((height - size) * bias)));
  return { x: x, y: y, size: size };
}

module.exports = {
  GRID,
  MAX_COLORS,
  MERGE_DISTANCE,
  sampleGrid,
  quantize,
  toHex,
  buildPortrait,
  drawPortrait,
  squareCrop,
};
