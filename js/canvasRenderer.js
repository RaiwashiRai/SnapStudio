let userCapturedImage = null;
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

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      userCapturedImage = img;
      resetPhotoPlacement();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
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
  photoScale = parseFloat(val);
  redrawEditorCanvas();
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

  const button = document.getElementById('toggle-photo-pan');
  if (button) {
    button.setAttribute('aria-pressed', String(enabled));
    const label = document.getElementById('photo-pan-button-label');
    if (label) label.textContent = enabled ? 'Disable Pan' : 'Enable Pan';
  }

  const status = document.getElementById('photo-pan-status');
  if (status) {
    status.textContent = enabled
      ? 'Pan is on. Drag the photo on the canvas; tap Disable Pan to scroll the page there.'
      : 'Pan is off. Swipe the canvas to scroll, or enable pan to move the photo.';
  }
}

function resetPhotoZoom() {
  photoScale = 1.0;
  const scaleSlider = document.getElementById('slider-photo-scale');
  if (scaleSlider) scaleSlider.value = photoScale;
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
        if (!userCapturedImage) return;
        const fitScale = Math.min(W / userCapturedImage.width, H / userCapturedImage.height);
        const drawW = userCapturedImage.width * fitScale * photoScale;
        const drawH = userCapturedImage.height * fitScale * photoScale;
        drawMaskedPhotoLayer(editorCtx, {
          width: W,
          height: H,
          image: userCapturedImage,
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
    if (e.pointerType === 'touch' && !isPhotoPanModeEnabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    isDragging = true;
    activePointerId = e.pointerId;
    activePointerType = e.pointerType;
    const pos = getCoords(e);
    dragStartX = pos.x - photoX;
    dragStartY = pos.y - photoY;
    editorCanvas.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!isDragging || e.pointerId !== activePointerId) return;
    const pos = getCoords(e);
    photoX = pos.x - dragStartX;
    photoY = pos.y - dragStartY;
    redrawEditorCanvas();
    if (activePointerType === 'touch' && e.cancelable) e.preventDefault();
  }

  function onEnd(e) {
    if (!isDragging || (e && e.pointerId !== activePointerId)) return;
    isDragging = false;
    activePointerId = null;
    activePointerType = null;
  }

  editorCanvas.addEventListener('pointerdown', onStart);
  editorCanvas.addEventListener('pointermove', onMove);
  editorCanvas.addEventListener('pointerup', onEnd);
  editorCanvas.addEventListener('pointercancel', onEnd);
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