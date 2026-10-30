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
  const status = document.getElementById('background-removal-status');
  const statusText = document.getElementById('background-removal-status-text');
  if (!status || !statusText) return;

  const progressBar = document.getElementById('background-removal-progress-bar');
  const progressTrack = document.getElementById('background-removal-progress-track');
  const progressMatch = message.match(/(\d{1,3})%/);
  const progress = progressMatch ? Math.min(100, Number(progressMatch[1])) : 0;
  if (progressBar) progressBar.style.width = `${progress}%`;
  if (progressTrack) {
    progressTrack.setAttribute('aria-valuenow', String(progress));
    progressTrack.hidden = state !== 'error' && state !== 'success' && !progressMatch;
  }

  const icon = document.getElementById('background-removal-status-icon');
  if (icon) {
    icon.className = state === 'error'
      ? 'fa-solid fa-circle-exclamation mr-1 text-amber-400'
      : state === 'success'
        ? 'fa-solid fa-circle-check mr-1 text-emerald-400'
        : 'fa-solid fa-spinner fa-spin mr-1';
  }
  statusText.textContent = message;
  status.hidden = !message;
  status.classList.toggle('hidden', !message);
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