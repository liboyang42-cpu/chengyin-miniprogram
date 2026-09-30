// 集邮相机的几何真源。
//
// 2026-09-11 用户裁决「不是 canon 了 用原型的」:拟物机身整块退场,取景改成原型 camPanel 那张卡
// (原型 .cam:left/right 14px、top 96px、height 352px、radius 22px,快门 62 居中下 18)。
// 输出字段名一个没改 —— index.js 与 crop.js 仍按同一组坐标裁切,只是这组坐标现在描述的是
// 原型那张卡,不再是 LCD 孔洞。1px = 1.923rpx 的换算只在 wxss 里做,这里算的是 px。
const PROTO_W = 390;                 // 原型手机框宽
const PROTO_CARD_INSET = 14;         // .cam left/right
const PROTO_CARD_H = 352;            // .cam height
const PROTO_SHUTTER = 62;            // .cam__shutter
const PROTO_SHUTTER_BOTTOM = 18;     // .cam__shutter bottom

const MIN_FRAME_RATIO = 0.4;
const MAX_FRAME_RATIO = 0.9;
const DEFAULT_FRAME_RATIO = 0.74;

function clampFrameRatio(value) {
  const ratio = Number(value);
  const safeRatio = Number.isFinite(ratio) ? ratio : DEFAULT_FRAME_RATIO;
  return Math.min(MAX_FRAME_RATIO, Math.max(MIN_FRAME_RATIO, safeRatio));
}

function layoutStampCamera(options) {
  const width = Number(options && options.width);
  const height = Number(options && options.height);
  const statusBarHeight = Math.max(0, Number(options && options.statusBarHeight) || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('窗口尺寸必须大于 0');
  }

  const k = width / PROTO_W;                          // 原型 390 宽 → 本机宽
  const inset = Math.round(PROTO_CARD_INSET * k);
  // 卡顶让开微信胶囊那条带:原型写死 96,这里从安全区反算,窄屏也不会压到胶囊。
  const screenT = Math.max(Math.round(96 * k), statusBarHeight + 52);
  const screenL = inset;
  const screenW = Math.max(4, width - inset * 2);
  // 卡高照原型比例算,但不许越过屏底(留出一条 24px 的余量)。
  const screenH = Math.max(160, Math.min(Math.round(PROTO_CARD_H * k), height - screenT - Math.round(24 * k)));
  const screenB = screenT + screenH;

  // 参与裁切的取景框:卡内居中的 4:5 框,比例沿用原来的可调档位。
  const safeRatio = clampFrameRatio(options && options.frameRatio);
  const rawFrameW = Math.min(screenW * safeRatio, (screenH / 1.25) * safeRatio);
  const frameW = Math.max(4, Math.floor(rawFrameW / 4) * 4);
  const frameH = (frameW / 4) * 5;

  const shutterS = Math.round(PROTO_SHUTTER * k);
  const shutterL = Math.round(width / 2 - shutterS / 2);
  const shutterT = Math.round(screenB - Math.round(PROTO_SHUTTER_BOTTOM * k) - shutterS);

  return {
    // 卡本体就是「机身」——两组坐标合一,拟物那层没有了。
    bodyL: screenL,
    bodyT: screenT,
    bodyW: screenW,
    bodyH: screenH,
    artL: screenL,
    artT: screenT,
    artW: screenW,
    artH: screenH,
    screenL,
    screenT,
    screenW,
    screenH,
    frameW,
    frameH,
    frameL: Math.round(screenL + (screenW - frameW) / 2),
    frameT: Math.round(screenT + (screenH - frameH) / 2),
    shutterL,
    shutterT,
    shutterS,
    // 原型的 ✕ 在卡的左上角(12/12),不再固定在页面安全区。
    backL: screenL + Math.round(12 * k),
    backT: screenT + Math.round(12 * k),
    reviewL: screenL,
    reviewT: screenB + Math.round(16 * k),
    reviewW: screenW
  };
}

module.exports = {
  DEFAULT_FRAME_RATIO,
  MIN_FRAME_RATIO,
  MAX_FRAME_RATIO,
  clampFrameRatio,
  layoutStampCamera
};
