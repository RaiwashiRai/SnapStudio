let userCapturedImage = null;
let uploadedPhotoSource = null;
let backgroundRemovedPhoto = null;
let backgroundRemovedPhotoUrl = null;
let photoUploadToken = 0;
let activePresetFrameImg = null;

let photoX = 400;
let photoY = 400;
let photoScale = 1.0;

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let activePointerId = null;
let activePointerType = null;
let isPhotoPanModeEnabled = false;
const activeTouchPointers = new Map();
let activePinch = null;

let editorCanvas, editorCtx;
let presetLoadToken = 0;

window.addEventListener('DOMContentLoaded', async () => {
  editorCanvas = document.getElementById('editor-canvas');
  if (editorCanvas) {
    editorCtx = editorCanvas.getContext('2d');
    setupCanvasInteractions();
  }

  try {
    await loadPresetsFromFiles();
    populatePresetDropdown();
    applySelectedPreset(presets[0].id);
  } catch (error) {
    console.error('Failed to load presets:', error);
    const dropdown = document.getElementById('preset-selector');
    if (dropdown) {
      dropdown.innerHTML = '<option value="">Unable to load presets</option>';
      dropdown.disabled = true;
    }
    showToast('Unable to load presets. Serve the app over HTTP and check presets/manifest.json.');
  }
});

function populatePresetDropdown() {
  const dropdown = document.getElementById('preset-selector');
  if (!dropdown) return;
  dropdown.innerHTML = '';
  
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title || p.id;
    dropdown.appendChild(opt);
  });

  if (activePreset) {
    dropdown.value = activePreset.id;
  }
}

function applySelectedPreset(presetId) {
  activePreset = presets.find(p => p.id === presetId);
  if (!activePreset) return;
  const loadToken = ++presetLoadToken;
  const selectedPreset = activePreset;

  const selector = document.getElementById('preset-selector');
  if (selector) selector.value = activePreset.id;
  activePresetFrameImg = null;
  setEditorCanvasSize(800, 800);

  const textInput = document.getElementById('input-editor-text');
  if (textInput) {
    textInput.value = activePreset.defaultText || 'GUEST NAME';
    const fontSizeSlider = document.getElementById('slider-font-size');
    if (fontSizeSlider) fontSizeSlider.value = activePreset.fontSize || 32;
    const textColorPicker = document.getElementById('picker-text-color');
    if (textColorPicker) textColorPicker.value = activePreset.textColor || '#ffffff';
    const textXSlider = document.getElementById('slider-text-x');
    if (textXSlider) textXSlider.value = activePreset.textXPercent !== undefined ? activePreset.textXPercent : 50;
    const textYSlider = document.getElementById('slider-text-y');
    if (textYSlider) textYSlider.value = activePreset.textYPercent !== undefined ? activePreset.textYPercent : 88;
  }
  if (activePreset.frameImageUrl) {
    const frameImageUrls = activePreset.frameImageUrlCandidates || [activePreset.frameImageUrl];
    let imageUrlIndex = 0;
    const img = new Image();
    img.onload = () => {
      if (loadToken !== presetLoadToken) return;
      activePresetFrameImg = img;
      setEditorCanvasSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
      resetPhotoAnchor();
      redrawEditorCanvas();
    };
    img.onerror = () => {
      if (loadToken !== presetLoadToken) return;
      imageUrlIndex += 1;
      if (imageUrlIndex < frameImageUrls.length) {
        img.src = frameImageUrls[imageUrlIndex];
        return;
      }

      activePresetFrameImg = null;
      redrawEditorCanvas();
      console.error(`Unable to load template image for preset "${selectedPreset.id}":`, frameImageUrls);
      showToast(`Unable to load template for ${selectedPreset.title || selectedPreset.id}`);
    };
    img.src = frameImageUrls[imageUrlIndex];
  } else {
    activePresetFrameImg = null;
    resetPhotoAnchor();
    redrawEditorCanvas();
  }
}

function getEditorLayerZ() {
  return {
    photo: Number(activePreset.zIndex?.photo ?? 0),
    template: Number(activePreset.zIndex?.template ?? 2),
    text: Number(activePreset.zIndex?.text ?? 3)
  };
}

function resetPhotoAnchor() {
  if (!editorCanvas || !activePreset) return;
  photoX = editorCanvas.width * Number(activePreset.anchorXPercent ?? 50) / 100;
  photoY = editorCanvas.height * Number(activePreset.anchorYPercent ?? 45) / 100;
}

function setEditorCanvasSize(width, height) {
  const stageViewport = document.getElementById('editor-stage-viewport');
  if (editorCanvas) {
    editorCanvas.width = width;
    editorCanvas.height = height;
    if (stageViewport) {
      stageViewport.style.aspectRatio = `${width} / ${height}`;
    }
  }

  redrawEditorCanvas();
}

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const uploadToken = ++photoUploadToken;
  cancelImageBackgroundRemoval();
  const reader = new FileReader();
  reader.onload = (event) => {
    if (uploadToken !== photoUploadToken) return;
    const imageSource = event.target.result;
    const img = new Image();
    img.onload = () => {
      if (uploadToken !== photoUploadToken) return;
      userCapturedImage = img;
      uploadedPhotoSource = imageSource;
      clearBackgroundRemovedPhoto();
      resetPhotoPlacement();
      if (document.getElementById('background-removal-toggle')?.checked) {
        startPhotoBackgroundRemoval();
      }
    };
    img.onerror = () => showToast('Unable to load photo');
    img.src = imageSource;
  };
  reader.onerror = () => showToast('Unable to read photo');
  reader.readAsDataURL(file);
}

function clearBackgroundRemovedPhoto() {
  if (backgroundRemovedPhotoUrl) URL.revokeObjectURL(backgroundRemovedPhotoUrl);
  backgroundRemovedPhoto = null;
  backgroundRemovedPhotoUrl = null;
}

function startPhotoBackgroundRemoval() {
  if (!uploadedPhotoSource) return;
  const uploadToken = photoUploadToken;
  const model = document.getElementById('background-model-selector').value;

  processImageBackgroundRemoval(uploadedPhotoSource, model, blob => {
    const imageUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (uploadToken !== photoUploadToken || !document.getElementById('background-removal-toggle').checked) {
        URL.revokeObjectURL(imageUrl);
        return;
      }
      clearBackgroundRemovedPhoto();
      backgroundRemovedPhoto = img;
      backgroundRemovedPhotoUrl = imageUrl;
      setBackgroundRemovalStatus('Background removed');
      redrawEditorCanvas();
    };
    img.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      showToast('Unable to load processed photo');
    };
    img.src = imageUrl;
  }, () => {
    clearBackgroundRemovedPhoto();
    document.getElementById('background-removal-toggle').checked = false;
    redrawEditorCanvas();
    showToast('Background removal failed. Showing original photo.');
  });
}

function handleBackgroundRemovalToggle(enabled) {
  cancelImageBackgroundRemoval();
  if (enabled) {
    startPhotoBackgroundRemoval();
    return;
  }
  clearBackgroundRemovedPhoto();
  redrawEditorCanvas();
}

function handleBackgroundModelChange() {
  if (document.getElementById('background-removal-toggle').checked) {
    startPhotoBackgroundRemoval();
  }
}

function resetPhotoPlacement() {
  if (!editorCanvas) return;
  resetPhotoAnchor();
  photoScale = 1.0;
  setPhotoPanMode(false);

  const scaleSlider = document.getElementById('slider-photo-scale');
  if (scaleSlider) scaleSlider.value = 1.0;

  redrawEditorCanvas();
  showToast('Image loaded to Canvas Stage');
}

function updatePhotoScale(val) {
  setPhotoScale(parseFloat(val));
  redrawEditorCanvas();
}

function setPhotoScale(scale, anchor) {
  const nextScale = Math.min(3.5, Math.max(0.2, scale));
  if (anchor && photoScale !== 0) {
    const scaleRatio = nextScale / photoScale;
    photoX = anchor.x - (anchor.x - photoX) * scaleRatio;
    photoY = anchor.y - (anchor.y - photoY) * scaleRatio;
  }
  photoScale = nextScale;
  const scaleSlider = document.getElementById('slider-photo-scale');
  if (scaleSlider) scaleSlider.value = photoScale;
}

function togglePhotoPanMode() {
  if (!userCapturedImage) {
    showToast('Load a photo first');
    return;
  }

  setPhotoPanMode(!isPhotoPanModeEnabled);
}

function setPhotoPanMode(enabled) {
  isPhotoPanModeEnabled = enabled;
  if (editorCanvas) editorCanvas.classList.toggle('touch-pan-mode', enabled);
  if (!enabled) {
    isDragging = false;
    activePointerId = null;
    activePointerType = null;
    activeTouchPointers.clear();
    activePinch = null;
  }

  const button = document.getElementById('toggle-photo-pan');
  if (button) {
    button.setAttribute('aria-pressed', String(enabled));
    const label = document.getElementById('photo-pan-button-label');
    if (label) label.textContent = enabled ? 'Disable Pan & Zoom' : 'Enable Pan & Zoom';
  }

  const status = document.getElementById('photo-pan-status');
  if (status) {
    status.textContent = enabled
      ? 'Pan and zoom are on. Drag to move, scroll to zoom on desktop, or pinch to zoom on mobile.'
      : 'Pan and zoom are off. Enable them to drag, scroll to zoom, or pinch to zoom.';
  }
}

function resetPhotoZoom() {
  setPhotoScale(1.0);
  redrawEditorCanvas();
}

function redrawEditorCanvas() {
  if (!editorCanvas) {
    editorCanvas = document.getElementById('editor-canvas');
  }
  if (!editorCanvas) return;
  if (!editorCtx) {
    editorCtx = editorCanvas.getContext('2d');
  }
  if (!editorCtx) return;

  if (!activePreset) {
    if (presets && presets.length > 0) {
      activePreset = presets[0];
    }
  }
  if (!activePreset) return;

  const W = editorCanvas.width;
  const H = editorCanvas.height;
  editorCtx.clearRect(0, 0, W, H);

  const textInput = document.getElementById('input-editor-text');
  const textXSlider = document.getElementById('slider-text-x');
  const textYSlider = document.getElementById('slider-text-y');
  const fontSizeSlider = document.getElementById('slider-font-size');
  const textColorPicker = document.getElementById('picker-text-color');

  const textVal = textInput ? textInput.value : (activePreset.defaultText || 'GUEST NAME');
  const textX = textXSlider ? W * parseInt(textXSlider.value) / 100 : W * (activePreset.textXPercent || 50) / 100;
  const textY = textYSlider ? H * parseInt(textYSlider.value) / 100 : H * (activePreset.textYPercent || 88) / 100;
  const fontSize = fontSizeSlider ? parseInt(fontSizeSlider.value) : (activePreset.fontSize || 32);
  const textColor = textColorPicker ? textColorPicker.value : (activePreset.textColor || '#ffffff');

  const fontFamily = activePreset.fontFamily || 'Inter';
  const fontWeight = activePreset.fontWeight || 'bold';

  const layerZ = getEditorLayerZ();
  renderCanvasLayers(editorCtx, [
    {
      zIndex: layerZ.photo,
      draw: () => {
        const photo = backgroundRemovedPhoto || userCapturedImage;
        if (!photo) return;
        const fitScale = Math.min(W / photo.width, H / photo.height);
        const drawW = photo.width * fitScale * photoScale;
        const drawH = photo.height * fitScale * photoScale;
        drawMaskedPhotoLayer(editorCtx, {
          width: W,
          height: H,
          image: photo,
          x: photoX,
          y: photoY,
          drawWidth: drawW,
          drawHeight: drawH,
          rotation: 0,
          maskAnchorX: W * Number(activePreset.anchorXPercent ?? 50) / 100,
          maskAnchorY: H * Number(activePreset.anchorYPercent ?? 45) / 100,
          masks: activePreset.masks || []
        });
      }
    },
    {
      zIndex: layerZ.template,
      draw: () => {
        if (activePresetFrameImg) editorCtx.drawImage(activePresetFrameImg, 0, 0, W, H);
        else drawFallbackFrameArtwork(editorCtx, W, H);
      }
    },
    {
      zIndex: layerZ.text,
      draw: () => {
        editorCtx.save();
        editorCtx.fillStyle = textColor;
        editorCtx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
        editorCtx.textAlign = 'center';
        editorCtx.textBaseline = 'middle';
        editorCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        editorCtx.lineWidth = Math.max(2, fontSize / 12);
        editorCtx.strokeText(textVal, textX, textY);
        editorCtx.fillText(textVal, textX, textY);
        editorCtx.restore();
      }
    }
  ]);
}

function drawFallbackFrameArtwork(ctx, W, H) {
  if (activePreset && activePreset.id === 'classic_polaroid') {
    ctx.fillStyle = activePreset.frameColor || '#f8fafc';
    ctx.fillRect(0, 0, W, 40);
    ctx.fillRect(0, 0, 40, H);
    ctx.fillRect(W - 40, 0, 40, H);
    ctx.fillRect(0, H - 130, W, 130);
  } else {
    ctx.strokeStyle = activePreset ? activePreset.frameColor : '#3b82f6';
    ctx.lineWidth = 16;
    ctx.strokeRect(16, 16, W - 32, H - 32);

    ctx.fillStyle = activePreset ? activePreset.frameColor : '#3b82f6';
    ctx.fillRect(W / 2 - 140, 16, 280, 42);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('OFFICIAL EVENT BADGE', W / 2, 43);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(16, H - 120, W - 32, 104);
  }
}

function setupCanvasInteractions() {
  function getCoords(e) {
    const rect = editorCanvas.getBoundingClientRect();
    const scaleX = editorCanvas.width / rect.width;
    const scaleY = editorCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function onStart(e) {
    if (!userCapturedImage) return;
    if (!isPhotoPanModeEnabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const pos = getCoords(e);
    if (e.pointerType === 'touch') {
      if (activeTouchPointers.size >= 2) return;
      activeTouchPointers.set(e.pointerId, pos);
      if (activeTouchPointers.size >= 2) {
        editorCanvas.setPointerCapture(e.pointerId);
        const [first, second] = Array.from(activeTouchPointers.values()).slice(0, 2);
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        activePinch = {
          startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          startScale: photoScale,
          anchorX: (midpoint.x - photoX) / photoScale,
          anchorY: (midpoint.y - photoY) / photoScale
        };
        isDragging = false;
        activePointerId = null;
        activePointerType = null;
        return;
      }
    }

    isDragging = true;
    activePointerId = e.pointerId;
    activePointerType = e.pointerType;
    dragStartX = pos.x - photoX;
    dragStartY = pos.y - photoY;
    editorCanvas.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    const pos = getCoords(e);
    if (e.pointerType === 'touch' && activeTouchPointers.has(e.pointerId)) {
      activeTouchPointers.set(e.pointerId, pos);
    }

    if (activePinch && activeTouchPointers.size >= 2) {
      const [first, second] = Array.from(activeTouchPointers.values()).slice(0, 2);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const scale = activePinch.startScale * distance / activePinch.startDistance;
      setPhotoScale(scale);
      photoX = midpoint.x - activePinch.anchorX * photoScale;
      photoY = midpoint.y - activePinch.anchorY * photoScale;
      redrawEditorCanvas();
      if (e.cancelable) e.preventDefault();
      return;
    }

    if (!isDragging || e.pointerId !== activePointerId) return;
    photoX = pos.x - dragStartX;
    photoY = pos.y - dragStartY;
    redrawEditorCanvas();
    if (activePointerType === 'touch' && e.cancelable) e.preventDefault();
  }

  function onEnd(e) {
    if (e.pointerType === 'touch' && activeTouchPointers.has(e.pointerId)) {
      activeTouchPointers.delete(e.pointerId);
      activePinch = null;
      if (activeTouchPointers.size === 1 && isPhotoPanModeEnabled) {
        const [pointerId, pos] = activeTouchPointers.entries().next().value;
        isDragging = true;
        activePointerId = pointerId;
        activePointerType = 'touch';
        dragStartX = pos.x - photoX;
        dragStartY = pos.y - photoY;
        return;
      }
    }

    if (e.pointerId === activePointerId) {
      isDragging = false;
      activePointerId = null;
      activePointerType = null;
    }
  }

  function onWheel(e) {
    if (!isPhotoPanModeEnabled || !userCapturedImage) return;
    if (e.cancelable) e.preventDefault();
    setPhotoScale(photoScale * Math.exp(-e.deltaY * 0.001), getCoords(e));
    redrawEditorCanvas();
  }

  editorCanvas.addEventListener('pointerdown', onStart);
  editorCanvas.addEventListener('pointermove', onMove);
  editorCanvas.addEventListener('pointerup', onEnd);
  editorCanvas.addEventListener('pointercancel', onEnd);
  editorCanvas.addEventListener('wheel', onWheel, { passive: false });
}

function downloadCanvasComposite() {
  if (!userCapturedImage) {
    showToast('Load a photo first');
    return;
  }

  try {
    editorCanvas.toBlob(blob => {
      if (!blob) {
        console.error('Unable to encode the canvas as a PNG.');
        showToast('Unable to create PNG. Please try again.');
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `SnapStudio_Export_${Date.now()}.png`;
      link.href = objectUrl;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      showToast('PNG image downloaded');
    }, 'image/png');
  } catch (error) {
    console.error('Failed to export the canvas as a PNG:', error);
    showToast('Unable to download PNG. Please try again.');
  }
}