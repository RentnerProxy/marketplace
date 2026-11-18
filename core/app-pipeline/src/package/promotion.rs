use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::invalid;

pub(super) fn parent(path: &Path) -> &Path {
    path.parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
}

fn absolute_leaf(path: &Path) -> io::Result<PathBuf> {
    let name = path
        .file_name()
        .ok_or_else(|| invalid("Expected a package output name"))?;
    Ok(fs::canonicalize(parent(path))?.join(name))
}

pub(super) fn fresh_destination(path: &Path) -> io::Result<PathBuf> {
    let output = absolute_leaf(path)?;
    match fs::symlink_metadata(&output) {
        Ok(_) => Err(already_exists()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(output),
        Err(error) => Err(error),
    }
}

pub(super) fn promote(staging: &Path, output: &Path) -> io::Result<()> {
    let staging = absolute_leaf(staging)?;
    let destination = fresh_destination(output)?;
    let metadata = fs::symlink_metadata(&staging)?;
    if !metadata.is_dir() || is_reparse_point(&metadata) {
        return Err(invalid("Expected an extracted package staging directory"));
    }
    rename_exclusive(&staging, &destination).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            already_exists()
        } else {
            error
        }
    })
}

fn already_exists() -> io::Error {
    io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Candidate package output directory already exists",
    )
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn rename_exclusive(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(source.as_os_str().as_bytes())?;
    let destination = CString::new(destination.as_os_str().as_bytes())?;
    // SAFETY: Both arguments are live, NUL-terminated path strings. Each
    // syscall atomically refuses to replace an existing destination.
    let result = unsafe {
        #[cfg(target_os = "linux")]
        {
            libc::renameat2(
                libc::AT_FDCWD,
                source.as_ptr(),
                libc::AT_FDCWD,
                destination.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        }
        #[cfg(target_os = "macos")]
        {
            libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL)
        }
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_exclusive(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    let wide = |path: &Path| -> io::Result<Vec<u16>> {
        let mut encoded: Vec<_> = path.as_os_str().encode_wide().collect();
        if encoded.contains(&0) {
            return Err(invalid("Invalid package path"));
        }
        encoded.push(0);
        Ok(encoded)
    };
    let source = wide(source)?;
    let destination = wide(destination)?;
    // SAFETY: Each argument is a live, NUL-terminated UTF-16 pathname.
    // Zero flags disable destination replacement and cross-volume copies.
    let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0) };
    if result != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn rename_exclusive(_source: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Exclusive package directory promotion is unavailable",
    ))
}
