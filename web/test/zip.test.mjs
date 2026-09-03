// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip, parseZip, crc32 } from '../js/zip.js';

test('crc32 of "123456789" is the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip round-trips names and bytes', () => {
  const a = new Uint8Array(1000).map((_, i) => i & 255);
  const b = new TextEncoder().encode('{"format":1}');
  const zip = buildZip([
    { name: 'nft/images/0001.raw', data: a },
    { name: 'nft/manifest.json', data: b },
  ], { now: new Date(2026, 7, 26, 12, 0, 0) });
  const back = parseZip(zip);
  assert.deepEqual(back.map((e) => e.name), ['nft/images/0001.raw', 'nft/manifest.json']);
  assert.deepEqual(Buffer.from(back[0].data), Buffer.from(a));
  assert.deepEqual(Buffer.from(back[1].data), Buffer.from(b));
  // local header (30 + name) + data, twice, then two central entries and the end record
  assert.equal(zip.length, (30 + 19 + 1000) + (30 + 17 + 12) + (46 + 19) + (46 + 17) + 22);
});

test('an empty archive is just the end record', () => {
  assert.equal(buildZip([]).length, 22);
  assert.deepEqual(parseZip(buildZip([])), []);
});
