/**
 * utils/scratch-progress.js —— 刮开进度的判定(纯函数,可单测)
 *
 * 抽出来的理由:这是 cy-scratch 唯一一处「算得对不对」的地方,
 * 而它在组件里被 canvas 与触摸事件包着,放在那儿等于永远测不到。
 *
 * 判据是**已擦除面积占比**,不是擦了几下、也不是擦了多久 ——
 * 稿(Google Pay Scratch)的原话:「用揭示比例作为完成阈值,避免纯点击领奖」。
 */

/** 每隔 N 个像素采样一次。逐像素扫一张 750×400 的图在低端机上要几十毫秒,而这只是个百分比。 */
const PIXEL_STRIDE = 16;
/** alpha 低于这个值就算「已经擦掉了」——擦除边缘是渐变的,不设容差会把半透明边算成没擦 */
const CLEARED_ALPHA = 32;

/**
 * @param {Uint8ClampedArray|Array} data canvas getImageData().data(RGBA 四字节一组)
 * @returns {number} 0–1 的已擦除占比;数据不可用时给 0(而不是 1 —— 判不出来时不能白送)
 */
function scratchProgress(data) {
  if (!data || typeof data.length !== 'number' || data.length < 4) return 0;
  let cleared = 0;
  let total = 0;
  // 从 alpha 通道(下标 3)起步,每次跨 PIXEL_STRIDE 个像素
  for (let i = 3; i < data.length; i += 4 * PIXEL_STRIDE) {
    total++;
    if (data[i] < CLEARED_ALPHA) cleared++;
  }
  if (!total) return 0;
  return cleared / total;
}

/** 已抽样的 alpha 列表 → 擦除占比。生产 canvas 走这条，避免整帧 getImageData。 */
function sampledAlphaProgress(alphaSamples) {
  const list = Array.isArray(alphaSamples) ? alphaSamples : [];
  if (!list.length) return 0;
  let cleared = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] < CLEARED_ALPHA) cleared++;
  }
  return cleared / list.length;
}

/**
 * @param {number} progress 0–1
 * @param {number} threshold 0–1
 * @returns {boolean}
 */
function shouldReveal(progress, threshold) {
  const p = progress > 0 ? progress : 0;
  // 阈值缺失/非法时退回 0.45,而不是 0 —— 退回 0 会让"碰一下就揭示",正是稿要避免的纯点击领奖
  const t = threshold > 0 && threshold <= 1 ? threshold : 0.45;
  return p >= t;
}

module.exports = { scratchProgress, sampledAlphaProgress, shouldReveal, PIXEL_STRIDE, CLEARED_ALPHA };
