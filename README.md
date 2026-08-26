# passport-nft-viewer

Offline NFT gallery for the Foundation Passport Prime hardware wallet.

**Status:** phase 0 — reads `nft/manifest.json` from a USB drive (or the Airlock) and lists the items it describes. No images yet. Scope and design: `docs/nft-viewer-scoping.md` in the [workspace repo](https://github.com/tobyjaguar/passport-prime-dev).

## How it works

Passport Prime has no network. A host tool (`host-tools/passport-nft-cli`, workspace repo) fetches what a wallet owns, downsizes each image, converts it to KeyOS's native `.raw` texture with the SDK's `foundation-asset-tool`, and writes a bundle to a USB drive:

```
nft/
├── manifest.json          ← owner, provenance, one entry per item (dimensions, bytes, name, collection…)
└── images/NNNN.raw        ← ≤ 480×480 RGBA, uncompressed
```

The device app reads the bundle through the KeyOS fs API (`Location::Usb` / `Location::Airlock`; read access is grant-on-first-use, so the user sees a permission prompt) and, in phase 1, shows one image at a time via `raw_image_from_bytes`. Nothing is decoded on the device; caps in `src/bundle.rs` are enforced before any image is read because an OOM on KeyOS kills the app (KeyOS #12).

## Phases

- **0 (this):** manifest listing. Proves the fs permission prompt + USB enumeration.
- **1:** gallery — one resident texture, swipe between items; `passport-nft-cli fetch` end to end.
- **2:** tie to the eth-wallet's derived addresses; Airlock as a second source.

## Build

Needs the [Foundation SDK](https://docs.foundation.xyz/developers/) v1.0+ (Nix). No KeyOS clone.

```bash
foundation develop && foundation doctor
foundation build          # device build, signed with the tobyjaguar publisher identity
foundation sim            # simulator
foundation pack           # target/keyos/passport-nft-viewer.app for Settings > Apps > Install App
foundation sideload --no-run && foundation-passport-drive launch-app <app-id>   # over usb-debug (Developer Mode on)
```

Unit tests (manifest parsing/caps): `FOUNDATION_THEMES_RUST_DIR=$PWD/target/foundation/themes/rust cargo test` after one build.

## Permissions

`gui-app` + `removable-read` (`GetUsbReadAccess`, `GetAirlockReadAccess` — see `permission_templates.toml`). Read-only by design: apps cannot flush writes to removable media (KeyOS #9).

## Signing identity

`tobyjaguar` — fingerprint `b5df4739d8c9e8fce8ff7d2a479a6dc6b7dada3704fd394853221cfc410de249` (verify out-of-band before allowing on your device).

## License

GPL-3.0-or-later.
