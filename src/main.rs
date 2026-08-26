// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// NFT Viewer for Passport Prime — phase 0.
//
// Reads `nft/manifest.json` from a USB drive plugged into the Passport (or
// the Airlock) and lists the items it describes. Proves the grant-on-first-use
// filesystem permission path and `Location::Usb` enumeration. Phase 1 adds
// the gallery (one `.raw` texture resident at a time). See the workspace's
// docs/nft-viewer-scoping.md.

mod bundle;
mod storage;
mod theme;

use slint_keyos_platform::app_ui2;
use slint_keyos_platform::slint::{ModelRc, SharedString, VecModel};

app_ui2!("NFT Viewer");

fn app_main(_cx: AppContext, ui: AppWindow) {
    log_server::init_wait(env!("CARGO_CRATE_NAME")).unwrap();
    log::set_max_level(log::LevelFilter::Info);

    log::info!("nft-viewer: phase 0 — manifest listing from removable storage");

    theme::init(&ui);

    let cb = ui.global::<Callbacks>();
    cb.set_status("Insert a USB drive with an nft/ bundle, then tap Load.".into());

    let ui_weak = ui.as_weak();
    cb.on_load_from(move |source| {
        let Some(ui) = ui_weak.upgrade() else { return };
        let location = match source {
            0 => storage::Location::Usb,
            _ => storage::Location::Airlock,
        };
        load_bundle(&ui, location);
    });

    ui.run().expect("UI running");
}

/// Runs on the main thread (UI callback) so the fs permission prompt can show.
fn load_bundle(ui: &AppWindow, location: storage::Location) {
    let cb = ui.global::<Callbacks>();
    let where_ = storage::location_name(location);
    cb.set_status(format!("Reading {} from the {where_}…", bundle::MANIFEST_PATH).into());
    cb.set_items(ModelRc::new(VecModel::<ItemRow>::from(Vec::new())));

    let bytes = match storage::read_file(location, bundle::MANIFEST_PATH, bundle::MAX_MANIFEST_BYTES) {
        Ok(b) => b,
        Err(storage::StorageError::NoMedia) => {
            log::info!("nft-viewer: no media at {where_}");
            cb.set_status(format!("No {where_} found. Insert one with an nft/ bundle and tap Load again.").into());
            return;
        }
        Err(e) => {
            log::warn!("nft-viewer: read {} on {where_}: {e}", bundle::MANIFEST_PATH);
            let hint = match storage::list_dir(location, "") {
                Ok(names) if names.is_empty() => format!("The {where_} is empty."),
                Ok(names) => format!("Top level of the {where_}: {}", names.join(", ")),
                Err(e2) => format!("Could not list the {where_}: {e2}"),
            };
            cb.set_status(format!("No bundle on the {where_}: {e}. {hint}").into());
            return;
        }
    };

    let manifest = match bundle::parse_manifest(&bytes) {
        Ok(m) => m,
        Err(e) => {
            log::warn!("nft-viewer: manifest rejected: {e}");
            cb.set_status(format!("Bundle rejected: {e}").into());
            return;
        }
    };

    let loadable = manifest.items.iter().filter(|i| i.loadable()).count();
    log::info!(
        "nft-viewer: bundle for {} ({}) — {} items, {} loadable",
        manifest.owner,
        manifest.owner_path,
        manifest.items.len(),
        loadable
    );

    let rows: Vec<ItemRow> = manifest
        .items
        .iter()
        .map(|item| ItemRow {
            title: SharedString::from(item.display_name()),
            subtitle: SharedString::from(if item.collection.is_empty() {
                item.contract.clone()
            } else {
                item.collection.clone()
            }),
            detail: SharedString::from(if item.loadable() {
                format!("{}×{} · {} KB", item.width, item.height, item.bytes / 1024)
            } else {
                format!("skipped: exceeds {}px / cap", bundle::MAX_IMAGE_DIM)
            }),
        })
        .collect();

    cb.set_owner(SharedString::from(if manifest.owner.is_empty() {
        "(no owner recorded)".to_string()
    } else {
        manifest.owner.clone()
    }));
    cb.set_provenance(SharedString::from(format!(
        "{}{}{}",
        if manifest.owner_path.is_empty() { String::new() } else { format!("{} · ", manifest.owner_path) },
        if manifest.source.is_empty() { String::new() } else { format!("via {} · ", manifest.source) },
        if manifest.fetched_at.is_empty() { "fetched: unknown".to_string() } else { format!("fetched {}", manifest.fetched_at) }
    )));
    cb.set_items(ModelRc::new(VecModel::from(rows)));
    cb.set_status(format!("{} items on the {where_} ({loadable} loadable)", manifest.items.len()).into());
}
