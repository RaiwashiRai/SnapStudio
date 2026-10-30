let backgroundRemovalModulePromise = null;
let backgroundRemovalRequestId = 0;

async function removeImageBackground(imageSource, model, onProgress) {
  if (!backgroundRemovalModulePromise) {
    backgroundRemovalModulePromise = import('https://esm.sh/@imgly/background-removal@1.5.8?bundle');
  }

  const { default: removeBackground } = await backgroundRemovalModulePromise;
  return removeBackground(imageSource, {
    model,
    progress: (key, current, total) => onProgress(key, current, total)
  });
}

function setBackgroundRemovalStatus(message) {
  const status = document.getElementById('background-removal-status');
  const statusText = document.getElementById('background-removal-status-text');
  if (!status || !statusText) return;

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
    setBackgroundRemovalStatus('');
    onError(error);
  }
}

function cancelImageBackgroundRemoval() {
  backgroundRemovalRequestId += 1;
  setBackgroundRemovalStatus('');
}