// 拍物成卡 · 当场揭晓的纯逻辑(施工文档第四版 §3.2)。组件只管画,算法都在这里,单测钉住。

/** aspectFill:图铺满框、居中裁掉多出的部分。返回图实际画在框坐标里的位置(可能是负数)。 */
function coverRect(imgW, imgH, boxW, boxH) {
  const k = Math.max(boxW / imgW, boxH / imgH);
  const w = imgW * k;
  const h = imgH * k;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** 物品位置 [x,y,w,h](占原图的比例)换算到「照片画在哪」那块矩形上。 */
function boxToRect(box, drawn) {
  return { x: drawn.x + box[0] * drawn.w, y: drawn.y + box[1] * drawn.h, w: box[2] * drawn.w, h: box[3] * drawn.h };
}

/** aspectFit:整件放进 {cx,cy,w,h} 的框里,居中不变形。 */
function fitRect(w, h, frame) {
  const k = Math.min(frame.w / w, frame.h / h);
  const fw = w * k;
  const fh = h * k;
  return { x: frame.cx - fw / 2, y: frame.cy - fh / 2, w: fw, h: fh };
}

/** 位置只认四个 0 到 1 之间的数、宽高大于 0、不越出原图。其余当没有。 */
function validBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  if (!box.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const [x, y, w, h] = box;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) return null;
  return box.slice();
}

/**
 * 按快门之后回来的是哪一种结果。before = 按快门那一刻,after = 现在。
 * 返回 null = 还没回来(继续转圈)。
 */
function outcome(before, after) {
  if (after.degraded && !before.degraded) return 'degraded';
  if (after.flagged && !before.flagged) return 'flagged';
  if (after.passed && !before.passed) {
    if (!after.card) return 'passedNoCard';
    return after.card.cutoutUrl && validBox(after.card.cutoutBox) ? 'dissolve' : 'photo';
  }
  if (Number(after.tries) > Number(before.tries)) return 'retry';
  return null;
}

module.exports = { coverRect, boxToRect, fitRect, validBox, outcome };
