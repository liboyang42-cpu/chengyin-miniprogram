/**
 * 显形档:什么时候切到真 AR、每个阶段对玩家说什么(纯函数,可单测)。
 */

/**
 * 只在五件事都成立时切到 AR:
 *   显形档 · 已扫中(到店凭证只认码,扫码阶段一律照旧) · 配了 AR · 手机跑得动 · 这回没失败过
 * 任何一条不成立就走屏幕叠加 —— 那一版就是回落,不是另一套玩法。
 */
function shouldUseAr({ kindKey, overlayUrl, arMode, supported, arFail }) {
  return kindKey === '显形' && !!overlayUrl
    && (arMode === 'PLANE' || arMode === 'MARKER')
    && !!supported && !arFail;
}

/** 这台手机能不能跑 xr-frame + VisionKit。运行时还有 ar-error 兜底,这里只挡明显不行的。 */
function arSupported() {
  try {
    if (typeof wx === 'undefined' || !wx.getXrFrameSystem || !wx.isVKSupport) return false;
    return !!(wx.isVKSupport('v2') || wx.isVKSupport('v1'));
  } catch (e) {
    return false;
  }
}

/** 底部说明条的字。放下/认到之后给空串:画面让出来,话交给气泡。 */
function pillOf(mode, phase) {
  if (phase === 'placed' || phase === 'tracked') return '';
  if (mode === 'PLANE') return phase === 'found' ? '点一下屏幕，把它放在这儿' : '对着地面慢慢移动手机';
  if (mode === 'MARKER') return '对准这张图';
  return '';
}

module.exports = { shouldUseAr, arSupported, pillOf };
