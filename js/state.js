// Global State & Preset Manager
let presets = [];
let activePreset = null;

async function loadPresetsFromFiles() {
  const manifestUrl = new URL('./presets/manifest.json', document.baseURI);
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) {
    throw new Error(`Unable to load preset manifest (${manifestResponse.status})`);
  }

  const manifest = await manifestResponse.json();
  if (!manifest || !Array.isArray(manifest.presets) || manifest.presets.length === 0) {
    throw new Error('Preset manifest must contain a non-empty "presets" array');
  }

  const loadedPresets = await Promise.all(manifest.presets.map(async (presetPath) => {
    if (typeof presetPath !== 'string' || !presetPath.toLowerCase().endsWith('.json')) {
      throw new Error(`Invalid preset path in manifest: ${presetPath}`);
    }

    const presetUrl = new URL(presetPath, manifestUrl);
    const response = await fetch(presetUrl);
    if (!response.ok) {
      throw new Error(`Unable to load preset ${presetPath} (${response.status})`);
    }

    const preset = await response.json();
    if (!preset || typeof preset !== 'object' || typeof preset.id !== 'string' || !preset.id) {
      throw new Error(`Preset ${presetPath} must contain a non-empty string id`);
    }

    if (typeof preset.frameImageUrl === 'string' && preset.frameImageUrl) {
      const presetRelativeUrl = new URL(preset.frameImageUrl, presetUrl).href;
      const siteRelativeUrl = new URL(preset.frameImageUrl, document.baseURI).href;
      const frameImageUrls = /^\.\/Templates\//i.test(preset.frameImageUrl)
        ? [siteRelativeUrl, presetRelativeUrl]
        : [presetRelativeUrl, siteRelativeUrl];
      preset.frameImageUrlCandidates = [...new Set(frameImageUrls)];
    }
    return preset;
  }));

  const presetIds = loadedPresets.map(preset => preset.id);
  if (new Set(presetIds).size !== presetIds.length) {
    throw new Error('Preset ids must be unique');
  }

  presets = loadedPresets;
  activePreset = presets[0];
  return presets;
}

function showToast(msg) {
  const toast = document.getElementById('toast-message');
  if (!toast) return;
  const toastText = document.getElementById('toast-text');
  if (toastText) toastText.innerText = msg;
  toast.classList.remove('translate-y-24', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-24', 'opacity-0');
  }, 2500);
}
