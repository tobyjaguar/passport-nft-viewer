// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateUrls, looksLikeSvg, DEFAULT_IPFS_GATEWAYS } from '../js/images.js';

const G = ['https://a.example/ipfs/', 'https://b.example/ipfs/'];

test('ipfs:// URLs fan out across the gateways in order', () => {
  assert.deepEqual(candidateUrls('ipfs://QmX/1.png', G), ['https://a.example/ipfs/QmX/1.png', 'https://b.example/ipfs/QmX/1.png']);
  assert.deepEqual(candidateUrls('ipfs://ipfs/QmX', G), ['https://a.example/ipfs/QmX', 'https://b.example/ipfs/QmX']);
});

test('ar:// goes to arweave.net', () => {
  assert.deepEqual(candidateUrls('ar://abc/def', G), ['https://arweave.net/abc/def']);
});

test('a gateway URL is tried as given, then on the other gateways', () => {
  assert.deepEqual(candidateUrls('https://ipfs.io/ipfs/QmX/img.png', G), [
    'https://ipfs.io/ipfs/QmX/img.png', 'https://a.example/ipfs/QmX/img.png', 'https://b.example/ipfs/QmX/img.png',
  ]);
  assert.deepEqual(candidateUrls('https://a.example/ipfs/QmX', G), ['https://a.example/ipfs/QmX', 'https://b.example/ipfs/QmX']);
});

test('anything else is left alone', () => {
  assert.deepEqual(candidateUrls('https://assets.otherside.xyz/x.webp', G), ['https://assets.otherside.xyz/x.webp']);
  assert.deepEqual(candidateUrls('data:image/png;base64,AAAA', G), ['data:image/png;base64,AAAA']);
});

test('default gateways prefer ones that answer cross-origin GETs', () => {
  assert.equal(DEFAULT_IPFS_GATEWAYS[0], 'https://ipfs.filebase.io/ipfs/');
  assert.ok(DEFAULT_IPFS_GATEWAYS.every((g) => g.startsWith('https://') && g.endsWith('/ipfs/')));
});

test('SVG detection mirrors the CLI plus the content type', () => {
  const enc = (s) => new TextEncoder().encode(s);
  assert.ok(looksLikeSvg(enc('<svg xmlns="…"></svg>'), 'https://x/y', ''));
  assert.ok(looksLikeSvg(enc('  <?xml version="1.0"?><svg/>'), 'https://x/y', ''));
  assert.ok(looksLikeSvg(new Uint8Array([0x89, 0x50]), 'https://x/y.svg?x=1', ''));
  assert.ok(looksLikeSvg(new Uint8Array([0x89, 0x50]), 'https://x/y', 'image/svg+xml'));
  assert.ok(!looksLikeSvg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'https://x/y.png', 'image/png'));
});
