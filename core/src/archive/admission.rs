use super::{MAX_ARCHIVE, crypto::ENVELOPE_OVERHEAD, files, invalid, text};
use crate::protocol::{CoreError, CoreResult, OperationContext};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    token: String,
    maximum: u64,
    written: u64,
    since_check: u64,
    deadline: u64,
    incomplete: bool,
}
fn now() -> CoreResult<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| invalid("Die Systemzeit ist ungültig."))?
        .as_millis() as u64)
}
fn capacity(directory: &Path, remaining: u64) -> CoreResult<()> {
    if files::available_capacity(directory)? < remaining + 1024 * 1024 * 1024 {
        return Err(CoreError::new(
            "ARCHIVE_CAPACITY_EXCEEDED",
            "Für den Backup-Import steht nicht genügend freier Speicher bereit.",
        ));
    }
    Ok(())
}
pub(crate) fn execute(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    context.check()?;
    let directory = Path::new(text(request, "directory")?);
    let state_path = directory.join("admission.json");
    let operation = text(request, "operation")?;
    if operation == "admissionAcquire" {
        let maximum = request["maximumUploadBytes"]
            .as_u64()
            .filter(|size| *size <= MAX_ARCHIVE)
            .ok_or_else(|| invalid("Ungültiges Backup-Importbudget."))?;
        let (parent, name) = crate::storage::files::parent(directory, false)?;
        match crate::storage::files::create_directory(&parent, Path::new(&name)) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(CoreError::new(
                    "ARCHIVE_IMPORT_BUSY",
                    "Es läuft bereits ein Backup-Import oder dessen Bereinigung ist noch offen.",
                ));
            }
            Err(error) => return Err(error.into()),
        }
        let result = (|| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
            }
            let maximum = if request["forRestore"].as_bool() == Some(true) {
                maximum + 2 * maximum.saturating_sub(ENVELOPE_OVERHEAD)
            } else {
                maximum
            };
            capacity(directory, maximum)?;
            let mut random = [0; 32];
            getrandom::fill(&mut random)
                .map_err(|_| invalid("Die Importzulassung konnte nicht erstellt werden."))?;
            let state = State {
                token: files::hex(&random),
                maximum,
                written: 0,
                since_check: 0,
                deadline: now()? + 60 * 60 * 1000,
                incomplete: false,
            };
            let mut file = files::new_file(&state_path)?;
            serde_json::to_writer(&mut file, &state)?;
            file.sync_all()?;
            Ok(json!({"token":state.token}))
        })();
        if result.is_err() {
            if state_path.exists() {
                fs::remove_file(&state_path)?;
            }
            fs::remove_dir(directory)?;
        }
        return result;
    }
    let meta = fs::symlink_metadata(directory)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(invalid(
            "Das Importverzeichnis ist kein echtes Verzeichnis.",
        ));
    }
    if !files::safe_metadata(&fs::symlink_metadata(&state_path)?) {
        return Err(invalid("Die Importzulassung ist unsicher."));
    }
    let owner = crate::storage::files::open_absolute(directory, false)?;
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true).write(true);
    cap_fs_ext::OpenOptionsFollowExt::follow(&mut options, cap_fs_ext::FollowSymlinks::No);
    let mut file = owner.open_with("admission.json", &options)?.into_std();
    loop {
        context.check()?;
        match file.try_lock() {
            Ok(()) => break,
            Err(std::fs::TryLockError::WouldBlock) => {
                std::thread::sleep(std::time::Duration::from_millis(25))
            }
            Err(std::fs::TryLockError::Error(error)) => return Err(error.into()),
        }
    }
    if file.metadata()?.len() > 4096 {
        return Err(invalid("Die Importzulassung ist ungültig."));
    }
    let mut encoded = String::new();
    file.read_to_string(&mut encoded)?;
    let mut state: State = serde_json::from_str(&encoded)?;
    use subtle::ConstantTimeEq;
    if !bool::from(
        state
            .token
            .as_bytes()
            .ct_eq(text(request, "token")?.as_bytes()),
    ) {
        return Err(invalid("Die Importzulassung ist ungültig."));
    }
    if operation == "admissionRelease" {
        if state.incomplete {
            return Err(CoreError::new(
                "ARCHIVE_CLEANUP_INCOMPLETE",
                "Die Importbereinigung ist unvollständig; weitere Imports bleiben gesperrt.",
            ));
        }
        drop(file);
        drop(owner);
        fs::remove_file(state_path).map_err(|_| {
            CoreError::new(
                "ARCHIVE_CLEANUP_INCOMPLETE",
                "Die Importzulassung konnte nicht vollständig entfernt werden.",
            )
        })?;
        fs::remove_dir(directory).map_err(|_| {
            CoreError::new(
                "ARCHIVE_CLEANUP_INCOMPLETE",
                "Das Importverzeichnis konnte nicht vollständig entfernt werden.",
            )
        })?;
        return Ok(Value::Null);
    }
    if operation == "admissionMarkIncomplete" {
        state.incomplete = true;
    } else {
        if now()? > state.deadline {
            return Err(CoreError::new(
                "CORE_CANCELLED",
                "Der Backup-Import wurde abgebrochen.",
            ));
        }
        let bytes = request["byteLength"]
            .as_u64()
            .ok_or_else(|| invalid("Das Importbudget ist ungültig."))?;
        if state.written > state.maximum || bytes > state.maximum - state.written {
            return Err(CoreError::new(
                "ARCHIVE_BUDGET_EXCEEDED",
                "Das Speicherbudget für den Backup-Import wurde überschritten.",
            ));
        }
        if state.written == 0 || state.since_check + bytes >= 16 * 1024 * 1024 {
            capacity(directory, state.maximum - state.written)?;
            state.since_check = 0;
        }
        state.written += bytes;
        state.since_check += bytes;
    }
    file.seek(SeekFrom::Start(0))?;
    file.set_len(0)?;
    serde_json::to_writer(&mut file, &state)?;
    file.sync_all()?;
    Ok(Value::Null)
}
