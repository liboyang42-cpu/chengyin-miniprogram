/**
 * utils/play-shake.js —— 摇一摇手势(纯逻辑,可单测)
 *
 * 抛硬币和掷骰子在原型里**一个按钮都没有**:摇一摇就抛。
 * 这一层把「什么算一次摇」抽出来,两个玩法共用 —— 各写一份的话阈值迟早不一样,
 * 而阈值不一样意味着同一个动作在两屏里一个认一个不认。
 *
 * ★ 阈值 26 与防抖 900ms 照抄原型,不是随手定的:
 *   低于 26 走路就会触发,而这两个玩法一触发就出结果,误触的代价是「还没准备好就抛了」。
 */

const SHAKE_MAG = 26;      // 三轴绝对值之和。低了走路都会触发
const SHAKE_GAP_MS = 900;  // 两次之间至少隔这么久,否则一次晃动会被读成好几次

/** 三轴读数 → 强度。用绝对值之和不用平方和开根:同一套判据要和原型完全一致。 */
function magnitude(acc) {
  if (!acc) return 0;
  return Math.abs(acc.x || 0) + Math.abs(acc.y || 0) + Math.abs(acc.z || 0);
}

/**
 * 造一个摇一摇识别器。传入 onShake,喂加速度读数,够力度且过了防抖才回调。
 * ⚠️ 小程序的 wx.onAccelerometerChange 给的是 g 为单位的三轴值,与 web 的
 * accelerationIncludingGravity 量纲一致(静止时合计约 1),所以阈值可以直接沿用。
 */
function createShakeDetector(onShake, opts) {
  const o = opts || {};
  const mag = o.magnitude || SHAKE_MAG;
  const gap = o.gapMs || SHAKE_GAP_MS;
  const now = o.now || (() => Date.now());
  /* -Infinity 而不是 0:第一次摇必须永远算数。写 0 的话,当 now() 返回的是
     一个小数(单测里注入的假时钟、或某些环境的 performance.now)时,首摇会被
     防抖当成「刚摇过」直接吞掉 —— 生产里 Date.now() 很大所以碰不到,
     但那是运气不是设计。 */
  let last = -Infinity;
  return function feed(acc) {
    if (magnitude(acc) <= mag) return false;
    const t = now();
    if (t - last <= gap) return false;
    last = t;
    if (typeof onShake === 'function') onShake();
    return true;
  };
}

module.exports = { magnitude, createShakeDetector, SHAKE_MAG, SHAKE_GAP_MS };
