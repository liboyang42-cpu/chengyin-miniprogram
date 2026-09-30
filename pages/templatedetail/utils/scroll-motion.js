/**
 * utils/scroll-motion.js —— 滚动驱动动效(2026-08-22)
 *
 * 为什么用 this.animate 的 scrollSource,而不是 onPageScroll + setData:
 *   onPageScroll 里逐帧 setData 是小程序头号性能反模式(每帧一次跨线程拷贝)。
 *   this.animate 的 scrollSource 是官方 API,补间在视图层完成,不跨线程。
 *   ⚠️ 它在 WebView 渲染器上就能用,**不需要 Skyline** —— 审查文档里说容器变形「依赖 Skyline」
 *   那句话对滚动驱动这一类是过严的。
 *
 * 效果语义:Hero/背景随滚动**隐退**而不是硬切走,建立「它去哪了」的空间连续性
 * (HIG《Motion》:动效应表达元素从哪来、到哪去)。
 *
 * 纯函数 + 依赖注入,便于单测(node 里没有 wx / this.animate)。
 */

const { readReducedMotion } = require('../../../utils/motion-preference.js')

/** 隐退的默认幅度:留一点底,整块消失会让页面显得空 */
const DEFAULT_MIN_OPACITY = 0.2
const DEFAULT_MIN_SCALE = 0.94

/**
 * Hero 隐退的关键帧(纯函数)。
 * @returns {Array} this.animate 的 keyframes;offset 必须从 0 到 1 覆盖全程
 */
function heroRecedeFrames(options) {
  const opts = options || {}
  const minOpacity = typeof opts.minOpacity === 'number' ? opts.minOpacity : DEFAULT_MIN_OPACITY
  const minScale = typeof opts.minScale === 'number' ? opts.minScale : DEFAULT_MIN_SCALE
  return [
    { opacity: 1, transform: 'scale(1)', offset: 0 },
    { opacity: minOpacity, transform: `scale(${minScale})`, offset: 1 },
  ]
}

/**
 * 生成 this.animate 的 options;**返回 null 表示调用方应当整个跳过动画**。
 * 三种情况返回 null:
 *   ① 用户开了减动效 —— 大动效退化为「不做」,而不是做快一点;
 *   ② 没给 scrollSource —— 没有滚动源就没有驱动,硬跑会静默无效;
 *   ③ 区间非法(end <= start)—— 会得到一个除零式的怪异补间。
 * @param {Object} cfg scrollSource / startOffset / endOffset / timeRange / reducedMotion(可注入)
 */
function heroRecedeOptions(cfg) {
  const c = cfg || {}
  const reduced = typeof c.reducedMotion === 'boolean' ? c.reducedMotion : readReducedMotion()
  if (reduced) return null
  if (!c.scrollSource) return null
  const start = typeof c.startOffset === 'number' ? c.startOffset : 0
  const end = c.endOffset
  if (!(typeof end === 'number' && end > start)) return null
  const timeRange = typeof c.timeRange === 'number' && c.timeRange > 0 ? c.timeRange : 1000
  return {
    scrollSource: c.scrollSource,
    timeRange,
    startScrollOffset: start,
    endScrollOffset: end,
  }
}

/**
 * 一步到位:在页面里挂上 Hero 隐退。
 * @param {Object} page 页面实例(需有 animate 方法)
 * @param {string} selector 要隐退的元素
 * @param {Object} cfg 见 heroRecedeOptions
 * @returns {boolean} 是否真的挂上了(减动效/参数不全时返回 false,便于断言)
 */
function applyHeroRecede(page, selector, cfg) {
  const options = heroRecedeOptions(cfg)
  if (!options || !page || typeof page.animate !== 'function' || !selector) return false
  page.animate(selector, heroRecedeFrames(cfg), options.timeRange, options)
  return true
}

module.exports = {
  DEFAULT_MIN_OPACITY,
  DEFAULT_MIN_SCALE,
  heroRecedeFrames,
  heroRecedeOptions,
  applyHeroRecede,
}
