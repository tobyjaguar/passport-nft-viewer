// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { indexerFor, normalizeItem } from '../js/blockscout.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = JSON.parse(readFileSync(join(here, 'fixtures', 'blockscout-eth-page.json'), 'utf8'));

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const r = responses.shift();
    if (!r) throw new Error('unexpected fetch');
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  return { impl, calls };
}

test('normalizeItem mirrors the CLI for a real item', () => {
  const a = normalizeItem(page.items[0]);
  assert.equal(a.collection, 'Mara');
  assert.equal(a.tokenId, '17397');
  assert.equal(a.standard, 'erc721');
  assert.equal(a.name, 'Mara #17397');
  assert.match(a.imageUrl, /^https:\/\/assets\.otherside\.xyz\//);
  assert.match(a.contract, /^0x[0-9a-fA-F]{40}$/);
  assert.ok(a.traits.length > 0 && a.traits.every(([k, v]) => typeof k === 'string' && typeof v === 'string'));
});

test('normalizeItem falls back like the CLI on sparse items', () => {
  const a = normalizeItem(page.items[2]);
  assert.equal(a.name, 'SYN #77', 'name falls back to collection (symbol) + id');
  assert.equal(a.collection, 'SYN', 'symbol when name is null');
  assert.equal(a.standard, 'erc1155', 'lowercased, dashes removed');
  assert.equal(a.contract, '0x00000000000000000000000000000000000000aa', 'older `address` key');
  assert.equal(a.imageUrl, 'ipfs://QmSyntheticCid/77.png', 'media_url when image_url is null');
  assert.deepEqual(a.traits, [['Level', '3'], ['Shiny', 'true']], 'scalars stringified, trait without type dropped');
  assert.equal(a.amount, '2');
});

test('assetsOf paginates via next_page_params and stops at max', async () => {
  const ix = indexerFor('ethereum');
  assert.equal(ix.name, 'blockscout (eth.blockscout.com)');
  const { impl, calls } = fakeFetch([
    { status: 200, body: page },
    { status: 200, body: { items: [page.items[1]], next_page_params: null } },
  ]);
  const assets = await ix.assetsOf('0xabc', 50, { fetchImpl: impl });
  assert.equal(assets.length, 4);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], 'https://eth.blockscout.com/api/v2/addresses/0xabc/nft');
  const q = new URL(calls[1]).searchParams;
  assert.equal(q.get('items_count'), '50', 'numeric params stringified');
  assert.equal(q.get('token_type'), 'ERC-721');
});

test('assetsOf honours max mid-page', async () => {
  const ix = indexerFor('base');
  const { impl, calls } = fakeFetch([{ status: 200, body: page }]);
  const assets = await ix.assetsOf('0xabc', 2, { fetchImpl: impl });
  assert.equal(assets.length, 2);
  assert.equal(calls.length, 1, 'no second page requested');
});

test('assetsOf reports 429 and other HTTP failures plainly', async () => {
  const ix = indexerFor('robinhood');
  await assert.rejects(ix.assetsOf('0xabc', 5, { fetchImpl: fakeFetch([{ status: 429, body: {} }]).impl }), /rate limited/);
  await assert.rejects(ix.assetsOf('0xabc', 5, { fetchImpl: fakeFetch([{ status: 500, body: {} }]).impl }), /HTTP 500/);
});

test('unknown chain is refused', () => {
  assert.throws(() => indexerFor('solana'), /no keyless indexer/);
});
