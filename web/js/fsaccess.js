// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Write the bundle straight onto a drive with the File System Access API
// (Chromium only). The picked folder is the drive root — `AIRLOCK` when the
// Passport is plugged in, or any USB stick — and the bundle lands in `nft/`.

export function supportsDirectoryWrite() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** Must be called from a user gesture (a click handler). */
export function pickDirectory() {
  return window.showDirectoryPicker({ id: 'passport-nft-bundle', mode: 'readwrite' });
}

async function ensureWritable(dir) {
  const opts = { mode: 'readwrite' };
  if ((await dir.queryPermission(opts)) === 'granted') return;
  if ((await dir.requestPermission(opts)) !== 'granted') {
    const e = new Error('write permission was not granted');
    e.name = 'NotAllowedError';
    throw e;
  }
}

/**
 * Lay `files` (`[{ path: 'nft/images/0001.raw', data }]`) down under `dir`,
 * first clearing stale `.raw`/`.png` files from `nft/images/` so the manifest
 * and the directory agree (same as the CLI). Files are written in order, so
 * keep the manifest last.
 */
export async function writeBundle(dir, files, { onProgress = () => {} } = {}) {
  await ensureWritable(dir);
  const nft = await dir.getDirectoryHandle('nft', { create: true });
  const images = await nft.getDirectoryHandle('images', { create: true });
  const stale = [];
  for await (const [name, handle] of images.entries()) {
    if (handle.kind === 'file' && /\.(raw|png)$/i.test(name)) stale.push(name);
  }
  for (const name of stale) await images.removeEntry(name);
  onProgress({ phase: 'cleared', count: stale.length });

  let written = 0;
  for (const f of files) {
    const parts = f.path.split('/');
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const handle = await d.getFileHandle(parts.at(-1), { create: true });
    const w = await handle.createWritable({ keepExistingData: false });
    try {
      await w.write(f.data);
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch { /* already gone */ }
      throw e;
    }
    written++;
    onProgress({ phase: 'written', path: f.path, written, total: files.length });
  }
  return { name: dir.name, cleared: stale.length, written };
}

export function isAirlock(name) {
  return /^airlock$/i.test(name ?? '');
}

/** Turn a DOMException from the write path into something a person can act on. */
export function describeWriteError(err, dirName) {
  const airlockHint = ' If this is the Passport\'s Airlock: on the device open Files → Airlock → ⋯ → "Airlock Read & Write", then choose the folder again.';
  switch (err?.name) {
    case 'AbortError':
      return null; // the user closed the picker
    case 'NotAllowedError':
    case 'SecurityError':
      return `The browser was not allowed to write to "${dirName ?? 'that folder'}".${isAirlock(dirName) || !dirName ? airlockHint : ''}`;
    case 'NoModificationAllowedError':
    case 'InvalidModificationError':
      return `"${dirName ?? 'That folder'}" is read-only.${airlockHint}`;
    case 'QuotaExceededError':
      return `"${dirName ?? 'That drive'}" is full.`;
    case 'NotFoundError':
      return `"${dirName ?? 'The drive'}" disappeared while writing — was it unplugged?`;
    default:
      return `Writing failed: ${err?.message ?? err}.${isAirlock(dirName) ? airlockHint : ''}`;
  }
}
