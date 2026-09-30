// play-audio-level · 麦克风帧振幅 → 底噪/阈值/档位(现场感契约 §5.1:从 playkit-quiethold 原样抽出)
//
// ★ 抽出来而不是复制:quiethold(别出声)与 shout(喊一嗓子)共用同一套电平算法 ——
//   两处各养一份的话,「同一声咳嗽在一个玩法里过线、另一个里没事」迟早出现。
// ★ 判**峰值**不判均值:一声咳嗽在均值里会被摊平,而人的直觉对得上峰值。
// ★ 阈值必须现场校准,不能写死:咖啡馆的底噪比书店高一大截,
//   书店的阈值拿到咖啡馆就是「一开局就输」,这玩法直接不能用。
//   取 80 分位当底噪 —— 不取最大值,否则校准那两秒里的一次咳嗽会把线抬到没人能触发。

const MID_OVER_BASE = 0.06;    // 黄线 = 底噪 + 这个
const HOT_OVER_MID = 0.09;     // 红线 = 黄线 + 这个

/** 采样序列 → 底噪。取 80 分位,别被一次咳嗽带偏;没采到给一个保守的低值。 */
function baseline(samples) {
  const list = (samples || []).slice().sort((a, b) => a - b);
  if (!list.length) return 0.06;
  return list[Math.floor(list.length * 0.8)] || 0.06;
}

/** 底噪 → 黄线 / 红线。都夹在合理区间里:校准到极端值时不能让阈值跑飞。 */
function thresholds(base) {
  const mid = Math.min(0.5, Math.max(0.12, base + MID_OVER_BASE));
  return { mid, hot: Math.min(0.72, mid + HOT_OVER_MID) };
}

/** 当前音量落在哪一档。hot = 过线,判输。 */
function bandOf(level, mid, hot) {
  if (level > hot) return 'hot';
  if (level > mid) return 'mid';
  return 'ok';
}

/** PCM 帧 → 0–1 峰值。拿不到数据时给 0,不猜。 */
function peakOf(buffer) {
  if (!buffer || !buffer.byteLength) return 0;
  const view = new Int16Array(buffer);
  let peak = 0;
  for (let i = 0; i < view.length; i++) {
    const v = Math.abs(view[i]) / 32768;
    if (v > peak) peak = v;
  }
  return peak;
}

module.exports = { MID_OVER_BASE, HOT_OVER_MID, baseline, thresholds, bandOf, peakOf };
