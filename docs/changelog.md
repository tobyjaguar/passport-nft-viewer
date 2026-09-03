# Changelog

## [Unreleased] — 2026-09-03 (web wrapper)

### Added
- `web/`: static, no-server bundle builder ("plug in, open, paste, unplug"). Blockscout
  enumeration, in-browser image decode/resize, a byte-exact JS port of the SDK's `.raw`
  writer (`web/js/raw.js`, proven against `foundation-asset-tool` on ten fixtures covering
  every `generate_texture` branch), manifest format 1, direct write to the drive root via
  the File System Access API (Chromium) or a `.zip` (elsewhere), camera QR address entry.
- `.github/workflows/pages.yml`: parity tests gate a GitHub Pages deploy of `web/`.

### Found along the way
- ipfs.io / gateway.ipfs.io / dweb.link / nftstorage.link answer GET with a Cloudflare JS
  challenge (403, no CORS) as of 2026-09-03; HEAD still says 200. Filebase and Pinata
  gateways serve with `access-control-allow-origin: *`, so they are the default fallbacks.
- robinhoodchain.blockscout.com sits behind Cloudflare bot filtering: browser user agents
  pass, `passport-nft-cli`'s does not (403) — the CLI needs a UA change.

## [0.1.0] — 2026-08-26 (phase 0)

### Added
- Scaffold from `foundation new` (SDK 1.0.0), app-id `0x67919a16cb73cf18293a8a1f34d09d5a`.
- `nft/manifest.json` reader over `fs::Location::Usb` / `Airlock` with per-image caps
  (`src/bundle.rs`, `src/storage.rs`); Source screen listing items.
- `removable-read` permission template (`GetUsbReadAccess`, `GetAirlockReadAccess`).
