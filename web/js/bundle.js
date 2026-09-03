// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Bundle format 1 — must stay in sync with `src/bundle.rs` (the device) and
// `host-tools/passport-nft-cli/src/bundle.rs` (the reference CLI). Field order
// below mirrors the CLI's serde output so the two manifests diff cleanly.

export const FORMAT = 1;

/** Device-side caps (mirrors src/bundle.rs). Exceeding them is an OOM kill on KeyOS. */
export const MAX_IMAGE_DIM = 480;
export const MAX_ITEMS = 50;
export const MAX_IMAGE_BYTES = 4 * 480 * 480 + 4096;
export const MAX_MANIFEST_BYTES = 256 * 1024;
/** Refuse to download anything bigger than this (mirrors the CLI). */
export const MAX_DOWNLOAD = 25 * 1024 * 1024;
export const MAX_DESCRIPTION_CHARS = 600;

/** Chains the bundle format knows about; Blockscout covers every EVM chain we care about. */
export const CHAINS = Object.freeze({
  ethereum: { label: 'Ethereum', caip2: 'eip155:1', blockscout: 'https://eth.blockscout.com' },
  base: { label: 'Base', caip2: 'eip155:8453', blockscout: 'https://base.blockscout.com' },
  robinhood: { label: 'Robinhood Chain', caip2: 'eip155:4663', blockscout: 'https://robinhoodchain.blockscout.com' },
});

export function isAddress(s) {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

/**
 * Target size for an image that must fit in a `max`×`max` square, aspect kept,
 * never upscaled. Same arithmetic as the `image` crate's `resize` (ratio =
 * min(max/w, max/h); round; at least 1), which is what the CLI uses.
 */
export function fitDimensions(width, height, max = MAX_IMAGE_DIM) {
  if (width <= max && height <= max) return [width, height];
  const ratio = Math.min(max / width, max / height);
  return [Math.max(Math.round(width * ratio), 1), Math.max(Math.round(height * ratio), 1)];
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** First `n` Unicode scalar values (the CLI does `chars().take(n)`). */
export function truncateChars(s, n = MAX_DESCRIPTION_CHARS) {
  return Array.from(s ?? '').slice(0, n).join('');
}

/** RFC 3339, seconds precision, UTC "Z" — matches the CLI's `fetched_at`. */
export function nowRfc3339(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function imageFileName(index1) {
  return `images/${String(index1).padStart(4, '0')}.raw`;
}

/** Field order is significant only for diffability against the CLI. */
export function makeItem({ file, width, height, bytes, sha256, asset, imageUrl }) {
  return {
    file,
    width,
    height,
    bytes,
    sha256,
    name: asset.name,
    collection: asset.collection,
    contract: asset.contract,
    token_id: asset.tokenId,
    standard: asset.standard,
    description: truncateChars(asset.description),
    traits: asset.traits.map(([trait_type, value]) => ({ trait_type, value })),
    image_url: imageUrl,
  };
}

export function makeSkipped(asset, reason) {
  return { name: asset.name, contract: asset.contract, token_id: asset.tokenId, reason };
}

export function buildManifest({ owner, ownerPath = '', chainKey, source, items, skipped, fetchedAt = nowRfc3339() }) {
  const chain = CHAINS[chainKey];
  if (!chain) throw new Error(`unknown chain ${chainKey}`);
  return {
    format: FORMAT,
    owner,
    owner_path: ownerPath,
    chain: chain.caip2,
    fetched_at: fetchedAt,
    source,
    items,
    skipped,
  };
}

export function manifestJson(manifest) {
  return JSON.stringify(manifest, null, 2);
}

/** Mirrors `Item::loadable` on the device: what the viewer will agree to open. */
export function itemLoadable(item) {
  return (
    item.width > 0 &&
    item.height > 0 &&
    item.width <= MAX_IMAGE_DIM &&
    item.height <= MAX_IMAGE_DIM &&
    item.bytes > 0 &&
    item.bytes <= MAX_IMAGE_BYTES &&
    item.file.startsWith('images/') &&
    item.file.endsWith('.raw') &&
    !item.file.includes('..')
  );
}
