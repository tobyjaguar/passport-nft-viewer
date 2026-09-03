# NFT Wrapper — the in-browser bundle builder

The NFTs app on Passport Prime reads a pre-rendered bundle (`nft/manifest.json`
plus `nft/images/NNNN.raw`) from a USB drive or the Airlock, because a
third-party app on the device has no network. `passport-nft-cli` in the
workspace repo builds that bundle — but it is a Rust CLI you clone and compile.
This page does the same job with nothing to install: **plug in, open the URL,
paste an address, unplug.**

It is a static page. There is no server, so no server ever learns which
address you looked up. Your browser talks to the public Blockscout explorer and
the image hosts directly (both serve `Access-Control-Allow-Origin: *`).

## How it works

| Step | Where | What |
|---|---|---|
| Enumerate | `js/blockscout.js` | `GET {chain}.blockscout.com/api/v2/addresses/{owner}/nft`, paginated. Port of the CLI's `indexers.rs`. |
| Fetch + fit | `js/images.js` | Rewrites `ipfs://` / `ar://`, downloads with a 25 MB cap, decodes with the browser, scales to ≤ 480 px. Same target size arithmetic as the `image` crate. |
| Encode | `js/raw.js` | Writes KeyOS `.raw` textures — an rkyv archive of `RawImage` — reproducing Slint's `generate_texture` classifier and crop **byte for byte**. |
| Manifest | `js/bundle.js` | Format 1, same field order and caps as the device (`src/bundle.rs`). |
| Deliver | `js/fsaccess.js` / `js/zip.js` | Writes into the picked drive root via the File System Access API (Chromium), or hands back a `.zip` (everything else). |
| Address QR | `js/qr.js` | Native `BarcodeDetector`, else vendored jsQR. |

No framework, no bundler, no dependencies beyond the vendored QR decoder
(`vendor/README.md`). The CSP is `script-src 'self'`.

## The `.raw` parity test

The only genuinely uncertain part of this design was whether the SDK's
undocumented texture format could be reproduced without the SDK. It can:

```
node --test test/*.test.mjs
```

`test/raw.test.mjs` encodes every fixture in `test/fixtures/` and compares
against the `.raw` that `foundation-asset-tool raw-image-file` produced from the
same pixels — ten cases covering each branch of Slint's classifier (opaque RGB,
cropped premultiplied RGBA, alpha map with tint, empty texture, rkyv padding).
The workflow runs this before every deploy. If Foundation changes the format,
regenerate the references inside the SDK's Nix shell (`test/fixtures/gen.py`
has the commands) and the test tells you exactly what moved.

## Running it locally

Secure context required (File System Access, WebCrypto, camera), so use
`localhost`:

```
cd web && python3 -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/
```

End to end without the UI (headless, real network):

```
brave-browser --headless=new --disable-gpu --virtual-time-budget=120000 \
  --dump-dom "http://127.0.0.1:8765/test/e2e.html?owner=0x…&chain=ethereum&max=3" \
  | sed -n 's:.*<pre id="out">\(.*\)</pre>.*:\1:p' | python3 -m json.tool
```

## Airlock route, for reference

1. Plug the Passport in. On the device: Files → Airlock → ⋯ → **Airlock Read & Write** (it defaults to read-only and reverts on unplug).
2. Fetch here, then **Write to drive…** and pick the `AIRLOCK` volume's root.
3. **Unplug.** The device cannot read the Airlock while a computer holds it.
4. On the device: NFTs → Load from Airlock.

## Known limits

- Direct drive writing is Chromium-only; Firefox and Safari get the `.zip`.
- Blockscout can return zero items for very large wallets; the page says so rather than pretending.
- Resampling uses the browser's "high" quality filter, not Lanczos3, so pixels differ slightly from the CLI's output. The container is identical.
- SVG NFTs are rasterised by the browser (the CLI skips them); an SVG that embeds foreign content taints the canvas and is skipped with a reason.
