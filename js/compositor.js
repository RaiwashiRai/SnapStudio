function renderCanvasLayers(ctx, layers) {
  layers
    .map((layer, index) => ({ ...layer, originalOrder: index }))
    .sort((a, b) => a.zIndex - b.zIndex || a.originalOrder - b.originalOrder)
    .forEach(layer => layer.draw());
}

function drawMaskedPhotoLayer(ctx, options) {
  const { width, height, image, x, y, drawWidth, drawHeight, rotation, masks, maskAnchorX = x, maskAnchorY = y } = options;
  const photoCanvas = document.createElement('canvas');
  photoCanvas.width = width;
  photoCanvas.height = height;
  const photoCtx = photoCanvas.getContext('2d');
  if (!photoCtx) throw new Error('Unable to create photo mask canvas.');

  photoCtx.save();
  photoCtx.translate(x, y);
  photoCtx.rotate(rotation * Math.PI / 180);
  photoCtx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  photoCtx.restore();

  const mask = [...(masks || [])].find(item => item.enabled !== false);
  if (mask) {
    const maskX = maskAnchorX + Number(mask.xPercent ?? 0) / 100 * width;
    const maskY = maskAnchorY + Number(mask.yPercent ?? 0) / 100 * height;
    const maskScale = Number(mask.scale ?? 1);
    const maskWidth = width * Number(mask.widthPercent ?? 30) / 100 * maskScale;
    const maskHeight = height * Number(mask.heightPercent ?? 30) / 100 * maskScale;

    photoCtx.globalCompositeOperation = 'destination-in';
    photoCtx.translate(maskX, maskY);
    photoCtx.rotate(Number(mask.rotation || 0) * Math.PI / 180);
    photoCtx.beginPath();

    if (mask.shape === 'ellipse') {
      photoCtx.ellipse(0, 0, maskWidth / 2, maskHeight / 2, 0, 0, Math.PI * 2);
    } else if (mask.shape === 'diamond') {
      photoCtx.moveTo(0, -maskHeight / 2);
      photoCtx.lineTo(maskWidth / 2, 0);
      photoCtx.lineTo(0, maskHeight / 2);
      photoCtx.lineTo(-maskWidth / 2, 0);
      photoCtx.closePath();
    } else {
      photoCtx.rect(-maskWidth / 2, -maskHeight / 2, maskWidth, maskHeight);
    }

    photoCtx.fill();
  }
  ctx.drawImage(photoCanvas, 0, 0);
}
