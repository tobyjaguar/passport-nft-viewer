# Changelog

## [0.1.0] — 2026-08-26 (phase 0)

### Added
- Scaffold from `foundation new` (SDK 1.0.0), app-id `0x67919a16cb73cf18293a8a1f34d09d5a`.
- `nft/manifest.json` reader over `fs::Location::Usb` / `Airlock` with per-image caps
  (`src/bundle.rs`, `src/storage.rs`); Source screen listing items.
- `removable-read` permission template (`GetUsbReadAccess`, `GetAirlockReadAccess`).
