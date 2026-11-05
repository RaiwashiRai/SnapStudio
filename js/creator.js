let creatorFrameImage = null;
let creatorFrameImageDataUrl = null;
let creatorPreviewPhoto = null;
let creatorPreviewPhotoSource = null;
let creatorBackgroundRemovedPhoto = null;
let creatorBackgroundRemovedPhotoUrl = null;
let creatorPhotoUploadToken = 0;
let creatorFrameUploadToken = 0;
let creatorCanvas, creatorCtx;

window.onload = function() {
  creatorCanvas = document.getElementById('creator-canvas');
  if (creatorCanvas) {
    creatorCtx = creatorCanvas.getContext('2d');
    syncCreatorCanvasToTemplateSize();
    syncAllCreatorInputs();
    redrawCreatorCanvas();
  }
  restoreCreatorDraft();
};

window.addEventListener('pagehide', saveCreatorDraft);

function getCreatorDraft() {
  const controls = Array.from(document.querySelectorAll('input, select, textarea'))
    .filter(control => control.id && control.type !== 'file')
    .map(control => ({
      id: control.id,
      value: control.value,
      checked: control.type === 'checkbox' ? control.checked : undefined
    }));

  return {
    controls,
    frameImageDataUrl: creatorFrameImageDataUrl,
    previewPhotoSource: creatorPreviewPhotoSource
  };
}

function saveCreatorDraft() {
  try {
    sessionStorage.setItem('snapstudio-creator-draft', JSON.stringify(getCreatorDraft()));
    return true;
  } catch (error) {
    console.error('Unable to save creator draft:', error);
    return false;
  }
}

function restoreCreatorDraft() {
  const savedDraft = sessionStorage.getItem('snapstudio-creator-draft');
  if (!savedDraft) return;

  let draft;
  try {
    draft = JSON.parse(savedDraft);
  } catch (error) {
    console.error('Unable to read creator draft:', error);
    sessionStorage.removeItem('snapstudio-creator-draft');
    showToast('Saved creator state could not be restored.');
    return;
  }
  if (!draft || typeof draft !== 'object') return;

  if (Array.isArray(draft.controls)) {
    draft.controls.forEach(({ id, value, checked }) => {
      const control = document.getElementById(id);
      if (!control || control.type === 'file') return;
      control.value = value;
      if (control.type === 'checkbox' && typeof checked === 'boolean') {
        control.checked = checked;
      }
    });
  }
  syncAllCreatorInputs();
  handleCreatorTextToggle(document.getElementById('creator-text-enabled').checked);

  if (typeof draft.frameImageDataUrl === 'string' && draft.frameImageDataUrl) {
    const uploadToken = creatorFrameUploadToken;
    const img = new Image();
    img.onload = () => {
      if (uploadToken !== creatorFrameUploadToken) return;
      creatorFrameImage = img;
      creatorFrameImageDataUrl = draft.frameImageDataUrl;
      creatorCanvas.width = img.naturalWidth || img.width;
      creatorCanvas.height = img.naturalHeight || img.height;
      syncCreatorCanvasToTemplateSize();
      redrawCreatorCanvas();
    };
    img.onerror = () => showToast('Unable to restore saved template artwork.');
    img.src = draft.frameImageDataUrl;
  }

  if (typeof draft.previewPhotoSource === 'string' && draft.previewPhotoSource) {
    const uploadToken = creatorPhotoUploadToken;
    const img = new Image();
    img.onload = () => {
      if (uploadToken !== creatorPhotoUploadToken) return;
      creatorPreviewPhoto = img;
      creatorPreviewPhotoSource = draft.previewPhotoSource;
      redrawCreatorCanvas();
      if (document.getElementById('background-removal-toggle').checked) {
        startCreatorBackgroundRemoval();
      }
    };
    img.onerror = () => showToast('Unable to restore saved preview photo.');
    img.src = draft.previewPhotoSource;
  }
}

function syncCreatorCanvasToTemplateSize() {
  const viewport = document.getElementById('creator-stage-viewport');
  if (viewport && creatorCanvas) {
    viewport.style.aspectRatio = `${creatorCanvas.width} / ${creatorCanvas.height}`;
  }
}

function syncCreatorSlider(id, val) {
  const numInput = document.getElementById('num-' + id);
  if (numInput) numInput.value = val;
  redrawCreatorCanvas();
}

function syncCreatorInput(id, val) {
  const slider = document.getElementById(id);
  if (slider) slider.value = val;
  redrawCreatorCanvas();
}

function resetCreatorControl(id, defaultVal) {
  const slider = document.getElementById(id);
  const numInput = document.getElementById('num-' + id);
  if (slider) slider.value = defaultVal;
  if (numInput) numInput.value = defaultVal;
  redrawCreatorCanvas();
}

function syncAllCreatorInputs() {
  ['anchor-x', 'anchor-y', 'text-x-percent', 'text-y-percent', 'preset-font-size'].forEach(id => {
    const slider = document.getElementById(id);
    const numInput = document.getElementById('num-' + id);
    if (slider && numInput) numInput.value = slider.value;
  });
}

function handleCreatorFrameUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const uploadToken = ++creatorFrameUploadToken;
  const reader = new FileReader();
  reader.onload = (event) => {
    if (uploadToken !== creatorFrameUploadToken) return;
    const imageDataUrl = event.target.result;
    if (typeof imageDataUrl !== 'string') {
      showToast('Unable to read template image');
      return;
    }

    const img = new Image();
    img.onload = () => {
      if (uploadToken !== creatorFrameUploadToken) return;
      creatorFrameImage = img;
      creatorFrameImageDataUrl = imageDataUrl;
      if (creatorCanvas) {
        creatorCanvas.width = img.naturalWidth || img.width;
        creatorCanvas.height = img.naturalHeight || img.height;
        syncCreatorCanvasToTemplateSize();
      }
      redrawCreatorCanvas();
    };
    img.onerror = () => showToast('Unable to load template image');
    img.src = imageDataUrl;
  };
  reader.onerror = () => showToast('Unable to read template image');
  reader.readAsDataURL(file);
}

function handleCreatorPhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const uploadToken = ++creatorPhotoUploadToken;
  cancelImageBackgroundRemoval();
  const reader = new FileReader();
  reader.onload = event => {
    if (uploadToken !== creatorPhotoUploadToken) return;
    const imageSource = event.target.result;
    const img = new Image();
    img.onload = () => {
      if (uploadToken !== creatorPhotoUploadToken) return;
      creatorPreviewPhoto = img;
      creatorPreviewPhotoSource = imageSource;
      clearCreatorBackgroundRemovedPhoto();
      redrawCreatorCanvas();
      if (document.getElementById('background-removal-toggle')?.checked) {
        startCreatorBackgroundRemoval();
      }
    };
    img.onerror = () => showToast('Unable to load preview photo');
    img.src = imageSource;
  };
  reader.onerror = () => showToast('Unable to read preview photo');
  reader.readAsDataURL(file);
}

function clearCreatorBackgroundRemovedPhoto() {
  if (creatorBackgroundRemovedPhotoUrl) URL.revokeObjectURL(creatorBackgroundRemovedPhotoUrl);
  creatorBackgroundRemovedPhoto = null;
  creatorBackgroundRemovedPhotoUrl = null;
}

function startCreatorBackgroundRemoval() {
  if (!creatorPreviewPhotoSource) return;
  const uploadToken = creatorPhotoUploadToken;
  const model = document.getElementById('background-model-selector').value;

  processImageBackgroundRemoval(creatorPreviewPhotoSource, model, blob => {
    const imageUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (uploadToken !== creatorPhotoUploadToken || !document.getElementById('background-removal-toggle').checked) {
        URL.revokeObjectURL(imageUrl);
        return;
      }
      clearCreatorBackgroundRemovedPhoto();
      creatorBackgroundRemovedPhoto = img;
      creatorBackgroundRemovedPhotoUrl = imageUrl;
      setBackgroundRemovalStatus('Background removed', 'success');
      redrawCreatorCanvas();
    };
    img.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      showToast('Unable to load processed preview photo');
    };
    img.src = imageUrl;
  }, (_error, message) => {
    clearCreatorBackgroundRemovedPhoto();
    document.getElementById('background-removal-toggle').checked = false;
    redrawCreatorCanvas();
    showToast(`${message} Original photo kept.`);
  });
}

function handleBackgroundRemovalToggle(enabled) {
  cancelImageBackgroundRemoval();
  if (enabled) {
    startCreatorBackgroundRemoval();
    return;
  }
  clearCreatorBackgroundRemovedPhoto();
  redrawCreatorCanvas();
}

function handleBackgroundModelChange() {
  if (document.getElementById('background-removal-toggle').checked) {
    startCreatorBackgroundRemoval();
  }
}

function handleCreatorTextToggle(enabled) {
  const controls = document.getElementById('creator-typography-controls');
  if (controls) {
    controls.hidden = !enabled;
    controls.classList.toggle('hidden', !enabled);
  }
  redrawCreatorCanvas();
}

function getCreatorMask() {
  return {
    enabled: document.getElementById('creator-mask-enabled').checked,
    shape: document.getElementById('creator-mask-shape').value,
    xPercent: Number(document.getElementById('creator-mask-x').value),
    yPercent: Number(document.getElementById('creator-mask-y').value),
    widthPercent: Number(document.getElementById('creator-mask-width').value),
    heightPercent: Number(document.getElementById('creator-mask-height').value),
    scale: Number(document.getElementById('creator-mask-scale').value),
    rotation: Number(document.getElementById('creator-mask-rotation').value)
  };
}

function redrawCreatorCanvas() {
  if (!creatorCtx || !creatorCanvas) return;

  const W = creatorCanvas.width;
  const H = creatorCanvas.height;
  creatorCtx.clearRect(0, 0, W, H);

  const mask = getCreatorMask();
  const layerZ = {
    photo: Number(document.getElementById('creator-photo-z').value),
    template: Number(document.getElementById('creator-template-z').value),
    text: Number(document.getElementById('creator-text-z').value)
  };
  const photo = creatorBackgroundRemovedPhoto || creatorPreviewPhoto;

  if (!creatorFrameImage && !creatorPreviewPhoto) {
    creatorCtx.fillStyle = '#1e293b';
    creatorCtx.fillRect(0, 0, W, H);
    creatorCtx.fillStyle = '#64748b';
    creatorCtx.font = '15px Inter, sans-serif';
    creatorCtx.textAlign = 'center';
    creatorCtx.fillText('Upload Template Artwork', W / 2, H / 2);
  }

  renderCanvasLayers(creatorCtx, [
    {
      zIndex: layerZ.photo,
      draw: () => {
        if (!photo) return;
        const fitScale = Math.min(W / photo.width, H / photo.height);
        const drawWidth = photo.width * fitScale;
        const drawHeight = photo.height * fitScale;
        const anchorX = W * Number(document.getElementById('anchor-x').value) / 100;
        const anchorY = H * Number(document.getElementById('anchor-y').value) / 100;
        drawMaskedPhotoLayer(creatorCtx, {
          width: W,
          height: H,
          image: photo,
          x: anchorX,
          y: anchorY,
          drawWidth,
          drawHeight,
          rotation: 0,
          maskAnchorX: anchorX,
          maskAnchorY: anchorY,
          masks: [mask]
        });
      }
    },
    {
      zIndex: layerZ.template,
      draw: () => {
        if (creatorFrameImage) creatorCtx.drawImage(creatorFrameImage, 0, 0, W, H);
      }
    },
    {
      zIndex: layerZ.text,
      draw: () => {
        if (document.getElementById('creator-text-enabled').checked) {
          drawCreatorText(W, H);
        }
      }
    }
  ]);

  if (mask.enabled && creatorPreviewPhoto) {
    drawCreatorMaskOutline(mask);
  }

  creatorCtx.save();
  creatorCtx.strokeStyle = '#3b82f6';
  creatorCtx.lineWidth = 3;
  const anchorX = W * Number(document.getElementById('anchor-x').value) / 100;
  const anchorY = H * Number(document.getElementById('anchor-y').value) / 100;
  creatorCtx.beginPath();
  creatorCtx.moveTo(anchorX - 20, anchorY);
  creatorCtx.lineTo(anchorX + 20, anchorY);
  creatorCtx.moveTo(anchorX, anchorY - 20);
  creatorCtx.lineTo(anchorX, anchorY + 20);
  creatorCtx.stroke();
  creatorCtx.restore();
}

function drawCreatorText(W, H) {
  const textXPct = Number(document.getElementById('text-x-percent').value);
  const textYPct = Number(document.getElementById('text-y-percent').value);
  const fontSize = Number(document.getElementById('preset-font-size').value);
  const textColor = document.getElementById('preset-text-color').value;
  const textVal = document.getElementById('preset-default-text').value;
  const fontFamily = document.getElementById('creator-font-family').value;
  const fontWeight = document.getElementById('creator-font-weight').value;
  const targetTextX = W * textXPct / 100;
  const targetTextY = H * textYPct / 100;

  creatorCtx.fillStyle = textColor;
  creatorCtx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
  creatorCtx.textAlign = 'center';
  creatorCtx.textBaseline = 'middle';
  creatorCtx.fillText(textVal, targetTextX, targetTextY);
}

function drawCreatorMaskOutline(mask) {
  if (!creatorPreviewPhoto || !mask.enabled) return;
  const W = creatorCanvas.width;
  const H = creatorCanvas.height;
  const fitScale = Math.min(W / creatorPreviewPhoto.width, H / creatorPreviewPhoto.height);
  const photoWidth = creatorPreviewPhoto.width * fitScale;
  const photoHeight = creatorPreviewPhoto.height * fitScale;
  const anchorX = W * Number(document.getElementById('anchor-x').value) / 100;
  const anchorY = H * Number(document.getElementById('anchor-y').value) / 100;
  const maskX = anchorX + mask.xPercent / 100 * W;
  const maskY = anchorY + mask.yPercent / 100 * H;
  const maskWidth = W * mask.widthPercent / 100 * mask.scale;
  const maskHeight = H * mask.heightPercent / 100 * mask.scale;

  creatorCtx.save();
  creatorCtx.translate(maskX, maskY);
  creatorCtx.rotate(mask.rotation * Math.PI / 180);
  creatorCtx.strokeStyle = '#fb7185';
  creatorCtx.lineWidth = Math.max(2, W / 400);
  creatorCtx.setLineDash([8, 6]);
  creatorCtx.beginPath();
  if (mask.shape === 'ellipse') {
    creatorCtx.ellipse(0, 0, maskWidth / 2, maskHeight / 2, 0, 0, Math.PI * 2);
  } else if (mask.shape === 'diamond') {
    creatorCtx.moveTo(0, -maskHeight / 2);
    creatorCtx.lineTo(maskWidth / 2, 0);
    creatorCtx.lineTo(0, maskHeight / 2);
    creatorCtx.lineTo(-maskWidth / 2, 0);
    creatorCtx.closePath();
  } else {
    creatorCtx.rect(-maskWidth / 2, -maskHeight / 2, maskWidth, maskHeight);
  }
  creatorCtx.stroke();
  creatorCtx.restore();
}

function generateCreatorPresetObject() {
  const presetId = document.getElementById('preset-id-input').value;
  return {
    id: presetId,
    title: presetId.replace(/_/g, ' ').toUpperCase(),
    frameColor: '#3b82f6',
    textColor: document.getElementById('preset-text-color').value,
    defaultText: document.getElementById('preset-default-text').value,
    textEnabled: document.getElementById('creator-text-enabled').checked,
    fontFamily: document.getElementById('creator-font-family').value,
    fontWeight: document.getElementById('creator-font-weight').value,
    textXPercent: parseInt(document.getElementById('text-x-percent').value),
    textYPercent: parseInt(document.getElementById('text-y-percent').value),
    fontSize: parseInt(document.getElementById('preset-font-size').value),
    anchorXPercent: parseInt(document.getElementById('anchor-x').value),
    anchorYPercent: parseInt(document.getElementById('anchor-y').value),
    masks: [getCreatorMask()],
    zIndex: {
      photo: Number(document.getElementById('creator-photo-z').value),
      template: Number(document.getElementById('creator-template-z').value),
      text: Number(document.getElementById('creator-text-z').value)
    },
    frameImageUrl: creatorFrameImageDataUrl || ""
  };
}

function exportCreatorPresetJSON() {
  const newPreset = generateCreatorPresetObject();
  const blob = new Blob([JSON.stringify(newPreset, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${newPreset.id}-preset.json`;
  a.click();
  showToast('Exported preset JSON file');
}

function useCreatorPresetInEditor() {
  if (!saveCreatorDraft()) {
    showToast('Unable to save creator state. Clear some browser storage and try again.');
    return;
  }

  try {
    sessionStorage.setItem('snapstudio-preset-for-editor', JSON.stringify(generateCreatorPresetObject()));
  } catch (error) {
    console.error('Unable to transfer preset to editor:', error);
    showToast('Unable to save this preset for the editor. The template image may be too large.');
    return;
  }

  window.location.href = './index.html';
}

function clearCreatorState() {
  creatorFrameUploadToken += 1;
  creatorPhotoUploadToken += 1;
  cancelImageBackgroundRemoval();
  clearCreatorBackgroundRemovedPhoto();
  creatorFrameImage = null;
  creatorFrameImageDataUrl = null;
  creatorPreviewPhoto = null;
  creatorPreviewPhotoSource = null;

  document.querySelectorAll('input, select, textarea').forEach(control => {
    if (control.type === 'file') {
      control.value = '';
    } else if (control.type === 'checkbox') {
      control.checked = control.defaultChecked;
    } else if (control.tagName === 'SELECT') {
      control.selectedIndex = Array.from(control.options).findIndex(option => option.defaultSelected);
      if (control.selectedIndex < 0) control.selectedIndex = 0;
    } else {
      control.value = control.defaultValue;
    }
  });

  if (creatorCanvas) {
    creatorCanvas.width = 800;
    creatorCanvas.height = 800;
  }
  syncCreatorCanvasToTemplateSize();
  syncAllCreatorInputs();
  handleCreatorTextToggle(document.getElementById('creator-text-enabled').checked);
  sessionStorage.removeItem('snapstudio-creator-draft');
  sessionStorage.removeItem('snapstudio-preset-for-editor');
  setBackgroundRemovalStatus('');
  redrawCreatorCanvas();
  showToast('Creator cleared.');
}