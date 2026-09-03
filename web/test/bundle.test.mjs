// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fitDimensions, isAddress, truncateChars, nowRfc3339, imageFileName, buildManifest, manifestJson,
  makeItem, makeSkipped, itemLoadable, sha256Hex, MAX_IMAGE_BYTES,
} from '../js/bundle.js';

test('fitDimensions matches the image crate (480x672 → 343x480, the on-device sample)', () => {
  assert.deepEqual(fitDimensions(480, 672), [343, 480]);
  assert.deepEqual(fitDimensions(1000, 500), [480, 240]);
  assert.deepEqual(fitDimensions(300, 200), [300, 200]);
  assert.deepEqual(fitDimensions(1, 3000), [1, 480]);
  assert.deepEqual(fitDimensions(4000, 4000), [480, 480]);
});

test('isAddress accepts 20-byte hex only', () => {
  assert.ok(isAddress('0x37F11F9D0749A053dfe6243a4C1d294ea293Ec12'));
  assert.ok(!isAddress('37F11F9D0749A053dfe6243a4C1d294ea293Ec12'));
  assert.ok(!isAddress('0x37F11F9D0749A053dfe6243a4C1d294ea293Ec1'));
  assert.ok(!isAddress('vitalik.eth'));
});

test('truncateChars counts code points like chars().take()', () => {
  assert.equal(truncateChars('a😀b', 2), 'a😀');
  assert.equal(truncateChars('x'.repeat(700)).length, 600);
  assert.equal(truncateChars(undefined), '');
});

test('nowRfc3339 is seconds-precision UTC', () => {
  assert.equal(nowRfc3339(new Date('2026-08-26T20:57:44.123Z')), '2026-08-26T20:57:44Z');
});

test('image file names are zero-padded to four digits', () => {
  assert.equal(imageFileName(1), 'images/0001.raw');
  assert.equal(imageFileName(50), 'images/0050.raw');
});

test('manifest has the CLI field order and shape', async () => {
  const asset = {
    name: 'Mara #17397', collection: 'Mara', contract: '0x1a92', tokenId: '17397', standard: 'erc721',
    description: 'd', traits: [['Role', 'Enchanter'], ['Tier', '3']], imageUrl: 'https://x/y.webp',
  };
  const data = new Uint8Array([1, 2, 3]);
  const item = makeItem({ file: 'images/0001.raw', width: 343, height: 480, bytes: 658616, sha256: await sha256Hex(data), asset, imageUrl: asset.imageUrl });
  const m = buildManifest({
    owner: '0xabc', chainKey: 'ethereum', source: 'blockscout (eth.blockscout.com)',
    items: [item], skipped: [makeSkipped(asset, 'no image URL')], fetchedAt: '2026-08-26T20:57:44Z',
  });
  assert.deepEqual(Object.keys(m), ['format', 'owner', 'owner_path', 'chain', 'fetched_at', 'source', 'items', 'skipped']);
  assert.deepEqual(Object.keys(m.items[0]), ['file', 'width', 'height', 'bytes', 'sha256', 'name', 'collection', 'contract', 'token_id', 'standard', 'description', 'traits', 'image_url']);
  assert.deepEqual(m.items[0].traits[0], { trait_type: 'Role', value: 'Enchanter' });
  assert.deepEqual(Object.keys(m.skipped[0]), ['name', 'contract', 'token_id', 'reason']);
  assert.equal(m.chain, 'eip155:1');
  assert.equal(m.items[0].sha256, '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
  const json = manifestJson(m);
  assert.ok(json.startsWith('{\n  "format": 1,\n  "owner": "0xabc",'));
  assert.deepEqual(JSON.parse(json), m);
});

test('itemLoadable mirrors the device caps', () => {
  const ok = { file: 'images/0001.raw', width: 480, height: 480, bytes: 691256 };
  assert.ok(itemLoadable(ok));
  assert.ok(!itemLoadable({ ...ok, width: 481 }));
  assert.ok(!itemLoadable({ ...ok, bytes: MAX_IMAGE_BYTES + 1 }));
  assert.ok(!itemLoadable({ ...ok, file: 'images/../x.raw' }));
  assert.ok(!itemLoadable({ ...ok, bytes: 0 }));
});
