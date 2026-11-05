let backgroundRemovalWorker = null;
let backgroundRemovalRequestId = 0;
let pendingBackgroundRemoval = null;

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

function stopBackgroundRemovalWorker() {
  if (backgroundRemovalWorker) {
    backgroundRemovalWorker.terminate();
    backgroundRemovalWorker = null;
  }
}

function failBackgroundRemoval(requestId, error) {
  if (!pendingBackgroundRemoval || pendingBackgroundRemoval.id !== requestId) return;
  const { onError } = pendingBackgroundRemoval;
  pendingBackgroundRemoval = null;
  console.error('Background removal failed:', error);
  const message = error instanceof TypeError
    ? 'Could not load the background-removal model. Check your internet connection and try again.'
    : `Background removal failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`;
  setBackgroundRemovalStatus(message, 'error');
  onError(error, message);
}

function createBackgroundRemovalWorker() {
  const worker = new Worker(new URL('./js/backgroundRemovalWorker.js', document.baseURI), { type: 'module' });
  worker.addEventListener('message', event => {
    if (backgroundRemovalWorker !== worker) return;
    const message = event.data;
    if (message.type === 'ready') return;
    if (!pendingBackgroundRemoval || message.requestId !== pendingBackgroundRemoval.id) return;

    if (message.type === 'progress') {
      const progress = message.total > 0 ? ` ${Math.round(message.current / message.total * 100)}%` : '';
      setBackgroundRemovalStatus(`Loading ${message.key}...${progress}`);
      return;
    }

    if (message.type === 'result') {
      if (!(message.blob instanceof Blob)) {
        failBackgroundRemoval(message.requestId, new Error('The background-removal worker returned an invalid image.'));
        return;
      }
      const { onComplete } = pendingBackgroundRemoval;
      pendingBackgroundRemoval = null;
      onComplete(message.blob);
      return;
    }

    if (message.type === 'error') {
      const error = message.name === 'TypeError'
        ? new TypeError(message.message)
        : new Error(message.message || 'The background-removal worker failed.');
      failBackgroundRemoval(message.requestId, error);
    }
  });
  worker.addEventListener('error', event => {
    if (backgroundRemovalWorker !== worker || !pendingBackgroundRemoval) return;
    event.preventDefault();
    const requestId = pendingBackgroundRemoval.id;
    stopBackgroundRemovalWorker();
    failBackgroundRemoval(requestId, new Error(event.message || 'The background-removal worker could not start.'));
  });
  worker.addEventListener('messageerror', () => {
    if (backgroundRemovalWorker !== worker || !pendingBackgroundRemoval) return;
    const requestId = pendingBackgroundRemoval.id;
    stopBackgroundRemovalWorker();
    failBackgroundRemoval(requestId, new Error('Unable to receive the processed image from the worker.'));
  });
  return worker;
}

function processImageBackgroundRemoval(imageSource, model, onComplete, onError) {
  const requestId = ++backgroundRemovalRequestId;
  if (pendingBackgroundRemoval) {
    pendingBackgroundRemoval = null;
    stopBackgroundRemovalWorker();
  }
  setBackgroundRemovalStatus('Preparing model in background...');

  try {
    pendingBackgroundRemoval = { id: requestId, onComplete, onError };
    if (typeof Worker !== 'function') {
      throw new Error('Background removal requires browser Web Worker support.');
    }
    backgroundRemovalWorker = backgroundRemovalWorker || createBackgroundRemovalWorker();
    backgroundRemovalWorker.postMessage({
      type: 'remove-background',
      requestId,
      imageSource,
      model
    });
  } catch (error) {
    stopBackgroundRemovalWorker();
    failBackgroundRemoval(requestId, error);
  }
}

function cancelImageBackgroundRemoval() {
  backgroundRemovalRequestId += 1;
  pendingBackgroundRemoval = null;
  stopBackgroundRemovalWorker();
  setBackgroundRemovalStatus('');
}
