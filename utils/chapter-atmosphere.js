// 章节配色(2026-09-06 用户拍板:黑 / 蓝 / 红 / 黄 / 白,**纯色,没有渐变**)。
// 之前是 5 档带 radial-gradient 的氛围(默认/夜行/纸页/苔野/霓虹),已整组换掉。
//
// ⚠️ 取值域变了,但**存量不能读废**:库里已经存着 NIGHT / ARCHIVE / MOSS / NEON 的章节。
//    LEGACY_ALIAS 把它们收敛到最接近的新档(苔野没有对应色,落回默认黑),
//    normalizeAtmosphere 与后端 ChapterAtmospherePreset 用的是同一张表 —— 两侧必须一致,
//    否则同一条数据在发布器与玩家端会显示成两个颜色。
const PRESETS = [
  { value: 'DEFAULT', label: '黑', note: '沉浸深色', className: 'atmosphere-swatch--default' },
  { value: 'BLUE',    label: '蓝', note: '靛蓝夜路', className: 'atmosphere-swatch--blue' },
  { value: 'RED',     label: '红', note: '警示暗红', className: 'atmosphere-swatch--red' },
  { value: 'YELLOW',  label: '黄', note: '旧纸暖黄', className: 'atmosphere-swatch--yellow' },
  { value: 'WHITE',   label: '白', note: '明亮浅色', className: 'atmosphere-swatch--white' },
]

const VALUE_SET = new Set(PRESETS.map((item) => item.value))

// 存量 → 新档。改这张表要连后端 ChapterAtmospherePreset.LEGACY_ALIAS 一起改。
const LEGACY_ALIAS = {
  NIGHT: 'BLUE',     // 靛蓝夜路 → 蓝
  ARCHIVE: 'YELLOW', // 旧档案纸 → 黄
  NEON: 'RED',       // 夜城灯牌 → 红
  MOSS: 'DEFAULT',   // 湿润绿影 —— 新色板里没有绿,落回默认黑
}

function normalizeAtmosphere(value) {
  const normalized = String(value || 'DEFAULT').trim().toUpperCase()
  if (VALUE_SET.has(normalized)) return normalized
  return LEGACY_ALIAS[normalized] || 'DEFAULT'
}

function atmosphereClass(value) {
  return 'atmosphere--' + normalizeAtmosphere(value).toLowerCase()
}

module.exports = { PRESETS, LEGACY_ALIAS, normalizeAtmosphere, atmosphereClass }
