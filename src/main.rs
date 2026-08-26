// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// NFT Viewer for Passport Prime — phase 1.
//
// Read-only gallery of pre-rendered images from a USB drive (or the Airlock).
// The host tool (`passport-nft-cli`, workspace host-tools/) does all network
// work and converts images to KeyOS `.raw` textures; this app never decodes
// an image and never touches key material. Exactly one texture is resident
// at a time — OOM on KeyOS is an uncatchable kill (KeyOS #12).

mod bundle;
mod storage;
mod theme;

use slint_keyos_platform::app_ui2;
use slint_keyos_platform::raw_image::raw_image_from_bytes;
use slint_keyos_platform::slint::{Image, ModelRc, SharedString, VecModel};
use std::cell::RefCell;
use std::rc::Rc;

app_ui2!("NFT Viewer");

#[derive(Default)]
struct State {
    location: Option<storage::Location>,
    manifest: Option<bundle::Manifest>,
    current: usize,
}

fn app_main(_cx: AppContext, ui: AppWindow) {
    log_server::init_wait(env!("CARGO_CRATE_NAME")).unwrap();
    log::set_max_level(log::LevelFilter::Info);

    log::info!("nft-viewer: phase 1 — gallery from removable storage");

    theme::init(&ui);

    let state = Rc::new(RefCell::new(State::default()));
    let cb = ui.global::<Callbacks>();
    cb.set_status("Insert a USB drive with an nft/ bundle, then tap Load.".into());

    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        cb.on_load_from(move |source| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let location = if source == 0 { storage::Location::Usb } else { storage::Location::Airlock };
            load_bundle(&ui, &state, location);
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        cb.on_open_item(move |index| {
            let Some(ui) = ui_weak.upgrade() else { return };
            show_item(&ui, &state, index.max(0) as usize);
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        cb.on_next_item(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let next = state.borrow().current + 1;
            show_item(&ui, &state, next);
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        cb.on_prev_item(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let cur = state.borrow().current;
            if cur > 0 {
                show_item(&ui, &state, cur - 1);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        cb.on_close_gallery(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let cb = ui.global::<Callbacks>();
            // Drop the resident texture before leaving the screen.
            cb.set_current_image(Image::default());
            cb.set_current_traits(ModelRc::new(VecModel::<TraitRow>::from(Vec::new())));
            cb.set_screen(0);
        });
    }

    ui.run().expect("UI running");
}

/// Runs on the main thread (UI callback) so the fs permission prompt can show.
fn load_bundle(ui: &AppWindow, state: &Rc<RefCell<State>>, location: storage::Location) {
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
            subtitle: SharedString::from(if item.collection.is_empty() { item.contract.clone() } else { item.collection.clone() }),
            detail: SharedString::from(if item.loadable() {
                format!("{}×{} · {} KB · tap to view", item.width, item.height, item.bytes / 1024)
            } else {
                format!("skipped: exceeds {}px / cap", bundle::MAX_IMAGE_DIM)
            }),
            loadable: item.loadable(),
        })
        .collect();

    cb.set_owner(SharedString::from(if manifest.owner.is_empty() { "(no owner recorded)".to_string() } else { manifest.owner.clone() }));
    cb.set_provenance(SharedString::from(format!(
        "{}{}{}",
        if manifest.owner_path.is_empty() { String::new() } else { format!("{} · ", manifest.owner_path) },
        if manifest.source.is_empty() { String::new() } else { format!("via {} · ", manifest.source) },
        if manifest.fetched_at.is_empty() { "fetched: unknown".to_string() } else { format!("fetched {}", manifest.fetched_at) }
    )));
    cb.set_items(ModelRc::new(VecModel::from(rows)));
    cb.set_status(format!("{} items on the {where_} ({loadable} loadable)", manifest.items.len()).into());

    let mut st = state.borrow_mut();
    st.location = Some(location);
    st.manifest = Some(manifest);
    st.current = 0;
}

/// Show item `index` in the gallery. Only this item's texture stays resident.
fn show_item(ui: &AppWindow, state: &Rc<RefCell<State>>, index: usize) {
    let cb = ui.global::<Callbacks>();

    // Copy what we need out of the state so no borrow is held across the read.
    let (location, path, meta) = {
        let st = state.borrow();
        let (Some(location), Some(manifest)) = (st.location, st.manifest.as_ref()) else { return };
        let Some(item) = manifest.items.get(index) else { return };
        if !item.loadable() {
            return;
        }
        (
            location,
            format!("{}/{}", bundle::BUNDLE_DIR, item.file),
            (
                item.display_name(),
                if item.collection.is_empty() { item.contract.clone() } else { item.collection.clone() },
                format!("{} / {}", index + 1, manifest.items.len()),
                item.description.clone(),
                item.traits.iter().map(|t| TraitRow { label: t.trait_type.clone().into(), value: t.value.clone().into() }).collect::<Vec<_>>(),
                item.bytes,
            ),
        )
    };
    let (title, collection, position, description, traits, expected_bytes) = meta;

    // Release the previous texture before reading the next one.
    cb.set_current_image(Image::default());
    cb.set_current_error("".into());
    cb.set_current_title(title.into());
    cb.set_current_collection(collection.into());
    cb.set_current_position(position.into());
    cb.set_current_description(description.into());
    cb.set_current_traits(ModelRc::new(VecModel::from(traits)));
    cb.set_screen(1);
    state.borrow_mut().current = index;

    match storage::read_file(location, &path, bundle::MAX_IMAGE_BYTES) {
        Ok(bytes) => {
            if bytes.len() as u64 != expected_bytes {
                log::warn!("nft-viewer: {path}: {} bytes on disk, manifest says {expected_bytes}", bytes.len());
            }
            let image = raw_image_from_bytes(&bytes);
            drop(bytes);
            let size = image.size();
            if size.width == 0 || size.height == 0 {
                log::warn!("nft-viewer: {path}: not a valid .raw texture");
                cb.set_current_error("This image is not a valid KeyOS .raw texture.".into());
            } else {
                log::info!("nft-viewer: showing {path} ({}×{})", size.width, size.height);
                cb.set_current_image(image);
            }
        }
        Err(e) => {
            log::warn!("nft-viewer: {path}: {e}");
            cb.set_current_error(format!("Could not read {path}: {e}").into());
        }
    }
}
