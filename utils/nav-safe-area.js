const DEFAULT_STATUS_BAR = 20
const DEFAULT_WINDOW_WIDTH = 375
const CLOSE_TARGET_SIZE = 44
const CAPSULE_GAP = 12
// 弹窗顶到胶囊底的距离。用户 2026-08-10 定:全站弹窗统一贴到「胶囊底下 5px」——
// 再高一点,右上角的「完成 / 关闭」就和微信胶囊挨在一起,手指一偏就点到「关闭小程序」,
// 而那是不可撤销的(整个编辑器的未保存内容一起没)。比 CAPSULE_GAP 紧,是因为弹窗顶部
// 那一条是抓手/留白,不放可点的东西。
const SHEET_GAP = 5

/**
 * Resolve the custom-navigation geometry that sits beside a WeChat capsule.
 * All values are px because menu-button coordinates are native px values.
 */
function resolveMenuChrome(windowInfo, menuButtonInfo) {
  const info = windowInfo || {}
  const windowWidth = Number(info.windowWidth) || DEFAULT_WINDOW_WIDTH
  const statusBarHeight = Number(info.statusBarHeight) || DEFAULT_STATUS_BAR
  const hasCapsule = menuButtonInfo
    && Number.isFinite(Number(menuButtonInfo.left))
    && Number.isFinite(Number(menuButtonInfo.top))
    && Number.isFinite(Number(menuButtonInfo.bottom))

  if (!hasCapsule) {
    return {
      actionTop: statusBarHeight + 8,
      actionRight: CAPSULE_GAP,
      contentTop: statusBarHeight + CLOSE_TARGET_SIZE + CAPSULE_GAP,
      sheetTop: statusBarHeight + CLOSE_TARGET_SIZE + SHEET_GAP,
    }
  }

  const left = Number(menuButtonInfo.left)
  const top = Number(menuButtonInfo.top)
  const bottom = Number(menuButtonInfo.bottom)

  return {
    actionTop: Math.max(statusBarHeight + 8, top),
    actionRight: Math.max(CAPSULE_GAP, windowWidth - left + CAPSULE_GAP),
    contentTop: Math.max(bottom + CAPSULE_GAP, statusBarHeight + CLOSE_TARGET_SIZE + CAPSULE_GAP),
    // ⚠️ 这里【不】像 contentTop 那样再兜一层 statusBar+44:那层兜底是给"内容不许钻到
    // 胶囊底下"用的,套到弹窗上会把顶再压低约 8pt,就不是用户要的「胶囊底 +5」了。
    // 拿得到胶囊坐标时,胶囊底本身已经是最靠谱的下沿,不需要再猜。
    sheetTop: bottom + SHEET_GAP,
  }
}

module.exports = {
  resolveMenuChrome,
  CLOSE_TARGET_SIZE,
  CAPSULE_GAP,
  SHEET_GAP,
}
