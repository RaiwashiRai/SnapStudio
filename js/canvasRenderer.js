let userCapturedImage = null;
let userCapturedImagePreview = null;
let uploadedPhotoSource = null;
let uploadedPhotoObjectUrl = null;
let backgroundRemovedPhoto = null;
let backgroundRemovedPhotoPreview = null;
let backgroundRemovedPhotoUrl = null;
let photoUploadToken = 0;
let activePresetFrameImg = null;
let activePresetFramePreviewImg = null;
let isCompositeExportInProgress = false;

const MAX_EDITOR_PREVIEW_EDGE = 1280;
const MAX_EDITOR_PREVIEW_PIXELS = 1200000;
const MAX_EXPORT_EDGE = 8192;
const MAX_EXPORT_PIXELS = 24000000;

let photoX = 400;
let photoY = 400;
let photoScale = 1.0;
let photoRotation = 0;
let isBackgroundRemovalEnabled = false;
let skipEditorPopConfirmation = false;

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let activePointerId = null;
let activePointerType = null;
let isPhotoPanModeEnabled = false;
let isPhotoRotateModeEnabled = false;
let activeRotateGesture = null;
const activeTouchPointers = new Map();
let activePinch = null;

let editorCanvas, editorCtx;
let presetLoadToken = 0;
let editorTextEnabled = true;
let selectedTemplateId = null;
let selectedTemplatePromise = Promise.resolve(true);

window.addEventListener('DOMContentLoaded', async () => {
  const setupUrl = new URL(window.location.href);
  setupUrl.hash = '';
  history.replaceState({ snapStudioView: 'selection' }, '', setupUrl);

  editorCanvas = document.getElementById('editor-canvas');
  if (editorCanvas) {
    editorCtx = editorCanvas.getContext('2d');
    setupCanvasInteractions();
  }

  try {
    await loadPresetsFromFiles();
    const transferredPreset = sessionStorage.getItem('snapstudio-preset-for-editor');
    if (transferredPreset) {
      sessionStorage.removeItem('snapstudio-preset-for-editor');
      try {
        await addEditorPreset(JSON.parse(transferredPreset));
      } catch (error) {
        console.error('Unable to load transferred preset:', error);
        showToast('Unable to read the creator preset. Check its JSON and try again.');
      }
    }
    renderPresetTemplates();
    syncEditorCanvasViewport();
  } catch (error) {
    console.error('Failed to load presets:', error);
    const templateList = document.getElementById('preset-templates');
    if (templateList) {
      templateList.textContent = 'Unable to load templates. Serve the app over HTTP and check presets/manifest.json.';
    }
    showToast('Unable to load presets. Serve the app over HTTP and check presets/manifest.json.');
  }
});

window.addEventListener('popstate', handleEditorHistoryNavigation);
window.addEventListener('beforeunload', confirmEditorExit);

async function addEditorPreset(preset) {
  if (!preset || typeof preset !== 'object' || Array.isArray(preset) || typeof preset.id !== 'string' || !preset.id.trim()) {
    throw new Error('Preset must be an object with a non-empty id.');
  }
  if (preset.frameImageUrl !== undefined && typeof preset.frameImageUrl !== 'string') {
    throw new Error('Preset frameImageUrl must be a string.');
  }
  if (/^data:image\//i.test(preset.frameImageUrl || '')) {
    const response = await fetch(preset.frameImageUrl);
    if (!response.ok) throw new Error(`Unable to prepare preset artwork (${response.status}).`);
    const imageUrl = URL.createObjectURL(await response.blob());
    preset.frameImageUrl = imageUrl;
    preset.frameImageUrlCandidates = [imageUrl];
  }

  const existingIndex = presets.findIndex(item => item.id === preset.id);
  if (existingIndex >= 0) {
    const [existingPreset] = presets.splice(existingIndex, 1);
    (existingPreset.frameImageUrlCandidates || [existingPreset.frameImageUrl]).forEach(url => {
      if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    if (existingPreset.generatedThumbnailUrl) URL.revokeObjectURL(existingPreset.generatedThumbnailUrl);
  }
  presets.push(preset);
  activePreset = preset;
}

async function handlePresetJsonUpload(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const preset = JSON.parse(await file.text());
    await addEditorPreset(preset);
    renderPresetTemplates();
    selectPresetTemplate(preset.id);
    showToast(`Loaded preset: ${preset.title || preset.id}`);
  } catch (error) {
    console.error('Unable to load preset JSON:', error);
    showToast(error instanceof SyntaxError
      ? 'Preset file is not valid JSON.'
      : `Unable to load preset: ${error.message}`);
  } finally {
    input.value = '';
  }
}

async function createPresetThumbnailUrl(image) {
  const dimensions = getScaledDimensions(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    360,
    129600
  );
  const preview = await createPreviewImage(image, dimensions.width, dimensions.height);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) {
    releasePreviewImage(preview, image);
    throw new Error('Unable to prepare a preset thumbnail.');
  }
  context.drawImage(preview, 0, 0);
  releasePreviewImage(preview, image);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.78));
  if (!blob) throw new Error('Unable to encode a preset thumbnail.');
  return URL.createObjectURL(blob);
}

function renderPresetTemplates() {
  const templateList = document.getElementById('preset-templates');
  if (!templateList) return;
  templateList.replaceChildren();

  presets.forEach(p => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'template-choice';
    button.setAttribute('aria-pressed', String(p.id === selectedTemplateId));
    button.setAttribute('aria-label', `Select ${p.title || p.id}`);
    button.addEventListener('click', () => selectPresetTemplate(p.id));

    const preview = document.createElement('span');
    preview.className = 'template-choice-preview checkerboard';
    if (p.frameImageUrl) {
      const thumbnailLoader = document.createElement('span');
      thumbnailLoader.className = 'template-thumbnail-loading';
      thumbnailLoader.setAttribute('aria-hidden', 'true');
      preview.appendChild(thumbnailLoader);

      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.dataset.presetId = p.id;
      image.onload = () => {
        thumbnailLoader.remove();
        if (p.thumbnailUrl || p.generatedThumbnailUrl || p.thumbnailPromise) return;
        p.thumbnailPromise = createPresetThumbnailUrl(image).then(url => {
          p.generatedThumbnailUrl = url;
          templateList.querySelectorAll('img[data-preset-id]').forEach(thumbnail => {
            if (thumbnail.dataset.presetId === p.id) thumbnail.src = url;
          });
        }).catch(error => {
          console.warn(`Unable to generate a thumbnail for preset "${p.id}":`, error);
        }).finally(() => {
          p.thumbnailPromise = null;
        });
      };
      image.onerror = () => {
        const nextUrl = p.frameImageUrlCandidates?.find(url => url !== image.src);
        if (nextUrl) {
          image.src = nextUrl;
          return;
        }
        thumbnailLoader.remove();
        image.remove();
      };
      image.src = p.thumbnailUrl || p.generatedThumbnailUrl || p.frameImageUrlCandidates?.[0] || p.frameImageUrl;
      preview.appendChild(image);
    } else {
      preview.style.setProperty('--template-color', p.frameColor || '#64748b');
      preview.classList.add('template-choice-fallback');
    }

    const title = document.createElement('span');
    title.className = 'template-choice-title';
    title.textContent = p.title || p.id;
    button.append(preview, title);
    templateList.appendChild(button);
  });
}

function applySelectedPreset(presetId) {
  activePreset = presets.find(p => p.id === presetId);
  if (!activePreset) return Promise.resolve(false);
  const loadToken = ++presetLoadToken;
  const selectedPreset = activePreset;

  const templateTitle = document.getElementById('editor-template-title');
  if (templateTitle) templateTitle.textContent = activePreset.title || activePreset.id;
  const nameTool = document.getElementById('tool-name-button');
  if (nameTool) nameTool.hidden = activePreset.textEnabled === false;
  updateEditorTextControls();
  releasePreviewImage(activePresetFramePreviewImg, activePresetFrameImg);
  activePresetFrameImg = null;
  activePresetFramePreviewImg = null;
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
    return new Promise(resolve => {
      img.onload = () => {
        if (loadToken !== presetLoadToken) return resolve(false);
        activePresetFrameImg = img;
        const dimensions = getScaledDimensions(
          img.naturalWidth || img.width,
          img.naturalHeight || img.height,
          MAX_EDITOR_PREVIEW_EDGE,
          MAX_EDITOR_PREVIEW_PIXELS
        );
        setEditorCanvasSize(dimensions.width, dimensions.height);
        createPreviewImage(img, dimensions.width, dimensions.height).then(preview => {
          if (loadToken !== presetLoadToken) {
            releasePreviewImage(preview, img);
            return resolve(false);
          }
          activePresetFramePreviewImg = preview;
          resetPhotoAnchor();
          redrawEditorCanvas();
          resolve(true);
        }).catch(error => {
          if (loadToken !== presetLoadToken) return resolve(false);
          console.error(`Unable to create a template preview for preset "${selectedPreset.id}":`, error);
          activePresetFrameImg = null;
          setEditorCanvasSize(800, 800);
          showToast('Unable to prepare this template preview. Try another template.');
          resolve(false);
        });
      };
      img.onerror = () => {
        if (loadToken !== presetLoadToken) return resolve(false);
        imageUrlIndex += 1;
        if (imageUrlIndex < frameImageUrls.length) {
          img.src = frameImageUrls[imageUrlIndex];
          return;
        }

        activePresetFrameImg = null;
        activePresetFramePreviewImg = null;
        redrawEditorCanvas();
        console.error(`Unable to load template image for preset "${selectedPreset.id}":`, frameImageUrls);
        showToast(`Unable to load template for ${selectedPreset.title || selectedPreset.id}`);
        resolve(false);
      };
      img.src = frameImageUrls[imageUrlIndex];
    });
  } else {
    activePresetFrameImg = null;
    resetPhotoAnchor();
    redrawEditorCanvas();
    return Promise.resolve(true);
  }
}

function selectPresetTemplate(presetId) {
  selectedTemplateId = presetId;
  renderPresetTemplates();
  selectedTemplatePromise = applySelectedPreset(presetId);
  refreshSelectionState();
}

function refreshSelectionState() {
  const confirmButton = document.getElementById('start-editing-button');
  if (confirmButton) {
    confirmButton.disabled = !(userCapturedImage && userCapturedImagePreview && uploadedPhotoSource && selectedTemplateId);
  }
}

async function beginEditing() {
  if (!userCapturedImage || !userCapturedImagePreview || !uploadedPhotoSource) {
    showToast('Upload or take a photo before continuing.');
    document.getElementById('photo-upload-actions')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!selectedTemplateId) {
    showToast('Choose a template before continuing.');
    document.getElementById('preset-templates')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const selectedId = selectedTemplateId;
  const templateReady = await selectedTemplatePromise;
  if (!templateReady || selectedId !== selectedTemplateId) return;
  history.pushState({ snapStudioView: 'editor' }, '', `${window.location.pathname}${window.location.search}#editor`);
  document.getElementById('setup-flow').hidden = true;
  document.getElementById('editor-workspace').hidden = false;
  syncEditorCanvasViewport();
  redrawEditorCanvas();
}

function returnToSelection() {
  if (!window.confirm('Do you wish to leave the editor and return to photo selection?')) return;
  if (history.state?.snapStudioView === 'editor') {
    skipEditorPopConfirmation = true;
    history.back();
    return;
  }
  showSelectionWorkspace();
}

function showSelectionWorkspace() {
  document.getElementById('editor-workspace').hidden = true;
  document.getElementById('setup-flow').hidden = false;
  document.querySelectorAll('.tool-popover').forEach(panel => { panel.hidden = true; });
  document.querySelectorAll('button[aria-controls]').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
  });
  setPhotoPanMode(false);
  setPhotoRotateMode(false);
}

function showEditorWorkspace() {
  document.getElementById('setup-flow').hidden = true;
  document.getElementById('editor-workspace').hidden = false;
  syncEditorCanvasViewport();
  redrawEditorCanvas();
}

function handleEditorHistoryNavigation(event) {
  if (event.state?.snapStudioView === 'editor') {
    showEditorWorkspace();
    return;
  }

  const editorWorkspace = document.getElementById('editor-workspace');
  if (editorWorkspace && !editorWorkspace.hidden && !skipEditorPopConfirmation) {
    if (!window.confirm('Do you wish to leave the editor and return to photo selection?')) {
      history.pushState({ snapStudioView: 'editor' }, '', `${window.location.pathname}${window.location.search}#editor`);
      return;
    }
  }

  skipEditorPopConfirmation = false;
  showSelectionWorkspace();
}

function confirmEditorExit(event) {
  const editorWorkspace = document.getElementById('editor-workspace');
  if (!editorWorkspace || editorWorkspace.hidden) return;
  event.preventDefault();
  event.returnValue = '';
}

function toggleEditorPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const shouldOpen = panel.hidden;
  document.querySelectorAll('.tool-popover').forEach(item => {
    if (item !== panel && !item.hidden) disableEditorPanelMode(item.id);
    item.hidden = true;
  });
  document.querySelectorAll('button[aria-controls]').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
  });
  if (!shouldOpen) {
    disableEditorPanelMode(panelId);
    return;
  }
  panel.hidden = false;
  const button = document.querySelector(`button[aria-controls="${panelId}"]`);
  if (button) button.setAttribute('aria-expanded', 'true');
}

function disableEditorPanelMode(panelId) {
  if (panelId === 'pan-tools') setPhotoPanMode(false);
  if (panelId === 'rotate-tools') setPhotoRotateMode(false);
}

function toggleEditorToolMode(panelId, mode) {
  if (!userCapturedImage) {
    showToast('Load a photo first');
    return;
  }
  const isEnabled = mode === 'pan' ? isPhotoPanModeEnabled : isPhotoRotateModeEnabled;
  if (isEnabled) {
    disableEditorPanelMode(panelId);
    if (!document.getElementById(panelId).hidden) toggleEditorPanel(panelId);
    return;
  }
  if (document.getElementById(panelId).hidden) toggleEditorPanel(panelId);
  if (mode === 'pan') setPhotoPanMode(true);
  else setPhotoRotateMode(true);
}

function syncEditorCanvasViewport() {
  if (!editorCanvas) return;
  const stageViewport = document.getElementById('editor-stage-viewport');
  if (!stageViewport) return;
  const ratio = editorCanvas.width / editorCanvas.height;
  const maxWidth = Math.min(stageViewport.parentElement.clientWidth || 900, 900);
  const maxHeight = Math.min(window.innerHeight * 0.68, 760);
  stageViewport.style.width = `${Math.max(1, Math.min(maxWidth, maxHeight * ratio))}px`;
  stageViewport.style.aspectRatio = `${editorCanvas.width} / ${editorCanvas.height}`;
}

function getScaledDimensions(width, height, maxEdge, maxPixels) {
  const scale = Math.min(
    1,
    maxEdge / Math.max(width, height),
    Math.sqrt(maxPixels / (width * height))
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

async function createPreviewImage(image, width, height) {
  if (image.width === width && image.height === height) return image;

  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(image, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'medium'
      });
    } catch (error) {
      console.warn('Unable to resize image with createImageBitmap; using a canvas preview:', error);
    }
  }

  const preview = document.createElement('canvas');
  preview.width = width;
  preview.height = height;
  const context = preview.getContext('2d');
  if (!context) throw new Error('Unable to create a low-resolution preview.');
  context.drawImage(image, 0, 0, width, height);
  return preview;
}

function releasePreviewImage(preview, original) {
  if (preview && preview !== original && typeof preview.close === 'function') {
    preview.close();
  }
}

function getEditorLayerZ(preset = activePreset) {
  return {
    photo: Number(preset.zIndex?.photo ?? 0),
    template: Number(preset.zIndex?.template ?? 2),
    text: Number(preset.zIndex?.text ?? 3)
  };
}

function updateEditorTextControls() {
  const controls = document.getElementById('editor-text-controls');
  const toggle = document.getElementById('editor-text-enabled');
  editorTextEnabled = activePreset?.textEnabled !== false;
  if (toggle) toggle.checked = editorTextEnabled;
  if (controls) {
    controls.hidden = !editorTextEnabled;
    controls.classList.toggle('hidden', !editorTextEnabled);
  }
}

function handleEditorTextToggle(enabled) {
  editorTextEnabled = enabled;
  const toggle = document.getElementById('editor-text-enabled');
  if (toggle) toggle.checked = enabled;
  const controls = document.getElementById('editor-text-controls');
  if (controls) {
    controls.hidden = !enabled;
    controls.classList.toggle('hidden', !enabled);
  }
  redrawEditorCanvas();
}

function resetPhotoAnchor() {
  if (!editorCanvas || !activePreset) return;
  photoX = editorCanvas.width * Number(activePreset.anchorXPercent ?? 50) / 100;
  photoY = editorCanvas.height * Number(activePreset.anchorYPercent ?? 45) / 100;
}

function setEditorCanvasSize(width, height) {
  if (editorCanvas) {
    editorCanvas.width = width;
    editorCanvas.height = height;
    syncEditorCanvasViewport();
  }

  redrawEditorCanvas();
}

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const uploadToken = ++photoUploadToken;
  cancelImageBackgroundRemoval();
  const imageUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (uploadToken !== photoUploadToken) {
      URL.revokeObjectURL(imageUrl);
      return;
    }
    releasePreviewImage(userCapturedImagePreview, userCapturedImage);
    if (uploadedPhotoObjectUrl) URL.revokeObjectURL(uploadedPhotoObjectUrl);
    userCapturedImage = img;
    userCapturedImagePreview = null;
    uploadedPhotoSource = file;
    uploadedPhotoObjectUrl = imageUrl;
    updatePhotoSelectionPreview(imageUrl);
    clearBackgroundRemovedPhoto();
    resetPhotoPlacement();
    refreshSelectionState();
    const dimensions = getScaledDimensions(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      MAX_EDITOR_PREVIEW_EDGE,
      MAX_EDITOR_PREVIEW_PIXELS
    );
    createPreviewImage(img, dimensions.width, dimensions.height).then(preview => {
      if (uploadToken !== photoUploadToken) {
        releasePreviewImage(preview, img);
        return;
      }
      userCapturedImagePreview = preview;
      redrawEditorCanvas();
      refreshSelectionState();
    }).catch(error => {
      console.error('Unable to create a low-resolution photo preview:', error);
      refreshSelectionState();
      showToast('Unable to prepare a photo preview. Try a smaller image.');
    });
    if (isBackgroundRemovalEnabled) {
      startPhotoBackgroundRemoval();
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(imageUrl);
    showToast('Unable to load photo');
  };
  img.src = imageUrl;
}

function updatePhotoSelectionPreview(imageSource) {
  const preview = document.getElementById('selected-photo-preview');
  const image = document.getElementById('selected-photo-thumbnail');
  if (!preview || !image) return;
  image.src = imageSource;
  preview.hidden = false;
  refreshSelectionState();
}

function removeSelectedPhoto() {
  photoUploadToken += 1;
  cancelImageBackgroundRemoval();
  clearBackgroundRemovedPhoto();
  releasePreviewImage(userCapturedImagePreview, userCapturedImage);
  if (uploadedPhotoObjectUrl) URL.revokeObjectURL(uploadedPhotoObjectUrl);
  userCapturedImage = null;
  userCapturedImagePreview = null;
  uploadedPhotoSource = null;
  uploadedPhotoObjectUrl = null;
  ['photo-upload-file', 'photo-camera-file'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const preview = document.getElementById('selected-photo-preview');
  const image = document.getElementById('selected-photo-thumbnail');
  if (image) image.removeAttribute('src');
  if (preview) preview.hidden = true;
  refreshSelectionState();
  redrawEditorCanvas();
}

function clearBackgroundRemovedPhoto() {
  if (backgroundRemovedPhotoUrl) URL.revokeObjectURL(backgroundRemovedPhotoUrl);
  releasePreviewImage(backgroundRemovedPhotoPreview, backgroundRemovedPhoto);
  backgroundRemovedPhoto = null;
  backgroundRemovedPhotoPreview = null;
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
      if (uploadToken !== photoUploadToken || !isBackgroundRemovalEnabled) {
        URL.revokeObjectURL(imageUrl);
        return;
      }
      clearBackgroundRemovedPhoto();
      backgroundRemovedPhoto = img;
      backgroundRemovedPhotoUrl = imageUrl;
      const dimensions = getScaledDimensions(
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        MAX_EDITOR_PREVIEW_EDGE,
        MAX_EDITOR_PREVIEW_PIXELS
      );
      createPreviewImage(img, dimensions.width, dimensions.height).then(preview => {
        if (uploadToken !== photoUploadToken || !isBackgroundRemovalEnabled || backgroundRemovedPhoto !== img) {
          releasePreviewImage(preview, img);
          return;
        }
        backgroundRemovedPhotoPreview = preview;
        setBackgroundRemovalStatus('Background removed', 'success');
        redrawEditorCanvas();
      }).catch(error => {
        console.error('Unable to create a background-removal preview:', error);
        setBackgroundRemovalStatus('Background removed. Preview is using the original photo.', 'success');
        redrawEditorCanvas();
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      showToast('Unable to load processed photo');
    };
    img.src = imageUrl;
  }, (_error, message) => {
    clearBackgroundRemovedPhoto();
    isBackgroundRemovalEnabled = false;
    syncBackgroundRemovalButton();
    redrawEditorCanvas();
    showToast(`${message} Original photo kept.`);
  });
}

function handleBackgroundRemovalToggle(enabled) {
  isBackgroundRemovalEnabled = enabled;
  syncBackgroundRemovalButton();
  const selectionToggle = document.getElementById('selection-background-removal-toggle');
  if (selectionToggle) selectionToggle.checked = enabled;
  cancelImageBackgroundRemoval();
  if (enabled) {
    startPhotoBackgroundRemoval();
    return;
  }
  clearBackgroundRemovedPhoto();
  redrawEditorCanvas();
}

function handleSelectionBackgroundRemovalToggle(enabled) {
  handleBackgroundRemovalToggle(enabled);
}

function toggleBackgroundRemovalFromToolbar() {
  const enabled = !isBackgroundRemovalEnabled;
  if (enabled && !uploadedPhotoSource) {
    showToast('Load a photo before removing its background.');
    return;
  }
  handleBackgroundRemovalToggle(enabled);
}

function syncBackgroundRemovalButton() {
  const button = document.getElementById('tool-background-button');
  const icon = document.getElementById('background-removal-button-icon');
  if (button) button.setAttribute('aria-pressed', String(isBackgroundRemovalEnabled));
  const selectionToggle = document.getElementById('selection-background-removal-toggle');
  if (selectionToggle) selectionToggle.checked = isBackgroundRemovalEnabled;
  if (icon) icon.className = isBackgroundRemovalEnabled
    ? 'fa-solid fa-square-check'
    : 'fa-regular fa-square';
}

function handleBackgroundModelChange() {
  if (isBackgroundRemovalEnabled) {
    startPhotoBackgroundRemoval();
  }
}

function resetPhotoPlacement() {
  if (!editorCanvas) return;
  resetPhotoAnchor();
  photoScale = 1.0;
  photoRotation = 0;
  setPhotoPanMode(false);
  setPhotoRotateMode(false);

  const scaleSlider = document.getElementById('slider-photo-scale');
  if (scaleSlider) scaleSlider.value = 1.0;
  const rotationSlider = document.getElementById('slider-photo-rotation');
  if (rotationSlider) rotationSlider.value = 0;
  updatePhotoRotationDisplay();

  redrawEditorCanvas();
  showToast('Image loaded to Canvas Stage');
}

function updatePhotoScale(val) {
  setPhotoScale(parseFloat(val));
  redrawEditorCanvas();
}

function updatePhotoRotation(val) {
  photoRotation = Math.min(180, Math.max(-180, parseFloat(val)));
  const rotationSlider = document.getElementById('slider-photo-rotation');
  if (rotationSlider) rotationSlider.value = photoRotation;
  updatePhotoRotationDisplay();
  redrawEditorCanvas();
}

function updatePhotoRotationDisplay() {
  const value = `${Math.trunc(photoRotation)}°`;
  const rotationValue = document.getElementById('photo-rotation-value');
  if (rotationValue) rotationValue.textContent = value;
  const toolbarValue = document.getElementById('toolbar-rotation-value');
  if (toolbarValue) toolbarValue.textContent = value;
}

function resetPhotoRotation() {
  photoRotation = 0;
  const rotationSlider = document.getElementById('slider-photo-rotation');
  if (rotationSlider) rotationSlider.value = 0;
  updatePhotoRotationDisplay();
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
  const zoomValue = document.getElementById('photo-zoom-value');
  if (zoomValue) zoomValue.textContent = `${Math.round(photoScale * 100)}%`;
}

function togglePhotoPanMode() {
  if (!userCapturedImage) {
    showToast('Load a photo first');
    return;
  }

  setPhotoPanMode(!isPhotoPanModeEnabled);
}

function setPhotoPanMode(enabled) {
  if (enabled && isPhotoRotateModeEnabled) setPhotoRotateMode(false);
  isPhotoPanModeEnabled = enabled;
  if (editorCanvas) editorCanvas.classList.toggle('touch-pan-mode', enabled);
  if (!enabled) {
    isDragging = false;
    activePointerId = null;
    activePointerType = null;
    activeTouchPointers.clear();
    activePinch = null;
  }

  const toolbarButton = document.getElementById('tool-pan-button');
  if (toolbarButton) {
    toolbarButton.setAttribute('aria-pressed', String(enabled));
    toolbarButton.setAttribute('aria-label', enabled ? 'Disable pan and zoom' : 'Enable pan and zoom');
    const label = toolbarButton.querySelector('span');
    if (label) label.textContent = enabled ? 'Pan & zoom on' : 'Pan & zoom';
  }
  const detailsButton = document.getElementById('toggle-photo-pan');
  if (detailsButton) {
    detailsButton.setAttribute('aria-pressed', String(enabled));
    const label = document.getElementById('photo-pan-button-label');
    if (label) label.textContent = enabled ? 'Disable pan & zoom' : 'Enable pan & zoom';
  }

  const status = document.getElementById('photo-pan-status');
  if (status) {
    status.textContent = enabled
      ? 'Pan and zoom are on. Drag to move, scroll to zoom on desktop, or pinch to zoom on mobile.'
      : 'Pan and zoom are off. Enable them to drag, scroll to zoom, or pinch to zoom.';
  }
}

function togglePhotoRotateMode() {
  if (!userCapturedImage) {
    showToast('Load a photo first');
    return;
  }
  setPhotoRotateMode(!isPhotoRotateModeEnabled);
}

function setPhotoRotateMode(enabled) {
  if (enabled && isPhotoPanModeEnabled) setPhotoPanMode(false);
  isPhotoRotateModeEnabled = enabled;
  activeRotateGesture = null;
  if (editorCanvas) editorCanvas.classList.toggle('touch-rotate-mode', enabled);
  const button = document.getElementById('toggle-photo-rotate');
  if (button) button.setAttribute('aria-pressed', String(enabled));
  const label = document.getElementById('photo-rotate-button-label');
  if (label) label.textContent = enabled ? 'Disable drag to rotate' : 'Enable drag to rotate';
  const toolbarButton = document.getElementById('tool-rotate-button');
  if (toolbarButton) {
    toolbarButton.setAttribute('aria-pressed', String(enabled));
    toolbarButton.setAttribute('aria-label', enabled ? 'Disable drag to rotate' : 'Enable drag to rotate');
  }
  const toolbarIcon = document.getElementById('toolbar-rotate-icon');
  if (toolbarIcon) toolbarIcon.className = enabled
    ? 'fa-solid fa-rotate'
    : 'fa-solid fa-arrows-rotate';
  const detailsIcon = document.getElementById('photo-rotate-icon');
  if (detailsIcon) detailsIcon.className = enabled
    ? 'fa-solid fa-rotate'
    : 'fa-solid fa-arrows-rotate';
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

  drawEditorComposition(
    editorCtx,
    editorCanvas.width,
    editorCanvas.height,
    backgroundRemovedPhotoPreview || userCapturedImagePreview || backgroundRemovedPhoto || userCapturedImage,
    activePresetFramePreviewImg,
    activePreset,
    photoX,
    photoY,
    editorCanvas.width / (activePresetFrameImg?.naturalWidth || activePresetFrameImg?.width || editorCanvas.width)
  );
}

function drawEditorComposition(ctx, W, H, photo, frameImage, preset, positionX, positionY, fontScale) {
  ctx.clearRect(0, 0, W, H);

  const textInput = document.getElementById('input-editor-text');
  const textXSlider = document.getElementById('slider-text-x');
  const textYSlider = document.getElementById('slider-text-y');
  const fontSizeSlider = document.getElementById('slider-font-size');
  const textColorPicker = document.getElementById('picker-text-color');

  const textVal = textInput ? textInput.value : (preset.defaultText || 'GUEST NAME');
  const textX = textXSlider ? W * parseInt(textXSlider.value) / 100 : W * (preset.textXPercent || 50) / 100;
  const textY = textYSlider ? H * parseInt(textYSlider.value) / 100 : H * (preset.textYPercent || 88) / 100;
  const fontSize = (fontSizeSlider ? parseInt(fontSizeSlider.value) : (preset.fontSize || 32)) * fontScale;
  const textColor = textColorPicker ? textColorPicker.value : (preset.textColor || '#ffffff');

  const fontFamily = preset.fontFamily || 'Inter';
  const fontWeight = preset.fontWeight || 'bold';

  const layerZ = getEditorLayerZ(preset);
  renderCanvasLayers(ctx, [
    {
      zIndex: layerZ.photo,
      draw: () => {
        if (!photo) return;
        const fitScale = Math.min(W / photo.width, H / photo.height);
        const drawW = photo.width * fitScale * photoScale;
        const drawH = photo.height * fitScale * photoScale;
        drawMaskedPhotoLayer(ctx, {
          width: W,
          height: H,
          image: photo,
          x: positionX,
          y: positionY,
          drawWidth: drawW,
          drawHeight: drawH,
          rotation: photoRotation,
          maskAnchorX: W * Number(preset.anchorXPercent ?? 50) / 100,
          maskAnchorY: H * Number(preset.anchorYPercent ?? 45) / 100,
          masks: preset.masks || []
        });
      }
    },
    {
      zIndex: layerZ.template,
      draw: () => {
        if (frameImage) ctx.drawImage(frameImage, 0, 0, W, H);
        else drawFallbackFrameArtwork(ctx, W, H, preset);
      }
    },
    {
      zIndex: layerZ.text,
      draw: () => {
        if (!editorTextEnabled) return;
        ctx.save();
        ctx.fillStyle = textColor;
        ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = Math.max(2, fontSize / 12);
        ctx.strokeText(textVal, textX, textY);
        ctx.fillText(textVal, textX, textY);
        ctx.restore();
      }
    }
  ]);
}

function drawFallbackFrameArtwork(ctx, W, H, preset = activePreset) {
  if (preset && preset.id === 'classic_polaroid') {
    ctx.fillStyle = preset.frameColor || '#f8fafc';
    ctx.fillRect(0, 0, W, 40);
    ctx.fillRect(0, 0, 40, H);
    ctx.fillRect(W - 40, 0, 40, H);
    ctx.fillRect(0, H - 130, W, 130);
  } else {
    ctx.strokeStyle = preset ? preset.frameColor : '#3b82f6';
    ctx.lineWidth = 16;
    ctx.strokeRect(16, 16, W - 32, H - 32);

    ctx.fillStyle = preset ? preset.frameColor : '#3b82f6';
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
    if (!isPhotoPanModeEnabled && !isPhotoRotateModeEnabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const pos = getCoords(e);
    if (isPhotoRotateModeEnabled) {
      activeRotateGesture = {
        pointerId: e.pointerId,
        startAngle: Math.atan2(pos.y - photoY, pos.x - photoX),
        startRotation: photoRotation
      };
      editorCanvas.setPointerCapture(e.pointerId);
      if (e.cancelable) e.preventDefault();
      return;
    }

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
    if (activeRotateGesture && e.pointerId === activeRotateGesture.pointerId) {
      const currentAngle = Math.atan2(pos.y - photoY, pos.x - photoX);
      let angleDelta = currentAngle - activeRotateGesture.startAngle;
      if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
      if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
      updatePhotoRotation(activeRotateGesture.startRotation + angleDelta * 180 / Math.PI);
      if (e.cancelable) e.preventDefault();
      return;
    }

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
    if (activeRotateGesture && e.pointerId === activeRotateGesture.pointerId) {
      activeRotateGesture = null;
      return;
    }

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

function setCompositeDownloadStatus(message, state = 'loading') {
  const button = document.getElementById('download-composite-button');
  const icon = document.getElementById('download-composite-icon');
  const label = document.getElementById('download-composite-label');
  const status = document.getElementById('download-composite-status');
  if (button) {
    button.disabled = state === 'loading';
    button.setAttribute('aria-busy', String(state === 'loading'));
  }
  if (icon) {
    icon.className = state === 'loading'
      ? 'fa-solid fa-spinner fa-spin'
      : state === 'error'
        ? 'fa-solid fa-circle-exclamation'
        : 'fa-solid fa-download';
  }
  if (label) {
    label.textContent = state === 'loading'
      ? 'Preparing full-quality image...'
      : 'Download full-quality image';
  }
  if (status) {
    status.textContent = message;
    status.hidden = !message;
  }
}

async function createFullResolutionExportBlob() {
  const width = activePresetFrameImg?.naturalWidth || activePresetFrameImg?.width || editorCanvas.width;
  const height = activePresetFrameImg?.naturalHeight || activePresetFrameImg?.height || editorCanvas.height;
  if (width > MAX_EXPORT_EDGE || height > MAX_EXPORT_EDGE || width * height > MAX_EXPORT_PIXELS) {
    throw new Error(`This template is ${width} × ${height} pixels, which is too large to safely export on a phone.`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to prepare a full-quality image.');

  drawEditorComposition(
    ctx,
    width,
    height,
    backgroundRemovedPhoto || userCapturedImage,
    activePresetFrameImg,
    activePreset,
    photoX * width / editorCanvas.width,
    photoY * height / editorCanvas.height,
    1
  );

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the image.');
  return blob;
}

async function downloadCanvasComposite() {
  if (!userCapturedImage) {
    showToast('Load a photo first');
    return;
  }
  if (isCompositeExportInProgress) return;

  isCompositeExportInProgress = true;
  setCompositeDownloadStatus('Preparing the original-resolution composition. This may take a moment.');
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const blob = await createFullResolutionExportBlob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `SnapStudio_Export_${Date.now()}.png`;
    link.href = objectUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    setCompositeDownloadStatus('Your full-quality PNG is ready.', 'success');
    showToast('PNG image downloaded');
  } catch (error) {
    console.error('Failed to export the canvas as a PNG:', error);
    setCompositeDownloadStatus(error.message || 'Unable to prepare the PNG. Please try again.', 'error');
    showToast(error.message || 'Unable to download PNG. Please try again.');
  } finally {
    isCompositeExportInProgress = false;
    const button = document.getElementById('download-composite-button');
    if (button) {
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
    }
  }
}

async function shareCanvasComposite() {
  if (!userCapturedImage) {
    showToast('Load a photo first');
    return;
  }
  if (isCompositeExportInProgress) {
    showToast('An image export is already in progress.');
    return;
  }

  isCompositeExportInProgress = true;
  setCompositeDownloadStatus('Preparing the original-resolution image for sharing.');
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const blob = await createFullResolutionExportBlob();
    const file = new File([blob], 'SnapStudio-creation.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: 'My SnapStudio creation' });
      setCompositeDownloadStatus('Image shared. The full-quality download is ready below the preview.', 'success');
      return;
    }
    showToast('Sharing is not available in this browser. Download the PNG instead.');
    setCompositeDownloadStatus('Sharing is not available. Use Download full-quality image instead.', 'error');
  } catch (error) {
    if (error.name === 'AbortError') {
      setCompositeDownloadStatus('Sharing canceled. Your composition is unchanged.', 'success');
    } else {
      console.error('Unable to share the canvas:', error);
      showToast('Unable to share this image. Try downloading the PNG.');
      setCompositeDownloadStatus(error.message || 'Unable to prepare the image for sharing.', 'error');
    }
  } finally {
    isCompositeExportInProgress = false;
    const button = document.getElementById('download-composite-button');
    if (button) {
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
    }
  }
}

window.addEventListener('resize', syncEditorCanvasViewport);