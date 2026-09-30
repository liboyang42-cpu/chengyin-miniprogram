/**
 * utils/font-scale.js —— Dynamic Type(2026-08-22)
 *
 * 小程序的 rpx 是死值,系统/微信里的字号设置对它完全无效 —— 视力不好的用户把字号调大,
 * 我们的界面纹丝不动(HIG《Typography》的 Dynamic Type、Material 的 font scaling 都要求跟随)。
 * 这里把用户的字号设置换算成一个倍率,由页面注入 CSS 变量 --cy-type-scale,
 * tokens.wxss 的 9 档字阶用 calc(基准 * var(--cy-type-scale)) 消费它。
 *
 * 为什么要夹逼(clamp):
 *   · 下限 1 —— 只放大不缩小。用户把字号调小是为了「一屏看更多」,而我们的布局是按基准值
 *     设计的,跟着缩小只会让本来就 20rpx 的 micro 档掉到不可读,反而伤可读性。
 *   · 上限 1.3 —— 再大就不是「放大字」而是「换一套布局」了(卡片高度、两行省略、按钮换行
 *     全都要重排)。到顶后应该走「大字模式」的独立布局,不在本层解决。
 *
 * 纯函数 + 依赖注入,便于单测(node 里没有 wx)。
 */

const BASE_FONT_SIZE = 16   // 微信字号设置的默认值(px)
const MIN_SCALE = 1
const MAX_SCALE = 1.3

/**
 * 把微信的 fontSizeSetting 换算成字阶倍率(纯函数)。
 * @param {number} fontSizeSetting wx.getAppBaseInfo().fontSizeSetting
 * @returns {number} [1, 1.3] 之间的倍率;拿不到设置时返回 1(不放大,不是报错)
 */
function scaleFromSetting(fontSizeSetting) {
  const size = Number(fontSizeSetting)
  if (!Number.isFinite(size) || size <= 0) return MIN_SCALE
  const raw = size / BASE_FONT_SIZE
  if (raw < MIN_SCALE) return MIN_SCALE
  if (raw > MAX_SCALE) return MAX_SCALE
  // 定到两位小数:倍率会进 CSS 字符串,尾数太长既没意义又让 setData 值抖动
  return Math.round(raw * 100) / 100
}

/**
 * 生成给 <page-meta page-style> 用的样式串。
 * @param {number} scale scaleFromSetting 的结果
 * @returns {string} 倍率为 1 时返回空串 —— 不写无谓的 style,免得每个页面都多一次 setData
 */
function pageStyleFor(scale) {
  return scale === MIN_SCALE ? '' : `--cy-type-scale: ${scale};`
}

/**
 * 读当前用户的字阶倍率。sys 可注入(单测用)。
 * @param {Object} [sys] 形如 { fontSizeSetting: 20 };不传则读 wx
 */
function readFontScale(sys) {
  if (sys) return scaleFromSetting(sys.fontSizeSetting)
  if (typeof wx === 'undefined') return MIN_SCALE
  try {
    const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {}
    return scaleFromSetting(info.fontSizeSetting)
  } catch (e) {
    return MIN_SCALE   // 读不到就按不放大处理,绝不让它掀翻页面
  }
}

/** 一步到位:给页面 data 用的 page-style 串 */
function readPageStyle(sys) {
  return pageStyleFor(readFontScale(sys))
}

module.exports = {
  BASE_FONT_SIZE,
  MIN_SCALE,
  MAX_SCALE,
  scaleFromSetting,
  pageStyleFor,
  readFontScale,
  readPageStyle,
}
