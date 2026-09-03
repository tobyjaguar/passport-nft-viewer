// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// KeyOS `.raw` texture writer — a byte-exact reimplementation of what
// `foundation-asset-tool raw-image-file` produces, so a browser can build the
// files the device reads without the SDK.
//
// A `.raw` file is an rkyv 0.8 archive of `slint_keyos_platform_common::RawImage`:
//
//   struct RawImage {
//     size: ImageSize,             // { width: u32, height: u32 }  — the canvas
//     original_size: ImageSize,    // same as `size` for a pre-scaled image
//     texture_rect: Rect,          // { x: i32, y: i32, width: u32, height: u32 } — the stored crop
//     color_argb: Color,           // { a, r, g, b: u8 } — only meaningful for AlphaMap
//     pixel_format: PixelFormat,   // repr(u8): Rgb=0, Rgba=1, RgbaPremultiplied=2, AlphaMap=3
//     nine_slice: Option<[u16; 4]>,// always None here
//     bytes: Vec<u8>,              // the texture_rect's pixels, tightly packed
//   }
//
// rkyv lays this out as: the `bytes` payload at offset 0, zero padding up to a
// multiple of 4, then the 56-byte root struct (repr(C), little-endian) at the
// very end of the file. The `Vec` is a relative pointer (i32, relative to its
// own position) plus a u32 length. The device locates the root by subtracting
// 56 from the file length, so there must be nothing after it.
//
// Which pixel format and crop the tool picks is decided by Slint's
// `generate_texture` (internal/compiler/passes/embed_images.rs); `analyze`
// below is a line-for-line port. Verified byte-for-byte against the SDK tool on
// the fixtures in test/fixtures/ (`node --test web/test/`).

export const PixelFormat = Object.freeze({ Rgb: 0, Rgba: 1, RgbaPremultiplied: 2, AlphaMap: 3 });

/** Size of the archived root struct that trails the pixel payload. */
export const ROOT_SIZE = 56;

const FORMAT_NAMES = ['Rgb', 'Rgba', 'RgbaPremultiplied', 'AlphaMap'];

export function formatName(format) {
  return FORMAT_NAMES[format] ?? `unknown(${format})`;
}

/**
 * Port of Slint's `generate_texture` analysis. `rgba` is straight (not
 * premultiplied) RGBA, row-major, 4 bytes per pixel — what a canvas
 * `getImageData` returns and what the `image` crate hands the SDK tool.
 *
 * Returns `null` for a fully transparent image (Slint emits an "empty texture").
 */
export function analyze(rgba, width, height) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`analyze: ${rgba.length} bytes is not ${width}x${height} RGBA`);
  }
  const alphaAt = (x, y) => rgba[(y * width + x) * 4 + 3];
  const lineTransparent = (y) => {
    for (let x = 0; x < width; x++) if (alphaAt(x, y) !== 0) return false;
    return true;
  };
  let top = 0;
  while (top < height && lineTransparent(top)) top++;
  if (top === height) return null;
  let bottom = height - 1;
  while (lineTransparent(bottom)) bottom--;
  const columnTransparent = (x) => {
    for (let y = top; y <= bottom; y++) if (alphaAt(x, y) !== 0) return false;
    return true;
  };
  let left = 0;
  while (columnTransparent(left)) left++;
  let right = width - 1;
  while (columnTransparent(right)) right--;

  // ColorState: 'unset' | 'different' | [r, g, b]
  let isOpaque = true;
  let color = 'unset';
  outer: for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3];
      if (alpha !== 255) isOpaque = false;
      if (alpha === 0) continue;
      if (color === 'unset') {
        color = [rgba[i], rgba[i + 1], rgba[i + 2]];
      } else if (color === 'different') {
        if (!isOpaque) break outer;
      } else if (
        Math.abs(color[0] - rgba[i]) > 2 ||
        Math.abs(color[1] - rgba[i + 1]) > 2 ||
        Math.abs(color[2] - rgba[i + 2]) > 2
      ) {
        color = 'different';
      }
    }
  }

  let format;
  let tint = null;
  if (Array.isArray(color)) {
    format = PixelFormat.AlphaMap;
    tint = color;
  } else if (isOpaque) {
    format = PixelFormat.Rgb;
  } else {
    format = PixelFormat.RgbaPremultiplied;
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1, format, tint };
}

/** Port of Slint's `convert_image` for a straight-RGBA source. */
export function convertPixels(rgba, width, rect, format) {
  const { left, top, width: rw, height: rh } = rect;
  let out;
  switch (format) {
    case PixelFormat.Rgb: {
      out = new Uint8Array(rw * rh * 3);
      let o = 0;
      for (let y = top; y < top + rh; y++) {
        let i = (y * width + left) * 4;
        for (let x = 0; x < rw; x++, i += 4) {
          out[o++] = rgba[i];
          out[o++] = rgba[i + 1];
          out[o++] = rgba[i + 2];
        }
      }
      return out;
    }
    case PixelFormat.RgbaPremultiplied: {
      out = new Uint8Array(rw * rh * 4);
      let o = 0;
      for (let y = top; y < top + rh; y++) {
        let i = (y * width + left) * 4;
        for (let x = 0; x < rw; x++, i += 4) {
          const a = rgba[i + 3];
          // `(x as u32 * a / 255) as u8` — integer division, truncating.
          out[o++] = Math.trunc((rgba[i] * a) / 255);
          out[o++] = Math.trunc((rgba[i + 1] * a) / 255);
          out[o++] = Math.trunc((rgba[i + 2] * a) / 255);
          out[o++] = a;
        }
      }
      return out;
    }
    case PixelFormat.Rgba: {
      out = new Uint8Array(rw * rh * 4);
      let o = 0;
      for (let y = top; y < top + rh; y++) {
        const i = (y * width + left) * 4;
        out.set(rgba.subarray(i, i + rw * 4), o);
        o += rw * 4;
      }
      return out;
    }
    case PixelFormat.AlphaMap: {
      out = new Uint8Array(rw * rh);
      let o = 0;
      for (let y = top; y < top + rh; y++) {
        let i = (y * width + left) * 4 + 3;
        for (let x = 0; x < rw; x++, i += 4) out[o++] = rgba[i];
      }
      return out;
    }
    default:
      throw new Error(`convertPixels: unknown format ${format}`);
  }
}

/**
 * Serialise an analysed texture as rkyv would. `texture` is
 * `{ size: [w, h], originalSize: [w, h], rect: {left, top, width, height}, format, tint, data }`.
 */
export function serializeRawImage(texture) {
  const { size, originalSize, rect, format, tint, data } = texture;
  const padded = (data.length + 3) & ~3; // root struct is 4-byte aligned
  const file = new Uint8Array(padded + ROOT_SIZE);
  file.set(data, 0);
  const v = new DataView(file.buffer, padded, ROOT_SIZE);
  v.setUint32(0, size[0], true);
  v.setUint32(4, size[1], true);
  v.setUint32(8, originalSize[0], true);
  v.setUint32(12, originalSize[1], true);
  v.setInt32(16, rect.left, true);
  v.setInt32(20, rect.top, true);
  v.setUint32(24, rect.width, true);
  v.setUint32(28, rect.height, true);
  if (format === PixelFormat.AlphaMap) {
    v.setUint8(32, 255); // a
    v.setUint8(33, tint[0]);
    v.setUint8(34, tint[1]);
    v.setUint8(35, tint[2]);
  } // else color_argb stays all-zero
  v.setUint8(36, format);
  // 37: padding; 38: ArchivedOption tag (0 = None); 39: padding; 40..47: the unused [u16; 4]
  v.setInt32(48, -(padded + 48), true); // RelPtr from its own offset back to the payload at 0
  v.setUint32(52, data.length, true);
  return file;
}

/**
 * Encode straight RGBA pixels as a `.raw` file, exactly as
 * `foundation-asset-tool raw-image-file` would encode a PNG of the same pixels.
 */
export function encodeRaw(rgba, width, height) {
  const a = analyze(rgba, width, height);
  if (a === null) {
    // Slint's Texture::new_empty(): zero sizes, a 1x1 rect, four zero bytes, Rgba.
    return serializeRawImage({
      size: [0, 0],
      originalSize: [0, 0],
      rect: { left: 0, top: 0, width: 1, height: 1 },
      format: PixelFormat.Rgba,
      tint: null,
      data: new Uint8Array(4),
    });
  }
  const rect = { left: a.left, top: a.top, width: a.width, height: a.height };
  return serializeRawImage({
    size: [width, height],
    originalSize: [width, height],
    rect,
    format: a.format,
    tint: a.tint,
    data: convertPixels(rgba, width, rect, a.format),
  });
}

/** Parse the trailing root struct of a `.raw` file (for tests and diagnostics). */
export function decodeRawHeader(file) {
  if (file.length < ROOT_SIZE) throw new Error(`raw: ${file.length} bytes is too short`);
  const base = file.length - ROOT_SIZE;
  const v = new DataView(file.buffer, file.byteOffset + base, ROOT_SIZE);
  const relptr = v.getInt32(48, true);
  const dataLen = v.getUint32(52, true);
  const dataOffset = base + 48 + relptr;
  if (dataOffset < 0 || dataOffset + dataLen > base) {
    throw new Error(`raw: payload pointer out of range (offset ${dataOffset}, len ${dataLen})`);
  }
  return {
    size: [v.getUint32(0, true), v.getUint32(4, true)],
    originalSize: [v.getUint32(8, true), v.getUint32(12, true)],
    rect: { left: v.getInt32(16, true), top: v.getInt32(20, true), width: v.getUint32(24, true), height: v.getUint32(28, true) },
    color: { a: v.getUint8(32), r: v.getUint8(33), g: v.getUint8(34), b: v.getUint8(35) },
    format: v.getUint8(36),
    nineSlice: v.getUint8(38) === 0 ? null : [v.getUint16(40, true), v.getUint16(42, true), v.getUint16(44, true), v.getUint16(46, true)],
    dataOffset,
    dataLen,
  };
}
