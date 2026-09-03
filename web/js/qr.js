// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Camera QR entry for the address — 42 hex characters are miserable to type.
// Uses the native BarcodeDetector where the browser has one, else the vendored
// jsQR (loaded on demand, only then).

export function supportsCamera() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Pull an EVM address out of whatever a wallet put in its QR (`ethereum:0x…@1`, plain, EIP-681…). */
export function extractAddress(text) {
  const m = /0x[0-9a-fA-F]{40}/.exec(text ?? '');
  return m ? m[0] : null;
}

let jsqrLoading = null;
function loadJsQR(url) {
  if (typeof globalThis.jsQR === 'function') return Promise.resolve(globalThis.jsQR);
  if (!jsqrLoading) {
    jsqrLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => (typeof globalThis.jsQR === 'function' ? resolve(globalThis.jsQR) : reject(new Error('jsQR did not load')));
      s.onerror = () => reject(new Error('jsQR failed to load'));
      document.head.appendChild(s);
    });
  }
  return jsqrLoading;
}

async function makeDetector(jsqrUrl) {
  if ('BarcodeDetector' in globalThis) {
    try {
      const formats = await globalThis.BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes('qr_code')) {
        const d = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
        return { kind: 'native', detect: async (video) => (await d.detect(video)).map((b) => b.rawValue) };
      }
    } catch {
      /* fall through to jsQR */
    }
  }
  const jsQR = await loadJsQR(jsqrUrl);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    kind: 'jsqr',
    detect: async (video) => {
      const scale = Math.min(1, 640 / (video.videoWidth || 640));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
      return r ? [r.data] : [];
    },
  };
}

/**
 * Start the camera into `video` and call `onResult(text)` on the first QR read.
 * Returns `{ stop, kind }`; call `stop()` to release the camera.
 */
export async function startScanner(video, { onResult, jsqrUrl = 'vendor/jsQR.js', intervalMs = 120 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();
  const detector = await makeDetector(jsqrUrl);

  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  };
  (async () => {
    while (!stopped) {
      if (video.readyState >= 2) {
        try {
          const hits = await detector.detect(video);
          if (hits.length) {
            stop();
            onResult(hits[0]);
            return;
          }
        } catch {
          /* a frame failed to decode; keep going */
        }
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return { stop, kind: detector.kind };
}
