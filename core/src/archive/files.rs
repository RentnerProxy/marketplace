use super::{CHUNK, MAX_ARCHIVE, invalid, text};
use crate::protocol::{CoreResult, OperationContext};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs::{self, File, Metadata};
use std::io::{Read, Write};
use std::path::Path;

#[derive(PartialEq, Eq)]
pub(crate) struct Identity {
    pub dev: u64,
    pub ino: u64,
    pub size: u64,
    pub modified: i128,
    pub changed: i128,
}
pub(crate) fn identity(file: &File) -> CoreResult<Identity> {
    let metadata = file.metadata()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(Identity {
            dev: metadata.dev(),
            ino: metadata.ino(),
            size: metadata.len(),
            modified: metadata.mtime() as i128 * 1_000_000_000 + metadata.mtime_nsec() as i128,
            changed: metadata.ctime() as i128 * 1_000_000_000 + metadata.ctime_nsec() as i128,
        })
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, FILE_BASIC_INFO, FileBasicInfo, GetFileInformationByHandle,
            GetFileInformationByHandleEx,
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        let mut basic: FILE_BASIC_INFO = unsafe { std::mem::zeroed() };
        // SAFETY: Both structures are correctly sized writable output storage; the borrowed file owns a live handle throughout both calls.
        let ok = unsafe {
            GetFileInformationByHandle(file.as_raw_handle(), &mut info) != 0
                && GetFileInformationByHandleEx(
                    file.as_raw_handle(),
                    FileBasicInfo,
                    (&mut basic as *mut FILE_BASIC_INFO).cast(),
                    std::mem::size_of::<FILE_BASIC_INFO>() as u32,
                ) != 0
        };
        if !ok {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(Identity {
            dev: info.dwVolumeSerialNumber as u64,
            ino: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
            size: metadata.len(),
            modified: (basic.LastWriteTime as i128 - 116444736000000000) * 100,
            changed: (basic.ChangeTime as i128 - 116444736000000000) * 100,
        })
    }
}
pub(crate) fn assert_expected_identity(actual: &Identity, request: &Value) -> CoreResult<()> {
    if let Some(expected) = request.get("expectedSourceIdentity") {
        for (name, value) in [
            ("dev", actual.dev.to_string()),
            ("ino", actual.ino.to_string()),
            ("size", actual.size.to_string()),
            ("mtimeNs", actual.modified.to_string()),
            ("ctimeNs", actual.changed.to_string()),
        ] {
            if expected[name].as_str() != Some(value.as_str()) {
                return Err(invalid(
                    "Die Backup-Quelldatei wurde während der Zugriffsprüfung verändert.",
                ));
            }
        }
    }
    Ok(())
}
pub(crate) fn safe_metadata(metadata: &Metadata) -> bool {
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return false;
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    true
}
pub(crate) fn open_source(path: &Path) -> CoreResult<File> {
    if !safe_metadata(&fs::symlink_metadata(path)?) {
        return Err(invalid(
            "Die Backup-Quelldatei ist keine sichere reguläre Datei.",
        ));
    }
    let (parent, name) = crate::storage::files::parent(path, false)?;
    let file = crate::storage::files::open_read(&parent, Path::new(&name))?.into_std();
    if !safe_metadata(&file.metadata()?) {
        return Err(invalid(
            "Die Backup-Quelldatei ist keine sichere reguläre Datei.",
        ));
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: The output structure is initialized and the file owns a valid live handle.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        if info.nNumberOfLinks != 1 {
            return Err(invalid(
                "Die Backup-Quelldatei besitzt mehrere Verknüpfungen.",
            ));
        }
    }
    Ok(file)
}
pub(crate) fn new_file(path: &Path) -> CoreResult<File> {
    let (parent, name) = crate::storage::files::parent(path, false)?;
    Ok(crate::storage::files::create_file(&parent, Path::new(&name))?.into_std())
}
pub(crate) fn temporary_directory(parent: &Path, prefix: &str) -> CoreResult<tempfile::TempDir> {
    let directory = tempfile::Builder::new().prefix(prefix).tempdir_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    }
    Ok(directory)
}
pub(crate) struct Budget<'a> {
    maximum: u64,
    written: u64,
    since_check: u64,
    directory: Option<&'a Path>,
}
pub(crate) fn available_capacity(directory: &Path) -> CoreResult<u64> {
    let result = (|| {
        // Capacity APIs may accept a nonexistent path on Windows. Bind both
        // sides of the lookup to the same existing, no-follow directory handle.
        let root = crate::storage::files::open_absolute(directory, false)?;
        let before = root.dir_metadata()?;
        let available = fs4::available_space(directory)?;
        let current = crate::storage::files::open_absolute(directory, false)?;
        if !crate::storage::files::same(&before, &current.dir_metadata()?) {
            return Err(invalid(
                "Das Importverzeichnis wurde während der Speicherprüfung ausgetauscht.",
            ));
        }
        Ok(available)
    })();
    result.map_err(|_: crate::protocol::CoreError| {
        crate::protocol::CoreError::new(
            "ARCHIVE_CAPACITY_UNAVAILABLE",
            "Der freie Speicher für den Backup-Import konnte nicht geprüft werden.",
        )
    })
}
impl<'a> Budget<'a> {
    pub fn new(request: &'a Value, maximum: u64) -> CoreResult<Self> {
        let allowed = request
            .get("maximumWriteBytes")
            .and_then(Value::as_u64)
            .unwrap_or(maximum);
        if allowed > super::MAX_CONTENT * 4 {
            return Err(invalid("Das Archivbudget ist ungültig."));
        }
        Ok(Self {
            maximum: allowed.min(maximum),
            written: 0,
            since_check: 0,
            directory: request
                .get("capacityDirectory")
                .and_then(Value::as_str)
                .map(Path::new),
        })
    }
    pub fn before(&mut self, bytes: u64, context: &OperationContext) -> CoreResult<()> {
        context.check()?;
        if bytes > self.maximum - self.written {
            return Err(crate::protocol::CoreError::new(
                "ARCHIVE_BUDGET_EXCEEDED",
                "Das Speicherbudget für den Backup-Import wurde überschritten.",
            ));
        }
        if self.written == 0 || self.since_check + bytes >= 16 * 1024 * 1024 {
            if let Some(directory) = self.directory {
                let available = available_capacity(directory)?;
                if available < self.maximum - self.written + 1024 * 1024 * 1024 {
                    return Err(crate::protocol::CoreError::new(
                        "ARCHIVE_CAPACITY_EXCEEDED",
                        "Für den Backup-Import steht nicht genügend freier Speicher bereit.",
                    ));
                }
            }
            self.since_check = 0;
        }
        self.written += bytes;
        self.since_check += bytes;
        Ok(())
    }
}
pub(crate) fn hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(output, "{byte:02x}").expect("Das Schreiben in eine Zeichenkette ist unfehlbar.");
    }
    output
}
pub(crate) fn checksum_matches(actual: &str, expected: &str) -> CoreResult<()> {
    use subtle::ConstantTimeEq;
    if expected.len() != 64
        || !expected.bytes().all(|b| b.is_ascii_hexdigit())
        || !bool::from(
            actual
                .as_bytes()
                .ct_eq(expected.to_ascii_lowercase().as_bytes()),
        )
    {
        return Err(invalid(
            "Die SHA-256-Prüfsumme des Backups stimmt nicht überein.",
        ));
    }
    Ok(())
}
pub(crate) fn copy_request(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let mut source = open_source(Path::new(text(request, "sourcePath")?))?;
    let before = identity(&source)?;
    assert_expected_identity(&before, request)?;
    let maximum = request
        .get("maximumBytes")
        .and_then(Value::as_u64)
        .unwrap_or(MAX_ARCHIVE)
        .min(MAX_ARCHIVE);
    if before.size > maximum {
        return Err(invalid("Die Backup-Kopie überschreitet das Größenlimit."));
    }
    let destination_path = Path::new(text(request, "destinationPath")?);
    let mut destination = new_file(destination_path)?;
    let result = (|| {
        let mut budget = Budget::new(request, before.size)?;
        let mut hash = Sha256::new();
        let mut buffer = [0; CHUNK];
        let mut size = 0;
        loop {
            context.check()?;
            let count = source.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            size += count as u64;
            if size > before.size {
                return Err(invalid(
                    "Die Backup-Quelldatei wurde währenddessen verändert.",
                ));
            }
            budget.before(count as u64, context)?;
            hash.update(&buffer[..count]);
            destination.write_all(&buffer[..count])?;
            context.progress(json!({"processedBytes":size,"totalBytes":before.size}))?;
        }
        if size != before.size || identity(&source)? != before {
            return Err(invalid(
                "Die Backup-Quelldatei wurde währenddessen verändert.",
            ));
        }
        let checksum = hex(&hash.finalize());
        if let Some(expected) = request
            .get("expectedChecksumSha256")
            .and_then(Value::as_str)
        {
            checksum_matches(&checksum, expected)?;
        }
        destination.sync_all()?;
        Ok(json!({"archiveSize":size,"checksumSha256":checksum}))
    })();
    drop(destination);
    if result.is_err() {
        fs::remove_file(destination_path)?;
    }
    result
}
