// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The whole `passport-nft-cli fetch` run, in the browser: enumerate → fetch each
// image → fit → encode `.raw` → hash → manifest. Produces the list of files a
// writer (directory or zip) lays down under `nft/`.

import {
  MAX_ITEMS, MAX_IMAGE_DIM, buildManifest, manifestJson, makeItem, makeSkipped, imageFileName, itemLoadable, sha256Hex,
} from './bundle.js';
import { indexerFor } from './blockscout.js';
import { fetchAndFit, DEFAULT_IPFS_GATEWAYS } from './images.js';
import { encodeRaw, decodeRawHeader } from './raw.js';

const enc = new TextEncoder();

/**
 * `onEvent` receives:
 *   { type: 'list', count, source }
 *   { type: 'item', index, total, asset, status: 'fetching' | 'done' | 'skipped', item?, reason?, preview? }
 * Returns `{ manifest, files, items, skipped, totalBytes, source }` where `files`
 * is `[{ path, data }]` with the manifest last, exactly as the CLI orders its writes.
 */
export async function buildBundle({
  chainKey, owner, max = MAX_ITEMS, maxDim = MAX_IMAGE_DIM, gateways = DEFAULT_IPFS_GATEWAYS, signal, onEvent = () => {}, previews = true,
  concurrency = 3,
}) {
  max = Math.min(max, MAX_ITEMS);
  maxDim = Math.min(maxDim, MAX_IMAGE_DIM);
  const ix = indexerFor(chainKey);
  const assets = await ix.assetsOf(owner, max, { signal });
  onEvent({ type: 'list', count: assets.length, source: ix.name });
  if (assets.length === 0) {
    throw new Error(
      `${ix.name} reports no NFTs for ${owner}. Very large wallets can come back empty from Blockscout; try another chain.`,
    );
  }

  // One slot per asset so output order matches the indexer's order whatever
  // the fetch order was; images are fetched `concurrency` at a time.
  const results = new Array(assets.length);
  const total = assets.length;
  const work = async (i) => {
    const asset = assets[i];
    const index = i + 1;
    if (!asset.imageUrl) {
      results[i] = { skipped: makeSkipped(asset, 'no image URL') };
      onEvent({ type: 'item', index, total, asset, status: 'skipped', reason: 'no image URL' });
      return;
    }
    onEvent({ type: 'item', index, total, asset, status: 'fetching' });
    try {
      const fitted = await fetchAndFit(asset.imageUrl, { gateways, maxDim, signal });
      const raw = encodeRaw(fitted.rgba, fitted.width, fitted.height);
      const file = imageFileName(index);
      const item = makeItem({
        file, width: fitted.width, height: fitted.height, bytes: raw.length, sha256: await sha256Hex(raw), asset, imageUrl: fitted.url,
      });
      if (!itemLoadable(item)) throw new Error(`encoded ${item.width}×${item.height} (${item.bytes} B) exceeds the device caps`);
      results[i] = { item, file: { path: `nft/${file}`, data: raw } };
      let preview;
      if (previews && typeof ImageData !== 'undefined') {
        try {
          preview = await createImageBitmap(new ImageData(new Uint8ClampedArray(fitted.rgba), fitted.width, fitted.height));
        } catch {
          preview = undefined;
        }
      }
      onEvent({ type: 'item', index, total, asset, status: 'done', item, preview, header: decodeRawHeader(raw) });
    } catch (e) {
      if (signal?.aborted) throw e;
      const reason = e.message ?? String(e);
      results[i] = { skipped: makeSkipped(asset, reason) };
      onEvent({ type: 'item', index, total, asset, status: 'skipped', reason });
    }
  };
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, async () => {
    while (next < total) {
      signal?.throwIfAborted();
      await work(next++);
    }
  });
  await Promise.all(workers);

  const files = [];
  const items = [];
  const skipped = [];
  for (const r of results) {
    if (r?.item) {
      items.push(r.item);
      files.push(r.file);
    } else if (r?.skipped) {
      skipped.push(r.skipped);
    }
  }

  const manifest = buildManifest({ owner, chainKey, source: ix.name, items, skipped });
  files.push({ path: 'nft/manifest.json', data: enc.encode(manifestJson(manifest)) });
  const totalBytes = items.reduce((n, it) => n + it.bytes, 0);
  return { manifest, files, items, skipped, totalBytes, source: ix.name };
}
