let cameraCaptureDialog = null;
let cameraCaptureVideo = null;
let cameraCaptureStatus = null;
let cameraCaptureStream = null;
let cameraCaptureHandler = null;
let cameraCaptureFallbackInput = null;
let cameraCaptureRequestId = 0;

function openCameraCapture(onCapture, fallbackInput) {
  if (fallbackInput && isMobileCameraDevice()) {
    fallbackInput.click();
    return;
  }

  cameraCaptureHandler = onCapture;
  cameraCaptureFallbackInput = fallbackInput;
  ensureCameraCaptureDialog();
  cameraCaptureDialog.classList.remove('hidden');
  cameraCaptureDialog.setAttribute('aria-hidden', 'false');
  cameraCaptureStatus.textContent = 'Requesting camera access...';
  document.getElementById('camera-capture-button').disabled = true;
  document.getElementById('camera-fallback-button').hidden = !fallbackInput;

  if (!navigator.mediaDevices?.getUserMedia) {
    cameraCaptureStatus.textContent = 'Camera access is not available in this browser. Use Choose photo instead.';
    document.getElementById('camera-capture-button').disabled = true;
    return;
  }

  startDeviceCamera();
}

function isMobileCameraDevice() {
  return navigator.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function ensureCameraCaptureDialog() {
  if (cameraCaptureDialog) return;

  cameraCaptureDialog = document.createElement('div');
  cameraCaptureDialog.id = 'camera-capture-dialog';
  cameraCaptureDialog.className = 'hidden fixed inset-0 z-[100] bg-slate-950/90 p-4 flex items-center justify-center';
  cameraCaptureDialog.setAttribute('role', 'dialog');
  cameraCaptureDialog.setAttribute('aria-modal', 'true');
  cameraCaptureDialog.setAttribute('aria-labelledby', 'camera-capture-title');
  cameraCaptureDialog.setAttribute('aria-hidden', 'true');
  cameraCaptureDialog.innerHTML = `
    <div class="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
      <div class="mb-3 flex items-center justify-between">
        <h2 id="camera-capture-title" class="font-bold text-slate-100">Take a photo</h2>
        <button id="camera-close-button" type="button" class="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-slate-800" aria-label="Close camera">Close</button>
      </div>
      <video id="camera-capture-video" class="max-h-[65vh] w-full rounded-xl bg-black object-contain" autoplay playsinline></video>
      <p id="camera-capture-status" class="mt-3 text-sm text-slate-300" role="status" aria-live="polite"></p>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <button id="camera-fallback-button" type="button" class="hidden rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-600">Choose photo instead</button>
        <button id="camera-capture-button" type="button" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500" disabled>Take photo</button>
      </div>
    </div>`;
  document.body.appendChild(cameraCaptureDialog);
  cameraCaptureVideo = document.getElementById('camera-capture-video');
  cameraCaptureStatus = document.getElementById('camera-capture-status');
  cameraCaptureVideo.style.transform = 'scaleX(-1)';
  document.getElementById('camera-capture-button').addEventListener('click', captureDevicePhoto);
  document.getElementById('camera-close-button').addEventListener('click', closeCameraCapture);
  document.getElementById('camera-fallback-button').addEventListener('click', () => {
    const input = cameraCaptureFallbackInput;
    closeCameraCapture();
    input?.click();
  });
  cameraCaptureDialog.addEventListener('click', event => {
    if (event.target === cameraCaptureDialog) closeCameraCapture();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !cameraCaptureDialog.classList.contains('hidden')) {
      closeCameraCapture();
    }
  });
}

async function startDeviceCamera() {
  const requestId = ++cameraCaptureRequestId;
  stopDeviceCamera();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } }
    });
    if (requestId !== cameraCaptureRequestId) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    cameraCaptureStream = stream;
    cameraCaptureVideo.srcObject = stream;
    await cameraCaptureVideo.play();
    document.getElementById('camera-capture-button').disabled = false;
    cameraCaptureStatus.textContent = 'Position yourself in the frame, then take a photo.';
  } catch (error) {
    if (requestId !== cameraCaptureRequestId) return;
    console.error('Unable to access device camera:', error);
    stopDeviceCamera();
    document.getElementById('camera-capture-button').disabled = true;
    cameraCaptureStatus.textContent = error.name === 'NotAllowedError'
      ? 'Camera permission was denied. Allow camera access in your browser settings, or choose a photo instead.'
      : error.name === 'NotFoundError'
        ? 'No camera was found. Connect a camera or choose a photo instead.'
        : `Unable to start the camera${error.message ? `: ${error.message}` : '.'}`;
  }
}

async function captureDevicePhoto() {
  if (!cameraCaptureStream || !cameraCaptureVideo.videoWidth) return;

  const canvas = document.createElement('canvas');
  canvas.width = cameraCaptureVideo.videoWidth;
  canvas.height = cameraCaptureVideo.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    cameraCaptureStatus.textContent = 'Unable to capture an image in this browser.';
    return;
  }

  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(cameraCaptureVideo, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) {
    cameraCaptureStatus.textContent = 'Unable to create the captured photo. Please try again.';
    return;
  }

  const photoFile = new File([blob], `snapstudio-camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
  const handler = cameraCaptureHandler;
  closeCameraCapture();
  handler?.({ target: { files: [photoFile] } });
}

function stopDeviceCamera() {
  if (cameraCaptureStream) {
    cameraCaptureStream.getTracks().forEach(track => track.stop());
    cameraCaptureStream = null;
  }
  if (cameraCaptureVideo) cameraCaptureVideo.srcObject = null;
}

function closeCameraCapture() {
  cameraCaptureRequestId += 1;
  stopDeviceCamera();
  if (cameraCaptureDialog) {
    cameraCaptureDialog.classList.add('hidden');
    cameraCaptureDialog.setAttribute('aria-hidden', 'true');
  }
  cameraCaptureHandler = null;
  cameraCaptureFallbackInput = null;
}

window.addEventListener('pagehide', stopDeviceCamera);
