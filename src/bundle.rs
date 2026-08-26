// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The host → device bundle: `nft/manifest.json` plus `nft/images/NNNN.raw`.
// The manifest is written by `passport-nft-cli` (host-tools) and is the only
// thing phase 0 reads. Caps are enforced here *before* any image is touched,
// because an out-of-memory condition on KeyOS kills the app outright
// (KeyOS issue #12) — refusing early is the only defence.

use serde::Deserialize;

/// Bundle root, relative to the storage location's root.
pub const BUNDLE_DIR: &str = "nft";
pub const MANIFEST_PATH: &str = "nft/manifest.json";

/// Manifest format version this build understands.
pub const FORMAT: u32 = 1;

/// Hard caps (see docs/nft-viewer-scoping.md). `.raw` is uncompressed RGBA,
/// 4 bytes/pixel, and loading copies it at least twice.
pub const MAX_IMAGE_DIM: u32 = 480;
// foundation-asset-tool emits RGB (3 B/px) for opaque images and RGBA (4 B/px)
// otherwise; a 480×480 .raw measured 691,256 bytes. Allow the RGBA worst case.
pub const MAX_IMAGE_BYTES: u64 = 4 * 480 * 480 + 4096; // texture + rkyv header slack
pub const MAX_ITEMS: usize = 50;
pub const MAX_MANIFEST_BYTES: u64 = 256 * 1024;

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub format: u32,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub owner_path: String,
    #[serde(default)]
    pub chain: String,
    #[serde(default)]
    pub fetched_at: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub items: Vec<Item>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Trait {
    #[serde(default)]
    pub trait_type: String,
    #[serde(default, deserialize_with = "string_or_scalar")]
    pub value: String,
}

/// Trait values in the wild are strings, numbers, or booleans; accept all.
fn string_or_scalar<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(match v {
        serde_json::Value::String(s) => s,
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    })
}

#[derive(Debug, Deserialize)]
pub struct Item {
    pub file: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub collection: String,
    #[serde(default)]
    pub contract: String,
    #[serde(default)]
    pub token_id: String,
    #[serde(default)]
    pub standard: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub traits: Vec<Trait>,
    #[serde(default)]
    pub sha256: String,
}

#[derive(Debug)]
pub enum BundleError {
    /// The manifest is bigger than we are willing to parse.
    ManifestTooLarge(u64),
    Json(String),
    UnsupportedFormat(u32),
    TooManyItems(usize),
}

impl core::fmt::Display for BundleError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            BundleError::ManifestTooLarge(n) => write!(f, "manifest too large ({n} bytes)"),
            BundleError::Json(e) => write!(f, "manifest is not valid: {e}"),
            BundleError::UnsupportedFormat(v) => write!(f, "manifest format {v} unsupported (want {FORMAT})"),
            BundleError::TooManyItems(n) => write!(f, "{n} items exceeds cap of {MAX_ITEMS}"),
        }
    }
}

/// Parse and validate a manifest. Items that violate the per-image caps are
/// kept (so the UI can show them) but flagged via [`Item::loadable`].
pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, BundleError> {
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(BundleError::ManifestTooLarge(bytes.len() as u64));
    }
    let manifest: Manifest = serde_json::from_slice(bytes).map_err(|e| BundleError::Json(e.to_string()))?;
    if manifest.format != FORMAT {
        return Err(BundleError::UnsupportedFormat(manifest.format));
    }
    if manifest.items.len() > MAX_ITEMS {
        return Err(BundleError::TooManyItems(manifest.items.len()));
    }
    Ok(manifest)
}

impl Item {
    /// Whether this item is within the on-device memory caps. Phase 1 refuses
    /// to load anything for which this is false.
    pub fn loadable(&self) -> bool {
        self.width > 0
            && self.height > 0
            && self.width <= MAX_IMAGE_DIM
            && self.height <= MAX_IMAGE_DIM
            && self.bytes > 0
            && self.bytes <= MAX_IMAGE_BYTES
            && self.file.starts_with("images/")
            && self.file.ends_with(".raw")
            && !self.file.contains("..")
    }

    pub fn display_name(&self) -> String {
        if !self.name.is_empty() {
            self.name.clone()
        } else if !self.token_id.is_empty() {
            format!("#{}", self.token_id)
        } else {
            self.file.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"{"format":1,"owner":"0xabc","items":[
        {"file":"images/0001.raw","width":480,"height":480,"bytes":921712,"name":"Cool Cat #1","collection":"Cool Cats"},
        {"file":"images/0002.raw","width":800,"height":800,"bytes":2560000,"name":"Too Big"}
    ]}"#;

    #[test]
    fn parses_and_flags_caps() {
        let m = parse_manifest(GOOD.as_bytes()).unwrap();
        assert_eq!(m.owner, "0xabc");
        assert_eq!(m.items.len(), 2);
        assert!(m.items[0].loadable());
        assert!(!m.items[1].loadable());
        assert_eq!(m.items[1].display_name(), "Too Big");
    }

    #[test]
    fn parses_traits_and_description() {
        let m = parse_manifest(br#"{"format":1,"items":[{"file":"images/0001.raw","width":10,"height":10,"bytes":400,
            "description":"d","traits":[{"trait_type":"Role","value":"Enchanter"},{"trait_type":"Tier","value":3}]}]}"#);
        // numeric trait value is tolerated by the host tool (stringified) but a raw number must not break parsing here
        let m = match m { Ok(m) => m, Err(e) => panic!("{e}") };
        assert_eq!(m.items[0].description, "d");
        assert_eq!(m.items[0].traits.len(), 2);
        assert_eq!(m.items[0].traits[0].trait_type, "Role");
    }

    #[test]
    fn rejects_wrong_format() {
        let e = parse_manifest(br#"{"format":2,"items":[]}"#).unwrap_err();
        assert!(matches!(e, BundleError::UnsupportedFormat(2)));
    }

    #[test]
    fn rejects_traversal() {
        let m = parse_manifest(br#"{"format":1,"items":[{"file":"images/../x.raw","width":1,"height":1,"bytes":16}]}"#).unwrap();
        assert!(!m.items[0].loadable());
    }
}
