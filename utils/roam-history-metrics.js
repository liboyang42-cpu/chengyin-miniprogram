'use strict'

/**
 * 漫游历史记录的数值读取契约(R9-42)。
 *
 * 落盘的历史记录跨了两个版本:早期 pages/roam 的 `_saveSession` 把展示用的
 * `distance`(toFixed(1) 的字符串,如 "0.2")原样写进 session,后来读方只按 number
 * 解析 —— "0.2" 被判成未知,列表/详情把已经走出来的里程显示成「—」,连真实的
 * 0 米会话(存 "0.0")也一起显示成缺失。
 *
 * 这里统一读方口径,与既有 `nonNegativeNumber` 同一合同(有限、>= 0 才算已知,
 * 否则 null),只额外接受**可靠的数字字符串**(老记录):
 *   · 0 / "0"   → 0     真实走出来的零,必须显示 0,不能与未知合并
 *   · "0.2"     → 0.2   老记录里的正常里程
 *   · null/''/'bad'/负数/NaN → null  未知,显示「—」
 *
 * 只加宽「数字字符串」这一种;空串、空白、非数字一律仍是未知,不伪造零。
 */
function readNonNegative(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  if (typeof value === 'string') {
    const text = value.trim()
    // 只认老记录真正会写的十进制写法(toFixed(1) 的 "0.2" / "0.0");"0x10"/"1e3"/"-1"
    // 这类不是「可靠的旧数值字符串」,不能被 Number() 的宽容放进来冒充里程。
    if (!/^\d+(\.\d+)?$/.test(text)) return null
    const number = Number(text)
    return Number.isFinite(number) && number >= 0 ? number : null
  }
  return null
}

module.exports = { readNonNegative }
