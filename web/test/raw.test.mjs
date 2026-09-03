// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The make-or-break check from the spike brief: the JS `.raw` writer must
// reproduce `foundation-asset-tool raw-image-file` byte for byte. Every fixture
// under fixtures/ is a PNG the SDK tool converted (the `.raw`) plus the same
// pixels as bare RGBA (the `.rgba`), one per branch of Slint's classifier.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { encodeRaw, decodeRawHeader, PixelFormat, formatName, ROOT_SIZE } from '../js/raw.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const index = JSON.parse(readFileSync(join(fixtures, 'index.json'), 'utf8'));

const EXPECTED_FORMAT = {
  'opaque-7x5': PixelFormat.Rgb,
  'opaque-8x6': PixelFormat.Rgb,
  'rgba-margin-13x9': PixelFormat.RgbaPremultiplied,
  'alphamap-6x6': PixelFormat.AlphaMap,
  'transparent-4x4': PixelFormat.Rgba,
  'jitter-5x4': PixelFormat.AlphaMap,
  'jitter3-4x3': PixelFormat.Rgb,
  'photo-64x48': PixelFormat.Rgb,
  'translucent-9x7': PixelFormat.RgbaPremultiplied,
  'solid-3x3': PixelFormat.AlphaMap,
};

test('fixture index covers every classifier branch', () => {
  const names = index.map((c) => c.name).sort();
  assert.deepEqual(names, Object.keys(EXPECTED_FORMAT).sort());
});

for (const { name, width, height } of index) {
  test(`${name}: encodeRaw matches foundation-asset-tool byte for byte`, () => {
    const rgba = new Uint8Array(readFileSync(join(fixtures, `${name}.rgba`)));
    const reference = new Uint8Array(readFileSync(join(fixtures, `${name}.raw`)));
    const ours = encodeRaw(rgba, width, height);
    assert.equal(ours.length, reference.length, 'file length');
    assert.deepEqual(Buffer.from(ours), Buffer.from(reference), 'bytes');

    const hdr = decodeRawHeader(ours);
    assert.equal(hdr.format, EXPECTED_FORMAT[name], `pixel format (got ${formatName(hdr.format)})`);
    assert.equal(hdr.nineSlice, null);
    assert.equal(hdr.dataOffset, 0);
    assert.equal((hdr.dataLen + 3 & ~3) + ROOT_SIZE, ours.length, 'payload padded to 4 then root');
  });
}

test('rgba-margin-13x9 is cropped to the non-transparent rect and premultiplied', () => {
  const rgba = new Uint8Array(readFileSync(join(fixtures, 'rgba-margin-13x9.rgba')));
  const hdr = decodeRawHeader(encodeRaw(rgba, 13, 9));
  assert.deepEqual(hdr.size, [13, 9]);
  assert.deepEqual(hdr.rect, { left: 2, top: 1, width: 9, height: 7 });
  assert.equal(hdr.dataLen, 9 * 7 * 4);
});

test('alphamap carries the tint in color_argb', () => {
  const rgba = new Uint8Array(readFileSync(join(fixtures, 'alphamap-6x6.rgba')));
  const hdr = decodeRawHeader(encodeRaw(rgba, 6, 6));
  assert.deepEqual(hdr.color, { a: 255, r: 30, g: 144, b: 255 });
  assert.deepEqual(hdr.rect, { left: 1, top: 1, width: 5, height: 5 });
});

test('fully transparent input becomes Slint\'s empty texture', () => {
  const hdr = decodeRawHeader(encodeRaw(new Uint8Array(4 * 4 * 4), 4, 4));
  assert.deepEqual(hdr.size, [0, 0]);
  assert.deepEqual(hdr.rect, { left: 0, top: 0, width: 1, height: 1 });
  assert.equal(hdr.format, PixelFormat.Rgba);
  assert.equal(hdr.dataLen, 4);
});

test('a 480x480 opaque image is 691,256 bytes, as measured on device', () => {
  const rgba = new Uint8Array(480 * 480 * 4).fill(255);
  for (let i = 0; i < rgba.length; i += 4) rgba[i] = i & 255; // keep it multi-coloured, so Rgb not AlphaMap
  assert.equal(encodeRaw(rgba, 480, 480).length, 691256);
});

test('rejects a byte count that does not match the dimensions', () => {
  assert.throws(() => encodeRaw(new Uint8Array(10), 2, 2), /not 2x2 RGBA/);
});
