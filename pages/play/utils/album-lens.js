'use strict';

/**
 * 相册全屏的两步几何(2026-09-24,效果照 X 上 @insporadesign「3D gradient cards」),纯函数,不碰画布。
 *
 * 1. cardColumns:照片排成一圈,偏移 o 格的那张绕自己竖轴转、往旁边挪,透视投影到屏幕;
 *    逐列算出这一列取照片的哪一列(u01,0~1)、画多高、画在哪。转过 90° 自然镜像。
 * 2. lensColumns:整屏左右边缘套一层固定的弯玻璃,底下画面经过时被拉伸:
 *    内沿一比一,越往屏幕边取样越慢(横向拉成拖影)、竖向越放大(外沿张开)。
 *    色散由调用方给红 / 绿 / 蓝不同的 flare,三层错开就裂出彩边。
 */

const TURN_DEG = 120;   // 转满一格时绕自己竖轴转多少度(过 90° 就是镜像)
const HIDE_AT = 1.45;   // 离中间超过这么多格就不画了

/** 第 k 张相对当前位置 pos 的偏移,首尾相接,落在 (-n/2, n/2] */
function offsetOf(k, pos, n) {
  let o = (((k - pos) % n) + n) % n;
  if (o > n / 2) o -= n;
  return o;
}

/**
 * opts: o 偏移格数;cx / cy 屏幕中心;cardW / cardH 卡片尺寸;sideX 转满一格往旁边挪多远;
 *       P 透视距离;radius 卡片圆角(同单位,一般是画布像素)
 */
function cardColumns(opts) {
  const a = Math.abs(opts.o);
  if (a > HIDE_AT) return [];
  const s = opts.o < 0 ? -1 : 1;
  const th = (s * TURN_DEG * Math.min(1, a) * Math.PI) / 180;
  const tx = s * opts.sideX * Math.min(a, 1) + s * opts.sideX * 0.3 * Math.max(0, a - 1);
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const P = opts.P;
  const w = opts.cardW;
  const r = Math.max(0, opts.radius || 0);
  const edge = (u) => ((tx + u * c) * P) / (P - -u * sn);
  const x0 = Math.min(edge(-w / 2), edge(w / 2));
  const x1 = Math.max(edge(-w / 2), edge(w / 2));
  const cols = [];
  for (let xs = Math.ceil(x0); xs <= Math.floor(x1); xs += 1) {
    const den = P * c - xs * sn;
    if (Math.abs(den) < 1e-6) continue;
    const u = (P * (xs - tx)) / den;
    if (u < -w / 2 || u > w / 2) continue;
    const k = P / (P + u * sn);
    let dh = opts.cardH * k;
    const d = Math.min(u + w / 2, w / 2 - u);
    if (d < r) dh -= 2 * (r - Math.sqrt(r * r - (r - d) * (r - d))) * k;
    cols.push({ dx: opts.cx + xs, dy: opts.cy - dh / 2, dh, u01: (u + w / 2) / w });
  }
  return cols;
}

/**
 * 边缘玻璃:W 画面宽,zone 每侧玻璃多宽,flare 外沿放大量,shift 外沿横向错位(像素,色散用,默认 0)。
 * 返回两侧每一列:画在 dx,从底图第 sx 列取,竖向放大 scale 倍(绕画面竖直中心);t 是离内沿多远(0 内沿 ~ 1 屏幕边)。
 * 色散要收着:三个通道 flare 只差一点、shift 只有几个像素,彩色才只落在轮廓和明暗交界上,不把整片染花。
 */
function lensColumns(opts) {
  const W = Math.floor(opts.W);
  const zone = Math.max(1, Math.floor(opts.zone));
  const cols = [];
  for (let x = 0; x < zone; x += 1) {
    const t = 1 - x / zone;                   // 0 = 玻璃内沿, 1 = 屏幕边
    const pull = zone * (t - (t * t) / 2);    // 内沿斜率 1(接得上),屏幕边斜率 0(拉成拖影)
    const scale = 1 + opts.flare * t * t;
    const off = (opts.shift || 0) * t * t;    // 外沿错得最多,内沿不错位
    cols.push({ dx: x, sx: Math.max(0, zone - pull + off), scale, t });
    cols.push({ dx: W - 1 - x, sx: Math.min(W - 1, W - 1 - zone + pull - off), scale, t });
  }
  return cols;
}

module.exports = { offsetOf, cardColumns, lensColumns, HIDE_AT };
