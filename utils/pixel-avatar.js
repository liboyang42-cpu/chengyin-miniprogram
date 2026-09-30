// 门店 AI 形象 · 预设像素头像渲染器。
//
// 职责只有两件:把 npc_profile.avatar 里存的那串编码解成一个预设 id,以及把它画进 canvas。
// 形状和配色都在 pixel-avatar-data.js —— 这么切是为了能测:解码是纯函数,断言得动;
// canvas 是副作用,只能靠眼睛。
//
// 存编码不存图片 URL,于是没有上传、没有对象存储、没有 CDN 回源、没有图挂了要兜底。
// 代价是消费端必须有这个渲染器,而地图 marker 本来就是 canvas 逐张画的,现成的管线。

'use strict';

const data = require('./pixel-avatar-data.js');

/** 编码前缀带版本号:以后换一批形象,老编码还认得出来,不至于满地图问号。 */
const CODE_PREFIX = 'px1:';

/** 62 进制单字符表。行程编码里的 x / y / 宽 / 调色板下标都用它,每段固定 4 字符。 */
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 兜底形象。任何解不出来的编码都落到它 —— marker 上宁可站错人,也不能开天窗。 */
const FALLBACK_ID = data.AVATAR_IDS[0];

function charIndex(c) {
  const i = CH.indexOf(c);
  return i < 0 ? 0 : i;
}

/**
 * 解析编码,例 'px1:p07' → 'p07'。
 * 前缀不对、id 不存在、传进来是 null,一律回兜底形象,不抛错也不返回空:
 * 这个值从数据库来,可能是老数据、别的版本写的、被人手改过的。
 */
function parseCode(code) {
  const raw = String(code || '');
  if (raw.indexOf(CODE_PREFIX) !== 0) return FALLBACK_ID;
  const id = raw.slice(CODE_PREFIX.length);
  return data.AVATARS[id] ? id : FALLBACK_ID;
}

/** id → 编码字符串。与 parseCode 互为逆运算,单测锁的就是这一条。 */
function stringifyCode(id) {
  return CODE_PREFIX + (data.AVATARS[id] ? id : FALLBACK_ID);
}

/** 该编码是不是这套预设形象(而不是商家上传的图片 URL)。接线时用它分流。 */
function isPixelAvatar(code) {
  return String(code || '').indexOf(CODE_PREFIX) === 0;
}

/**
 * 目标框内的整数倍放大边长。
 *
 * 只允许整数倍 —— 非整数倍产生半像素,那种糊法关掉插值也救不回来。
 * 与 roam-npc-marker 的 pixelDrawSize 同一条规矩,那边有单测。
 * 框比一格还小时退化成 1,画出来虽然小,但不会得到 0(0 会画出一个看不见的
 * marker,而且不报错 —— 那是最难查的一类)。
 */
function fitScale(n, box) {
  const grid = Number(n);
  const b = Number(box);
  // 脏输入直接回 1。别把无效的网格边长兜成 1 格 —— 那会算出「放大整个框」,
  // 画出一个占满屏的色块,比画小了难查得多。
  if (!isFinite(grid) || grid < 1 || !isFinite(b) || b < 1) return 1;
  return Math.max(1, Math.floor(b / grid));
}

/**
 * 把一个预设形象画进 canvas 2d 上下文。
 *
 * @param ctx    canvas 2d 上下文
 * @param code   npc_profile.avatar 里存的编码
 * @param originX/originY  左上角落点(像素)
 * @param scale  每格画多少像素,必须为正整数;调用方拿不准就用 fitScale
 * @returns 实际绘制的边长(像素),便于调用方居中
 */
function drawAvatar(ctx, code, originX, originY, scale) {
  const av = data.AVATARS[parseCode(code)];
  const s = Math.max(1, Math.floor(Number(scale) || 1));
  const side = av.n * s;
  ctx.fillStyle = av.bg;
  ctx.fillRect(originX, originY, side, side);
  paintRuns(ctx, av, originX, originY, s);
  return side;
}

/** 只画前景。背景色的格子在打包时就被丢掉了,靠调用方先铺一层底色顶上。 */
function paintRuns(ctx, av, originX, originY, s) {
  const d = av.d;
  for (let p = 0; p + 3 < d.length; p += 4) {
    const x = charIndex(d.charAt(p));
    const y = charIndex(d.charAt(p + 1));
    const w = charIndex(d.charAt(p + 2));
    const color = av.pal[charIndex(d.charAt(p + 3))];
    if (!color || w <= 0) continue;
    ctx.fillStyle = color;
    ctx.fillRect(originX + x * s, originY + y * s, w * s, s);
  }
}

/**
 * 把形象放进一个任意长宽的框里:底色铺满整框,像素按整数倍居中。
 *
 * 地图 marker 的框是 76×68,不是正方 —— 直接按框拉伸会把像素拉成长方块,
 * 那是这套画风最不能碰的一条。所以取短边算整数倍,长边方向留白由底色补齐。
 */
function drawAvatarInBox(ctx, code, x, y, w, h) {
  const av = data.AVATARS[parseCode(code)];
  ctx.fillStyle = av.bg;
  ctx.fillRect(x, y, w, h);
  const s = fitScale(av.n, Math.min(w, h));
  const side = av.n * s;
  paintRuns(ctx, av, x + Math.floor((w - side) / 2), y + Math.floor((h - side) / 2), s);
  return side;
}

/** 该形象的网格边长。调用方要先知道它才能算整数倍缩放。 */
function gridSize(code) {
  return data.AVATARS[parseCode(code)].n;
}

module.exports = {
  CODE_PREFIX,
  FALLBACK_ID,
  AVATAR_IDS: data.AVATAR_IDS,
  parseCode,
  stringifyCode,
  isPixelAvatar,
  fitScale,
  gridSize,
  drawAvatar,
  drawAvatarInBox,
};
