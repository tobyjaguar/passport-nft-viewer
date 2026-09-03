// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Browser half of the image pipeline: fetch the bytes directly from wherever
// the NFT points (CORS is open on the gateways and hosts we have seen), decode
// with the browser's own decoders, scale to fit the device cap, and hand back
// straight RGBA for the `.raw` encoder. Mirrors `images.rs` in the CLI; the
// resampling filter differs (Skia "high" vs Lanczos3), the container does not.

import { fitDimensions, MAX_DOWNLOAD, MAX_IMAGE_DIM } from './bundle.js';

/**
 * Public gateways to try, in order. Checked 2026-09-03: ipfs.io, gateway.ipfs.io,
 * dweb.link and nftstorage.link answer GET with a Cloudflare JavaScript
 * challenge (HTTP 403, no CORS headers) that a cross-origin fetch can never
 * pass — HEAD still says 200, which is how the earlier "CORS is open" check was
 * fooled. Filebase and Pinata serve the bytes with `access-control-allow-origin: *`.
 * A gateway URL that Blockscout hands us is still tried first; these are fallbacks.
 */
export const DEFAULT_IPFS_GATEWAYS = [
  'https://ipfs.filebase.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
];

/**
 * Rewrite ipfs://, ar:// and gateway URLs into a list of HTTPS candidates to
 * try in order. A URL that already points at a public IPFS gateway gets the
 * other gateways as fallbacks, because gateways rate-limit and go away.
 */
export function candidateUrls(url, gateways = DEFAULT_IPFS_GATEWAYS) {
  if (url.startsWith('ipfs://')) {
    let rest = url.slice('ipfs://'.length);
    if (rest.startsWith('ipfs/')) rest = rest.slice('ipfs/'.length);
    return gateways.map((g) => g + rest);
  }
  if (url.startsWith('ar://')) return [`https://arweave.net/${url.slice('ar://'.length)}`];
  const m = /^https?:\/\/[^/]+\/ipfs\/(.+)$/.exec(url);
  if (m) {
    const rest = m[1];
    return [url, ...gateways.map((g) => g + rest).filter((u) => u !== url)];
  }
  return [url];
}

/** Per-request wall clock, so one silent gateway cannot stall the whole run. */
export const FETCH_TIMEOUT_MS = 20_000;

/** Combine the caller's abort signal with a timeout (AbortSignal.any where available). */
export function timeoutSignal(signal, ms = FETCH_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  const c = new AbortController();
  const relay = (s) => () => c.abort(s.reason);
  if (signal.aborted) c.abort(signal.reason);
  signal.addEventListener('abort', relay(signal), { once: true });
  timeout.addEventListener('abort', relay(timeout), { once: true });
  return c.signal;
}

/** Fetch `url` with a hard size cap and timeout; returns the bytes and the served content type. */
export async function download(url, { maxBytes = MAX_DOWNLOAD, signal, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const combined = timeoutSignal(signal, timeoutMs);
  let resp;
  try {
    resp = await fetch(url, { signal: combined, mode: 'cors', credentials: 'omit', redirect: 'follow' });
  } catch (e) {
    if (combined.aborted && !signal?.aborted) throw new Error(`no answer within ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const declared = Number(resp.headers.get('content-length'));
  if (declared > maxBytes) throw new Error(`${declared} bytes exceeds download cap`);
  const contentType = (resp.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!resp.body) {
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`${buf.length} bytes exceeds download cap`);
    return { bytes: buf, contentType };
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    let step;
    try {
      step = await reader.read();
    } catch (e) {
      if (combined.aborted && !signal?.aborted) throw new Error(`stalled: no data within ${Math.round(timeoutMs / 1000)}s`);
      throw e;
    }
    const { value, done } = step;
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`more than ${maxBytes} bytes exceeds download cap`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    bytes.set(c, p);
    p += c.length;
  }
  return { bytes, contentType };
}

const ASCII = new TextDecoder('ascii', { fatal: false });

export function looksLikeSvg(bytes, url, contentType) {
  if (contentType === 'image/svg+xml') return true;
  if (/\.svgz?(\?|#|$)/i.test(url) || url.startsWith('data:image/svg')) return true;
  const head = ASCII.decode(bytes.subarray(0, 512)).trimStart();
  return head.startsWith('<svg') || head.startsWith('<?xml');
}

function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(objectUrl) });
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('browser could not decode this image'));
    };
    img.src = objectUrl;
  });
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/**
 * Decode `bytes` and scale to fit `maxDim` (aspect kept, never upscaled).
 * Returns straight (non-premultiplied) RGBA plus both sizes.
 */
export async function decodeToRgba(bytes, { contentType = '', svg = false, maxDim = MAX_IMAGE_DIM } = {}) {
  const blob = new Blob([bytes], { type: svg ? 'image/svg+xml' : contentType || 'application/octet-stream' });
  let source = null;
  let release = () => {};
  let originalWidth;
  let originalHeight;

  if (!svg) {
    try {
      source = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
      originalWidth = source.width;
      originalHeight = source.height;
    } catch {
      source = null;
    }
  }
  if (!source) {
    const loaded = await loadImageElement(blob);
    source = loaded.img;
    release = loaded.release;
    originalWidth = source.naturalWidth;
    originalHeight = source.naturalHeight;
    if (svg && (!originalWidth || !originalHeight)) {
      // SVG without intrinsic size (viewBox only): render it square at the cap.
      originalWidth = originalHeight = maxDim;
    }
  }
  if (!originalWidth || !originalHeight) {
    release();
    throw new Error('image has no size');
  }

  const [width, height] = fitDimensions(originalWidth, originalHeight, maxDim);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let drawn = source;
  if (source instanceof ImageBitmap && (width !== originalWidth || height !== originalHeight)) {
    // Let the decoder resample at high quality instead of drawImage's default.
    try {
      drawn = await createImageBitmap(blob, {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'default',
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'high',
      });
      source.close();
    } catch {
      drawn = source;
    }
  }
  try {
    ctx.drawImage(drawn, 0, 0, width, height);
  } finally {
    if (drawn instanceof ImageBitmap) drawn.close();
    release();
  }
  let rgba;
  try {
    rgba = ctx.getImageData(0, 0, width, height).data;
  } catch (e) {
    // A tainted canvas (SVG with foreign content) refuses to be read back.
    throw new Error(`cannot read pixels: ${e.name}`);
  }
  return { width, height, rgba, originalWidth, originalHeight };
}

/**
 * Fetch an asset's image through the candidate URLs and decode it. Resolves to
 * `{ url, width, height, rgba, originalWidth, originalHeight }` for the URL that worked.
 */
export async function fetchAndFit(url, { gateways = DEFAULT_IPFS_GATEWAYS, maxDim = MAX_IMAGE_DIM, signal } = {}) {
  const candidates = candidateUrls(url, gateways);
  const failures = [];
  for (const candidate of candidates) {
    let downloaded;
    try {
      downloaded = await download(candidate, { signal });
    } catch (e) {
      if (signal?.aborted) throw e; // the user cancelled; a timeout is just this candidate failing
      // "Failed to fetch" is the browser's word for a network or CORS failure.
      const why = e.name === 'TypeError' ? 'blocked or unreachable (network/CORS)' : e.message;
      failures.push(`${new URL(candidate, 'https://x/').host || candidate.slice(0, 40)}: ${why}`);
      continue; // try the next gateway
    }
    const svg = looksLikeSvg(downloaded.bytes, candidate, downloaded.contentType);
    const decoded = await decodeToRgba(downloaded.bytes, { contentType: downloaded.contentType, svg, maxDim });
    return { url: candidate, ...decoded };
  }
  throw new Error(candidates.length > 1 ? `tried ${candidates.length} sources — ${failures.join('; ')}` : failures[0] ?? 'no fetchable URL');
}
