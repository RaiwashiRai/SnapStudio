let backgroundRemovalModulePromise = null;
let backgroundRemovalRequestId = 0;

async function removeImageBackground(imageSource, model, onProgress) {
  if (!backgroundRemovalModulePromise) {
    backgroundRemovalModulePromise = import('https://esm.sh/@imgly/background-removal@1.5.8?bundle')
      .catch(error => {
        backgroundRemovalModulePromise = null;
        throw error;
      });
  }

  const { removeBackground } = await backgroundRemovalModulePromise;
  return removeBackground(imageSource, {
    model,
    progress: (key, current, total) => onProgress(key, current, total)
  });
}

function setBackgroundRemovalStatus(message, state = 'loading') {
  const progressMatch = message.match(/(\d{1,3})%/);
  const progress = progressMatch ? Math.min(100, Number(progressMatch[1])) : 0;
  [
    {
      status: document.getElementById('background-removal-status'),
      text: document.getElementById('background-removal-status-text'),
      icon: document.getElementById('background-removal-status-icon'),
      track: document.getElementById('background-removal-progress-track'),
      bar: document.getElementById('background-removal-progress-bar')
    },
    {
      status: document.getElementById('selection-background-removal-status'),
      text: document.getElementById('selection-background-removal-status-text'),
      icon: document.getElementById('selection-background-removal-status-icon'),
      track: document.getElementById('selection-background-removal-progress-track'),
      bar: document.getElementById('selection-background-removal-progress-bar')
    }
  ].forEach(({ status, text, icon, track, bar }) => {
    if (!status || !text) return;
    if (bar) bar.style.width = `${progress}%`;
    if (track) {
      track.setAttribute('aria-valuenow', String(progress));
      track.hidden = state !== 'error' && state !== 'success' && !progressMatch;
    }
    if (icon) {
      icon.className = state === 'error'
        ? 'fa-solid fa-circle-exclamation mr-1 text-amber-400'
        : state === 'success'
          ? 'fa-solid fa-circle-check mr-1 text-emerald-400'
          : 'fa-solid fa-spinner fa-spin mr-1';
    }
    text.textContent = message;
    status.hidden = !message;
    status.classList.toggle('hidden', !message);
  });
}

async function processImageBackgroundRemoval(imageSource, model, onComplete, onError) {
  const requestId = ++backgroundRemovalRequestId;
  setBackgroundRemovalStatus('Preparing model...');

  try {
    const result = await removeImageBackground(imageSource, model, (key, current, total) => {
      if (requestId !== backgroundRemovalRequestId) return;
      const progress = total > 0 ? ` ${Math.round(current / total * 100)}%` : '';
      setBackgroundRemovalStatus(`Loading ${key}...${progress}`);
    });

    if (requestId === backgroundRemovalRequestId) onComplete(result);
  } catch (error) {
    if (requestId !== backgroundRemovalRequestId) return;
    console.error('Background removal failed:', error);
    const message = error instanceof TypeError
      ? 'Could not load the background-removal model. Check your internet connection and try again.'
      : `Background removal failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`;
    setBackgroundRemovalStatus(message, 'error');
    onError(error, message);
  }
}

function cancelImageBackgroundRemoval() {
  backgroundRemovalRequestId += 1;
  setBackgroundRemovalStatus('');
}