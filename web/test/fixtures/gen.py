#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 talgya
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Generates the encoder fixtures: for each case, a PNG (input for the SDK's
# `foundation-asset-tool raw-image-file`, which produces the reference `.raw`),
# the same pixels as a bare RGBA byte dump (`.rgba`, what the JS encoder sees
# after canvas decode) and an index with the dimensions.
#
# Regenerate references inside the SDK Nix shell:
#   python3 gen.py
#   for p in *.png; do foundation-asset-tool raw-image-file "$p" "${p%.png}.raw"; done
#
# Each case exercises one branch of Slint's `generate_texture` classifier.

import json, math, os, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))

def png(name, w, h, px):
    rows = [bytes(v for x in range(w) for v in px(x, y)) for y in range(h)]
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))
    open(os.path.join(HERE, name + '.png'), 'wb').write(data)
    open(os.path.join(HERE, name + '.rgba'), 'wb').write(b''.join(rows))
    return {'name': name, 'width': w, 'height': h}

cases = []
# Opaque, odd width: RGB (3 B/px) and a byte length that is not a multiple of 4,
# so the rkyv padding before the root struct is exercised.
cases.append(png('opaque-7x5', 7, 5, lambda x, y: (x * 36, y * 60, (x * y * 9) & 255, 255)))
# Opaque, even: RGB with no padding.
cases.append(png('opaque-8x6', 8, 6, lambda x, y: (255 - x * 30, y * 40, (x + y) * 10, 255)))
# Transparent margin (2 px left, 1 px top, 2 px right, 1 px bottom) around a
# semi-transparent interior: cropped texture_rect + RgbaPremultiplied.
def margin(x, y):
    if x < 2 or y < 1 or x >= 11 or y >= 8:
        return (0, 0, 0, 0)
    return (200, x * 20, y * 25, 128 if (x + y) % 2 else 255)
cases.append(png('rgba-margin-13x9', 13, 9, margin))
# One colour with varying alpha, transparent first row/column: AlphaMap, cropped.
cases.append(png('alphamap-6x6', 6, 6, lambda x, y: (30, 144, 255, (x * y * 7) & 255)))
# Fully transparent: Slint's "empty texture" (zero size, 1x1 rect, 4 zero bytes).
cases.append(png('transparent-4x4', 4, 4, lambda x, y: (0, 0, 0, 0)))
# Colour jitter within the +-2 tolerance, one transparent pixel: still AlphaMap,
# keyed to the first non-transparent pixel's colour.
def jitter(x, y):
    j = (x + y) % 3
    return (100 + j, 50 + j, 25 + j, 0 if (x == 0 and y == 0) else 255)
cases.append(png('jitter-5x4', 5, 4, jitter))
# Jitter of exactly 3 on one channel: falls out of AlphaMap into Rgb.
def jitter3(x, y):
    return (100 + (3 if (x, y) == (2, 1) else 0), 50, 25, 255)
cases.append(png('jitter3-4x3', 4, 3, jitter3))
# Opaque "photo": the common NFT case (JPEG/WebP without alpha).
cases.append(png('photo-64x48', 64, 48, lambda x, y: (int(127 + 127 * math.sin(x / 5)), int(127 + 127 * math.cos(y / 4)), (x * 4) & 255, 255)))
# Semi-transparent everywhere, no transparent margin: RgbaPremultiplied, full rect.
cases.append(png('translucent-9x7', 9, 7, lambda x, y: (x * 28, 255 - y * 30, 77, 40 + (x * y * 5) % 200)))
# Single fully opaque colour: Slint classifies this as AlphaMap too (all alpha 255).
cases.append(png('solid-3x3', 3, 3, lambda x, y: (10, 20, 30, 255)))

json.dump(cases, open(os.path.join(HERE, 'index.json'), 'w'), indent=2)
print('\n'.join(c['name'] for c in cases))
