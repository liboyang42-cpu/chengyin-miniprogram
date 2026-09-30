const MOBILE_PATTERN = /^1[3-9]\d{9}$/

function isValidMobile(str) {
  return MOBILE_PATTERN.test(String(str == null ? '' : str))
}

function deriveCanSubmit(conditions) {
  return conditions.every(Boolean)
}

// 与后端 com.chengyinhub.common.utils.IdCardUtils 逐条同口径(校验位表、日期判、只收 18 位)。
// 前端这份只负责「当场说清哪一格错了」,真拦在校验位的一直是后端那一份 —— 两边算法不一致时,
// 用户会看到「前端放行、后端报格式不正确」这种解释不了的失败,所以改一边必须改两边。
const ID_CARD_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CARD_CHECK_CODES = '10X9876543'

/** 去首尾与内部空白、末位 x 转大写。手写 X 几乎必然是小写,不归一化会把合法号判成非法。 */
function normalizeIdCard(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '').toUpperCase()
}

function isValidIdCard(value) {
  const id = normalizeIdCard(value)
  if (id.length !== 18) return false
  if (!/^\d{17}[0-9X]$/.test(id)) return false
  const year = Number(id.slice(6, 10))
  const month = Number(id.slice(10, 12))
  const day = Number(id.slice(12, 14))
  if (year < 1900 || year > new Date().getFullYear()) return false
  if (month < 1 || month > 12) return false
  const daysInMonth = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day < 1 || day > daysInMonth[month - 1]) return false
  let sum = 0
  for (let i = 0; i < 17; i += 1) sum += Number(id.charAt(i)) * ID_CARD_WEIGHTS[i]
  return ID_CARD_CHECK_CODES.charAt(sum % 11) === id.charAt(17)
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

module.exports = {
  isValidMobile,
  isValidIdCard,
  normalizeIdCard,
  deriveCanSubmit,
}
