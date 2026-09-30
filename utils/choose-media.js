/**
 * utils/choose-media.js —— wx.chooseMedia 的两段易错适配(2026-08-22)
 *
 * wx.chooseImage 已被官方标记废弃,基础库后续版本会失效。迁到 wx.chooseMedia 时有两个坑,
 * 而且两个坑都是**静默的**(不报错、不崩溃,只是行为不对),所以单独抽出来加测试:
 *
 *   ① 响应结构变了:chooseImage 给 res.tempFilePaths(字符串数组),
 *      chooseMedia 给 res.tempFiles(对象数组,路径在 .tempFilePath)。
 *      只改 API 名不改取值 ⇒ 选完图什么都没发生,而且不报错(空数组直接 return)。
 *   ② 取消的 errMsg 前缀跟着变:chooseImage:fail cancel → chooseMedia:fail cancel。
 *      只认旧前缀 ⇒ 用户点「取消」会被弹成错误框。
 */

/**
 * 从 chooseMedia / chooseImage 的响应里取出图片临时路径。
 * 两种结构都兜:低版本基础库回退到 chooseImage 时仍是旧结构。
 * @returns {string[]} 永远是数组;缺 tempFilePath 的条目会被滤掉(别把 undefined 塞进上传)
 */
function pickImagePaths(res) {
  const r = res || {}
  const fromMedia = (r.tempFiles || [])
    .map((f) => f && f.tempFilePath)
    .filter(Boolean)
  if (fromMedia.length) return fromMedia
  return (r.tempFilePaths || []).filter(Boolean)
}

/**
 * 这次失败是不是「用户主动取消」。
 * 新旧前缀都算 —— 只认一种会把取消弹成错误框。
 * ⚠️ 真错误(auth deny / system error)必须返回 false,否则会把真故障吞掉。
 */
function isChooseCancelled(errMsg) {
  return /^choose(Image|Media):fail cancel$/.test(errMsg || '')
}

module.exports = { pickImagePaths, isChooseCancelled }
