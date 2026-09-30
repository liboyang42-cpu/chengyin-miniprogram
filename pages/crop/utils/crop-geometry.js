/* 裁剪几何(纯函数,无 wx 依赖 → 可单测)
 *
 * 坐标模型:裁剪框固定居中不动,图片在框内平移缩放(参考 Threads 选图裁剪)。
 * · baseScale = 图片 cover 满框的基准缩放;渲染尺寸 = 原图 × baseScale × scale。
 * · scale ∈ [1, MAX_SCALE]:下限锁 1 是因为 base 已是 cover,再小就会露黑边。
 * · x/y = 图片相对框心的位移(px,右/下为正),边界 = 渲染尺寸超出框的一半。
 */

const MIN_SCALE = 1;
const MAX_SCALE = 4;

// '16:9' → 1.777…;自由比例/非法值 → null(调用方改用原图比例)
function parseRatio(literal) {
  if (typeof literal !== 'string') return null;
  const m = /^(\d+):(\d+)$/.exec(literal.trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  return w / h;
}

function baseScaleOf(imgW, imgH, frameW, frameH) {
  return Math.max(frameW / imgW, frameH / imgH);
}

function clamp(v, lo, hi) {
  const r = Math.min(hi, Math.max(lo, v));
  return r === 0 ? 0 : r; // 夹到 0 时 Math 会给出 -0,归一避免下游 Object.is 比较意外
}

function clampTransform(s) {
  const scale = clamp(s.scale, MIN_SCALE, MAX_SCALE);
  const base = baseScaleOf(s.imgW, s.imgH, s.frameW, s.frameH);
  const renderW = s.imgW * base * scale;
  const renderH = s.imgH * base * scale;
  // 余量为负(浮点误差导致渲染略小于框)时夹成 0,避免抖动
  const maxX = Math.max(0, (renderW - s.frameW) / 2);
  const maxY = Math.max(0, (renderH - s.frameH) / 2);
  return { scale, x: clamp(s.x, -maxX, maxX), y: clamp(s.y, -maxY, maxY) };
}

// → 源图像素坐标系下的裁剪矩形,直接喂 canvas drawImage 的 sx/sy/sw/sh
function computeCropRect(s) {
  if (!(s.imgW > 0 && s.imgH > 0 && s.frameW > 0 && s.frameH > 0)) return null;
  const t = clampTransform(s);
  const base = baseScaleOf(s.imgW, s.imgH, s.frameW, s.frameH);
  const eff = base * t.scale; // 源图 → 屏幕的总缩放
  const renderW = s.imgW * eff;
  const renderH = s.imgH * eff;
  // 框左边缘在渲染图坐标里的位置,换算回源图像素
  const sx = ((renderW - s.frameW) / 2 - t.x) / eff;
  const sy = ((renderH - s.frameH) / 2 - t.y) / eff;
  const sw = s.frameW / eff;
  const sh = s.frameH / eff;
  return {
    sx: clamp(sx, 0, Math.max(0, s.imgW - sw)),
    sy: clamp(sy, 0, Math.max(0, s.imgH - sh)),
    sw: Math.min(sw, s.imgW),
    sh: Math.min(sh, s.imgH),
  };
}

module.exports = { parseRatio, baseScaleOf, clampTransform, computeCropRect, MIN_SCALE, MAX_SCALE };
