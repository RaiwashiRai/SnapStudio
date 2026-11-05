const BACKGROUND_REMOVAL_MODULE_URL = 'https://esm.sh/@imgly/background-removal@1.5.8?bundle';
let backgroundRemovalModulePromise;

self.postMessage({ type: 'ready' });

self.addEventListener('message', async event => {
  const { type, requestId, imageSource, model } = event.data || {};
  if (type !== 'remove-background') return;

  try {
    backgroundRemovalModulePromise = backgroundRemovalModulePromise || import(BACKGROUND_REMOVAL_MODULE_URL);
    const { removeBackground } = await backgroundRemovalModulePromise;
    const blob = await removeBackground(imageSource, {
      model,
      progress: (key, current, total) => {
        self.postMessage({ type: 'progress', requestId, key, current, total });
      }
    });
    self.postMessage({ type: 'result', requestId, blob });
  } catch (error) {
    backgroundRemovalModulePromise = null;
    self.postMessage({
      type: 'error',
      requestId,
      name: error instanceof Error ? error.name : '',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
