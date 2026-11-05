function renderCanvasLayers(ctx, layers) {
  layers
    .map((layer, index) => ({ ...layer, originalOrder: index }))
    .sort((a, b) => a.zIndex - b.zIndex || a.originalOrder - b.originalOrder)
    .forEach(layer => layer.draw());
}

function drawMaskedPhotoLayer(ctx, options) {
  const { width, height, image, x, y, drawWidth, drawHeight, rotation, masks, maskAnchorX = x, maskAnchorY = y } = options;
  const mask = masks?.find(item => item.enabled !== false);
  const transform = ctx.getTransform();
  ctx.save();
  if (mask) {
    const maskX = maskAnchorX + Number(mask.xPercent ?? 0) / 100 * width;
    const maskY = maskAnchorY + Number(mask.yPercent ?? 0) / 100 * height;
    const maskScale = Number(mask.scale ?? 1);
    const maskWidth = width * Number(mask.widthPercent ?? 30) / 100 * maskScale;
    const maskHeight = height * Number(mask.heightPercent ?? 30) / 100 * maskScale;

    ctx.translate(maskX, maskY);
    ctx.rotate(Number(mask.rotation || 0) * Math.PI / 180);
    ctx.beginPath();
    if (mask.shape === 'ellipse') {
      ctx.ellipse(0, 0, maskWidth / 2, maskHeight / 2, 0, 0, Math.PI * 2);
    } else if (mask.shape === 'diamond') {
      ctx.moveTo(0, -maskHeight / 2);
      ctx.lineTo(maskWidth / 2, 0);
      ctx.lineTo(0, maskHeight / 2);
      ctx.lineTo(-maskWidth / 2, 0);
      ctx.closePath();
    } else {
      ctx.rect(-maskWidth / 2, -maskHeight / 2, maskWidth, maskHeight);
    }
    ctx.clip();
  }

  ctx.setTransform(transform);
  ctx.translate(x, y);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
}
