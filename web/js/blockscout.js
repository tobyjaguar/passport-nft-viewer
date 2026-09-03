// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Keyless Blockscout adapter — a port of the CLI's `indexers.rs`, same API
// shape for every EVM chain:
//   GET {base}/api/v2/addresses/{owner}/nft[?next_page_params…]
// Returns `items[]` with `image_url`, `media_url`, `metadata`
// (`attributes`, `description`, `name`, `image`), `token.{name,symbol,address_hash,type}`,
// `id`, `value`; paginates via `next_page_params`. CORS is `*`, so the browser
// talks to it directly — no proxy, nobody in the middle learns the address.

import { CHAINS } from './bundle.js';

const MAX_PAGES = 20;

/** Serde's `Value::to_string()` for non-strings is compact JSON; JSON.stringify matches. */
function scalarToString(v) {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Normalise one Blockscout item into the CLI's `Asset` shape. */
export function normalizeItem(it) {
  const token = it.token ?? {};
  const md = it.metadata && typeof it.metadata === 'object' ? it.metadata : {};
  const mdStr = (k) => (typeof md[k] === 'string' ? md[k] : undefined);
  const traits = Array.isArray(md.attributes)
    ? md.attributes.flatMap((t) => {
        if (!t || typeof t.trait_type !== 'string' || !('value' in t)) return [];
        return [[t.trait_type, scalarToString(t.value)]];
      })
    : [];
  const tokenId = it.id ?? '';
  const collection = token.name ?? token.symbol ?? '';
  const name = mdStr('name') ?? (collection ? `${collection} #${tokenId}` : `#${tokenId}`);
  const imageUrl = [it.image_url, it.media_url, mdStr('image')].find((s) => typeof s === 'string' && s !== '');
  return {
    contract: token.address_hash ?? token.address ?? '',
    tokenId,
    standard: (it.token_type ?? token.type ?? '').toLowerCase().replaceAll('-', ''),
    collection,
    name,
    description: mdStr('description') ?? '',
    imageUrl: imageUrl ?? null,
    traits,
    amount: it.value ?? '1',
  };
}

export function indexerFor(chainKey) {
  const chain = CHAINS[chainKey];
  if (!chain?.blockscout) throw new Error(`${chainKey}: no keyless indexer adapter yet`);
  const base = chain.blockscout;
  const name = `blockscout (${base.replace(/^https:\/\//, '')})`;

  /**
   * Enumerate the NFTs `owner` holds, at most `max`. `onPage(count)` fires per page.
   * Errors carry a user-readable message; a 429 says so explicitly.
   */
  async function assetsOf(owner, max, { fetchImpl = globalThis.fetch, signal, onPage } = {}) {
    const out = [];
    let next = null;
    let pages = 0;
    for (;;) {
      const url = new URL(`${base}/api/v2/addresses/${owner}/nft`);
      if (next && typeof next === 'object') {
        for (const [k, v] of Object.entries(next)) url.searchParams.set(k, scalarToString(v));
      }
      const resp = await fetchImpl(url, { headers: { accept: 'application/json' }, signal });
      if (resp.status === 429) throw new Error(`${name}: rate limited (HTTP 429) — wait a bit and retry`);
      if (!resp.ok) throw new Error(`${name}: HTTP ${resp.status} for ${url.pathname}`);
      const page = await resp.json();
      pages++;
      const items = Array.isArray(page.items) ? page.items : [];
      onPage?.(items.length);
      for (const it of items) {
        out.push(normalizeItem(it));
        if (out.length >= max) return out;
      }
      const np = page.next_page_params;
      if (np === null || np === undefined) break;
      next = np;
      if (pages >= MAX_PAGES) break;
    }
    return out;
  }

  return { name, base, assetsOf };
}
