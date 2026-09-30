// 将全屏 camera 的 cover 预览坐标换算成原始照片坐标。
// 输出尺寸按 4 的倍数量化，保证导出的像素文件严格保持 4:5。
function frameCropRect(input) {
  const imageWidth = Number(input && input.imageWidth);
  const imageHeight = Number(input && input.imageHeight);
  const viewportWidth = Number(input && input.viewportWidth);
  const viewportHeight = Number(input && input.viewportHeight);
  const frameLeft = Number(input && input.frameLeft);
  const frameTop = Number(input && input.frameTop);
  const frameWidth = Number(input && input.frameWidth);
  const frameHeight = Number(input && input.frameHeight);

  if (![imageWidth, imageHeight, viewportWidth, viewportHeight, frameWidth, frameHeight].every(n => n > 0)
    || !Number.isFinite(frameLeft) || !Number.isFinite(frameTop)) {
    throw new Error('图片与取景框尺寸必须大于 0');
  }

  // camera 占满 .sc-live-cam；按 cover 映射时，原图较长的一边会溢出屏幕。
  const scale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;
  const offsetLeft = (viewportWidth - renderedWidth) / 2;
  const offsetTop = (viewportHeight - renderedHeight) / 2;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  let sourceX = clamp((frameLeft - offsetLeft) / scale, 0, imageWidth);
  let sourceY = clamp((frameTop - offsetTop) / scale, 0, imageHeight);
  const sourceRight = clamp((frameLeft + frameWidth - offsetLeft) / scale, 0, imageWidth);
  const sourceBottom = clamp((frameTop + frameHeight - offsetTop) / scale, 0, imageHeight);
  let sourceWidth = sourceRight - sourceX;
  let sourceHeight = sourceBottom - sourceY;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('取景框不在相机画面内');
  }

  // WXML 的像素取整可能让视觉 4:5 框差半个像素；裁切源区域也必须严格 4:5，不能把图轻微拉伸。
  const targetRatio = 4 / 5;
  if (sourceWidth / sourceHeight > targetRatio) {
    const adjustedWidth = sourceHeight * targetRatio;
    sourceX += (sourceWidth - adjustedWidth) / 2;
    sourceWidth = adjustedWidth;
  } else if (sourceWidth / sourceHeight < targetRatio) {
    const adjustedHeight = sourceWidth / targetRatio;
    sourceY += (sourceHeight - adjustedHeight) / 2;
    sourceHeight = adjustedHeight;
  }

  const outputWidth = Math.max(4, Math.floor(sourceWidth / 4) * 4);
  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight: outputWidth * 5 / 4
  };
}

function orientedImageSize(imageWidth, imageHeight, orientation) {
  if (![imageWidth, imageHeight].every(n => Number(n) > 0)) {
    throw new Error('图片尺寸必须大于 0');
  }
  const turnsSideways = orientation === 'left' || orientation === 'right'
    || orientation === 'left-mirrored' || orientation === 'right-mirrored';
  return turnsSideways
    ? { width: Number(imageHeight), height: Number(imageWidth) }
    : { width: Number(imageWidth), height: Number(imageHeight) };
}

// 将未旋转的原图绘制到“用户看到的方向”。wx.getImageInfo 的尺寸不考虑 EXIF 旋转。
function drawOrientedImage(ctx, image, orientation, imageWidth, imageHeight) {
  const width = Number(imageWidth), height = Number(imageHeight);
  switch (orientation) {
    case 'up-mirrored':
      ctx.translate(width, 0); ctx.scale(-1, 1);
      break;
    case 'down':
      ctx.translate(width, height); ctx.rotate(Math.PI);
      break;
    case 'down-mirrored':
      ctx.translate(0, height); ctx.scale(1, -1);
      break;
    case 'left-mirrored':
      ctx.rotate(Math.PI / 2); ctx.scale(1, -1);
      break;
    case 'right':
      ctx.translate(height, 0); ctx.rotate(Math.PI / 2);
      break;
    case 'right-mirrored':
      ctx.translate(height, width); ctx.rotate(-Math.PI / 2); ctx.scale(1, -1);
      break;
    case 'left':
      ctx.translate(0, width); ctx.rotate(-Math.PI / 2);
      break;
    default:
      break;
  }
  ctx.drawImage(image, 0, 0, width, height);
}

module.exports = { frameCropRect, orientedImageSize, drawOrientedImage };
