// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reading the bundle off removable storage through the KeyOS fs API.
//
// `Location::Usb` and `Location::Airlock` reads are grant-on-first-use: the
// first `open_*` on a location makes the fs server present a permission
// prompt to the user, so these calls must run on the main thread (the prompt
// cannot be presented from a worker — SDK MIGRATIONS gotcha 24). UI callbacks
// already run there.

use std::io::Read;

// `fs` and `server` are direct dependencies: the macro refers to them by crate
// name from inside a generated submodule, so re-exports won't do.
fs::use_api!();

pub use fs::Location;

#[derive(Debug)]
pub enum StorageError {
    /// No drive inserted / volume not mounted.
    NoMedia,
    NotFound,
    AccessDenied,
    Io(String),
}

impl core::fmt::Display for StorageError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            StorageError::NoMedia => write!(f, "nothing inserted"),
            StorageError::NotFound => write!(f, "not found"),
            StorageError::AccessDenied => write!(f, "access denied"),
            StorageError::Io(e) => write!(f, "{e}"),
        }
    }
}

fn map_err(e: fs::Error) -> StorageError {
    match e {
        fs::Error::NoMedia => StorageError::NoMedia,
        fs::Error::FileNotFound => StorageError::NotFound,
        fs::Error::AccessDenied => StorageError::AccessDenied,
        other => StorageError::Io(format!("{other:?}")),
    }
}

pub fn location_name(location: Location) -> &'static str {
    match location {
        Location::Usb => "USB drive",
        Location::Airlock => "Airlock",
        Location::User => "user storage",
        _ => "storage",
    }
}

/// Read a whole file from `location`, refusing anything larger than `max_bytes`
/// without reading it (size comes from metadata first).
pub fn read_file(location: Location, path: &str, max_bytes: u64) -> Result<Vec<u8>, StorageError> {
    let fs = FileSystem::default();
    let meta = fs.metadata(path, location).map_err(map_err)?;
    if meta.size > max_bytes {
        return Err(StorageError::Io(format!("{path} is {} bytes, cap is {max_bytes}", meta.size)));
    }
    let mut file = fs.open_file(path, location, fs::OpenFlags::READ_ONLY).map_err(map_err)?;
    let mut bytes = Vec::with_capacity(meta.size as usize);
    file.read_to_end(&mut bytes).map_err(|e| StorageError::Io(e.to_string()))?;
    Ok(bytes)
}

/// List entry names in a directory (for diagnostics on the Source screen).
pub fn list_dir(location: Location, path: &str) -> Result<Vec<String>, StorageError> {
    let fs = FileSystem::default();
    let dir = fs.open_dir(path, location).map_err(map_err)?;
    let mut names = Vec::new();
    while let Some(entry) = dir.next_entry().map_err(map_err)? {
        names.push(if entry.is_dir { format!("{}/", entry.name) } else { entry.name });
        if names.len() >= 64 {
            break;
        }
    }
    Ok(names)
}
