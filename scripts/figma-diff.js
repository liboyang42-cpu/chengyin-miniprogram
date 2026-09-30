/*
 * figma-diff.js —— 稿 ↔ 实拍 的像素差异回路。
 *
 * 为什么要它:截完图我只能说「看着差不多」,4px 的间距差和 500/600 的字重差靠肉眼判不出来,
 * 于是永远停在「差不多」。这个脚本给出一个**能变红的判据**:差异率 + 差异图。
 *
 * 用法:
 *   node scripts/figma-diff.js --baseline 稿.png --actual 实拍.png --out 差异图.png \
 *        [--mask 0,0,390,60] [--mask 250,40,390,90] [--threshold 0.1] [--max-rate 2]
 *
 *   --mask x1,y1,x2,y2   在**基线坐标系**里挖掉一块不参与比对(可多次)。
 *                        必挖的两处:①系统状态栏(稿上是假的时间/电量,实拍是真的)
 *                        ②微信胶囊(稿上根本没有这个东西)。
 *   --max-rate N         差异率超过 N% 时 exit 1。不给就只报数不判红。
 *
 * ⚠️ 两张图尺寸不同时按**基线宽度**等比缩放实拍图再比 —— 稿是 393pt 宽,
 *    模拟器截图是 390pt × DPR。缩放本身会引入亚像素噪声,所以 threshold 默认放到 0.1,
 *    比 pixelmatch 默认的 0.1 不变;真正要看的是差异**分布**(差异图),不是绝对数值。
 *
 * ⚠️ 差异率不是「还原度」。照片、随机头像、真实时间这些必然不同的区域不挖掉,
 *    差异率会被它们淹没,读出来的数字毫无意义。挖不干净时以差异图为准。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

function parseArgs(argv) {
  const out = { mask: [], threshold: 0.1, maxRate: null, alignY: 0, offsetY: 0, profile: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--baseline') out.baseline = argv[++i];
    else if (k === '--actual') out.actual = argv[++i];
    else if (k === '--out') out.out = argv[++i];
    else if (k === '--threshold') out.threshold = Number(argv[++i]);
    else if (k === '--max-rate') out.maxRate = Number(argv[++i]);
    else if (k === '--align-y') out.alignY = Number(argv[++i]);
    else if (k === '--offset-y') out.offsetY = Number(argv[++i]);
    else if (k === '--profile') out.profile = true;
    else if (k === '--mask') {
      const nums = String(argv[++i]).split(',').map(Number);
      if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
        throw new Error('--mask 要四个数:x1,y1,x2,y2');
      }
      out.mask.push(nums);
    }
  }
  if (!out.baseline || !out.actual) throw new Error('--baseline 与 --actual 都必须给');
  return out;
}

function readPng(file) {
  if (!fs.existsSync(file)) throw new Error('找不到图片:' + file);
  return PNG.sync.read(fs.readFileSync(file));
}

/* 最近邻缩放。用最近邻不用双线性:双线性会把 1px 的描边糊成 2px 的渐变,
   而「描边粗了 1px」正是这个回路要抓的那类差异,糊掉就抓不到了。 */
function resize(src, w, h) {
  const dst = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w));
      const si = (sy * src.width + sx) << 2;
      const di = (y * w + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

/* 在基线里按 y 偏移裁一段出来。稿是整条长图,实拍是一屏 —— 要比的是稿的**哪一段**,
   由滚动位置决定;而两边的起点还差一个不定的量(稿自带假状态栏,实拍是真状态栏 + 微信胶囊)。
   所以给一个 --align-y N:在 ±N 内暴力找差异最小的那个偏移,不靠我拿尺子量。 */
function cropY(src, y0, h) {
  const dst = new PNG({ width: src.width, height: h });
  for (let y = 0; y < h; y++) {
    const sy = y + y0;
    if (sy < 0 || sy >= src.height) continue;
    src.data.copy(dst.data, (y * src.width) << 2, (sy * src.width) << 2, ((sy + 1) * src.width) << 2);
  }
  return dst;
}

/* 把挖掉的区域在两张图上刷成同一个颜色 —— pixelmatch 没有 ignore region,
   只能让两边在那块长得一样。刷成洋红是为了在差异图上一眼认出「这里是我主动不看的」。 */
function applyMasks(a, b, rects) {
  let masked = 0;
  for (const [x1, y1, x2, y2] of rects) {
    for (let y = Math.max(0, y1); y < Math.min(a.height, y2); y++) {
      for (let x = Math.max(0, x1); x < Math.min(a.width, x2); x++) {
        const i = (y * a.width + x) << 2;
        for (const img of [a, b]) {
          img.data[i] = 255; img.data[i + 1] = 0; img.data[i + 2] = 255; img.data[i + 3] = 255;
        }
        masked++;
      }
    }
  }
  return masked;
}

/* 行剖面:把每一行「有多少像素明显偏离该行主色」算出来,再压成一段段「内容带」。
   为什么要它:单一差异率只能告诉我「差了多少」,告诉不了「哪一块差」。
   两边的内容带列表并排一看,就是「标题带对齐、核销带低了 26px」这种能直接动手的结论。
   ⚠️ 只看行,不看列 —— 横向差异(左右边距)得靠差异图看,这个剖面抓不到。
   ⚠️⚠️ 两边段数不等时,按序号配对就是错的:一侧多出一段,后面全部串位,
        读出来会是一串越来越大的假偏差(实测踩过:21 段 vs 17 段,末尾报 +145px,
        实际逐行量只差 2.5px)。**段数不等时只看两边各自的段列表,不要读「差 N px」那一列**。 */
function rowProfile(img) {
  const { width, height, data } = img;
  const ink = [];
  for (let y = 0; y < height; y++) {
    // 该行的中位亮度当作「底色」,偏离超过 24 的算内容
    const lum = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) << 2;
      lum.push((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000);
    }
    const sorted = lum.slice().sort((m, n) => m - n);
    const base = sorted[sorted.length >> 1];
    let n = 0;
    for (const v of lum) if (Math.abs(v - base) > 24) n++;
    ink.push(n / width);
  }
  // 压成带:连续 ≥3 行有内容(>1.5% 的像素偏离)算一带,带间空 ≥6 行才断开
  const bands = [];
  let start = -1, gap = 0;
  for (let y = 0; y < height; y++) {
    if (ink[y] > 0.015) { if (start < 0) start = y; gap = 0; }
    else if (start >= 0) { if (++gap >= 6) { if (y - gap - start >= 3) bands.push([start, y - gap]); start = -1; gap = 0; } }
  }
  if (start >= 0 && height - start >= 3) bands.push([start, height - 1]);
  return bands;
}

function printProfile(baseline, actual, offset) {
  const A = rowProfile(baseline), B = rowProfile(actual);
  console.log(`\n内容带(稿 ${A.length} 段 / 实拍 ${B.length} 段;稿的 y 已减去起点 ${offset})`);
  if (A.length !== B.length) {
    console.log('  ⚠️ 两边段数不等 —— 按序号配对必然串位,下面「差 N px」那一列不可读,只看各自的段区间');
  }
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const a = A[i], b = B[i];
    const as = a ? `${a[0] - offset}–${a[1] - offset}` : '—';
    const bs = b ? `${b[0]}–${b[1]}` : '—';
    const d = (a && b) ? (b[0] - (a[0] - offset)) : null;
    const flag = d == null ? '' : (Math.abs(d) >= 4 ? `  ← 差 ${d > 0 ? '+' : ''}${d}px` : '');
    console.log(`  ${String(i + 1).padStart(2)}  稿 ${as.padEnd(12)} 实拍 ${bs.padEnd(12)}${flag}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseline = readPng(args.baseline);
  let actual = readPng(args.actual);

  // 统一到基线尺寸。实拍图通常更高(模拟器有 home indicator),按宽度等比缩放后
  // 只比两者共有的那一段高度 —— 拿基线没有的那部分去比,比出来的差异不是差异。
  if (actual.width !== baseline.width) {
    const h = Math.round((actual.height * baseline.width) / actual.width);
    actual = resize(actual, baseline.width, h);
  }
  // 实拍是一屏,稿是整条长图 —— 比的是稿里对应的那一段,高度以实拍为准
  const h = Math.min(baseline.height, actual.height);
  const b = cropY(actual, 0, h);

  /* 起点对齐。两边差一个不定的量:稿自带假状态栏,实拍是真状态栏 + 微信胶囊,
     滚动位置也未必落在整数。--align-y N 就在 [offsetY-N, offsetY+N] 里挑差异最小的那个,
     不靠我拿尺子量 —— 量错一个像素,后面所有数字都是噪声。 */
  let bestOffset = args.offsetY, bestChanged = Infinity, a = null, diff = null, maskedPx = 0;
  const step = args.alignY > 40 ? 2 : 1;
  for (let off = args.offsetY - args.alignY; off <= args.offsetY + args.alignY; off += step) {
    const cand = cropY(baseline, off, h);
    const candB = cropY(b, 0, h);
    const masked = applyMasks(cand, candB, args.mask);
    const d = new PNG({ width: baseline.width, height: h });
    const c = pixelmatch(cand.data, candB.data, d.data, baseline.width, h, {
      threshold: args.threshold, includeAA: false,
    });
    if (c < bestChanged) { bestChanged = c; bestOffset = off; a = cand; diff = d; maskedPx = masked; }
  }
  const changed = bestChanged;

  const total = baseline.width * h;
  const compared = total - maskedPx;
  const rate = compared > 0 ? (changed / compared) * 100 : 0;

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, PNG.sync.write(diff));
  }

  if (args.alignY) console.log(`  起点对齐:稿的 y=${bestOffset}(在 ±${args.alignY} 内搜出来的最优)`);
  const heightNote = baseline.height === actual.height ? ''
    : `  (只比共有的 ${h}px:稿 ${baseline.height} / 实拍缩放后 ${actual.height})`;
  console.log(`差异率 ${rate.toFixed(2)}%  —— ${changed} / ${compared} 像素${heightNote}`);
  if (maskedPx) console.log(`  挖掉 ${args.mask.length} 块共 ${maskedPx} 像素(洋红区)`);
  if (args.out) console.log(`  差异图 ${args.out}`);

  if (args.profile) printProfile(a, b, 0);

  if (args.maxRate != null && rate > args.maxRate) {
    console.log(`✗ 超过上限 ${args.maxRate}%`);
    process.exit(1);
  }
}

/* 自检:这个回路自己要能变红,否则它只是个恒绿的摆设。
   ① 同一张图比自己 → 必须 0%;② 把实拍整体下移 30px → 不对齐时必须显著非 0,
   开了 --align-y 之后必须回到 0% 且报出 y=-30。
   ★ 符号约定(第一版写反了,自检当场抓到):offset 是「从稿的第几行开始裁」——
     实拍内容更靠下,就要把稿往上补,offset 为负。 */
function selftest() {
  const W = 80, H = 200;
  const make = (shift) => {
    const img = new PNG({ width: W, height: H });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) << 2;
      const sy = y - shift;
      const on = sy >= 40 && sy < 60 && x >= 10 && x < 70;   // 一条横带当「内容」
      img.data[i] = img.data[i + 1] = img.data[i + 2] = on ? 0 : 255;
      img.data[i + 3] = 255;
    }
    return img;
  };
  const run = (a, b, alignY) => {
    let best = Infinity, bestOff = 0;
    for (let off = -alignY; off <= alignY; off++) {
      const ca = cropY(a, off, H), cb = cropY(b, 0, H);
      const d = new PNG({ width: W, height: H });
      const c = pixelmatch(ca.data, cb.data, d.data, W, H, { threshold: 0.1, includeAA: false });
      if (c < best) { best = c; bestOff = off; }
    }
    return { changed: best, offset: bestOff };
  };
  const flat = make(0), moved = make(30);
  const same = run(flat, flat, 0);
  const naive = run(flat, moved, 0);
  const aligned = run(flat, moved, 40);
  const ok = same.changed === 0 && naive.changed > 0 && aligned.changed === 0 && aligned.offset === -30;
  console.log(`自检 同图 ${same.changed}px / 错位不对齐 ${naive.changed}px / 对齐后 ${aligned.changed}px @y=${aligned.offset}`);
  console.log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL');
  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  try {
    if (process.argv.includes('--selftest')) selftest();
    else main();
  } catch (e) { console.error('ERR ' + (e && e.message || e)); process.exit(2); }
}

module.exports = { resize, applyMasks };
