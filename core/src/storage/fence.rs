//! Durable, process-independent admission. An uncertain publication is retained
//! for verified operator recovery; elapsed time never transfers ownership.
use super::{files, invalid, string, success};
use crate::protocol::{CoreError, CoreResult, OperationContext};
use cap_fs_ext::{DirExt, MetadataExt};
use cap_std::fs::{Dir, File, Metadata};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::Read,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const MAX_BYTES: u64 = 256;
const MAX_ENTRIES: usize = 1024;
const SHARED: &str = "shared";
const ADMISSION: &str = "admission";
const OWNER_FILE: &str = "owner.json";
const EXCLUSIVE_FILE: &str = "exclusive.json";

fn unavailable() -> CoreError {
    CoreError::new(
        "STORAGE_MUTATION_FENCE_UNAVAILABLE",
        "Storage admission requires verified operator recovery.",
    )
}
fn busy() -> CoreError {
    CoreError::new(
        "STORAGE_MUTATION_ADMISSION_BUSY",
        "Storage admission is busy.",
    )
}
fn hook(point: &str) -> CoreResult<()> {
    #[cfg(test)]
    tests::hook(point)?;
    let _ = point;
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u8,
    kind: String,
    owner: String,
}
impl Record {
    fn new(kind: &str) -> Self {
        Self {
            version: 1,
            kind: kind.into(),
            owner: uuid::Uuid::new_v4().to_string(),
        }
    }
    fn valid(&self, kind: &str) -> bool {
        self.version == 1 && self.kind == kind && owner_valid(&self.owner)
    }
}
fn owner_valid(owner: &str) -> bool {
    uuid::Uuid::parse_str(owner).is_ok_and(|id| {
        id.get_version_num() == 4
            && id.get_variant() == uuid::Variant::RFC4122
            && id.to_string() == owner
    })
}
fn parse_record(bytes: &[u8], kind: &str) -> CoreResult<Record> {
    let record: Record = serde_json::from_slice(bytes)?;
    if !record.valid(kind) || serde_json::to_vec(&record)? != bytes {
        return Err(invalid());
    }
    Ok(record)
}
fn mode(metadata: &Metadata, expected: u32) -> bool {
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        metadata.mode() & 0o7777 == expected
    }
    #[cfg(not(unix))]
    {
        let _ = (metadata, expected);
        true
    }
}
fn unchanged(before: &Metadata, after: &Metadata) -> CoreResult<bool> {
    let equal = files::same(before, after)
        && before.len() == after.len()
        && before.modified()? == after.modified()?
        && after.nlink() == 1;
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        Ok(equal && before.ctime() == after.ctime() && before.ctime_nsec() == after.ctime_nsec())
    }
    #[cfg(not(unix))]
    {
        Ok(equal)
    }
}

struct Directory {
    path: PathBuf,
    handle: Dir,
    identity: Value,
}
impl Directory {
    fn snapshot(&self) -> Value {
        json!({"path":self.path,"identity":self.identity})
    }
    fn assert(&self) -> CoreResult<()> {
        files::assert_location(&self.path, &self.handle)?;
        let metadata = self.handle.dir_metadata()?;
        if files::identity(&metadata)? != self.identity || !mode(&metadata, 0o700) {
            return Err(invalid());
        }
        Ok(())
    }
    fn sync(&self) -> CoreResult<()> {
        self.assert()?;
        hook("directorySync")?;
        files::sync_dir(&self.handle)?;
        self.assert()
    }
}
struct Fence {
    root: Directory,
    shared: Directory,
}
impl Fence {
    fn open(root: &Path, expected: Option<&Value>) -> CoreResult<Self> {
        let initialize = expected.is_none();
        let root_handle = files::open_absolute(root, initialize)?;
        let permissions = if initialize {
            files::assert_location(root, &root_handle)?;
            files::prepare_private_directory(&root_handle)?;
            files::DirectoryPermissions::PreparePrivate
        } else {
            files::verify_private_directory(&root_handle.dir_metadata()?)?;
            files::DirectoryPermissions::Private
        };
        let shared_handle =
            files::descend(&root_handle, Path::new(SHARED), initialize, permissions)?;
        let root_identity = files::identity(&root_handle.dir_metadata()?)?;
        let shared_identity = files::identity(&shared_handle.dir_metadata()?)?;
        let fence = Self {
            root: Directory {
                path: root.into(),
                handle: root_handle,
                identity: root_identity,
            },
            shared: Directory {
                path: root.join(SHARED),
                handle: shared_handle,
                identity: shared_identity,
            },
        };
        fence.assert()?;
        if let Some(expected) = expected
            && fence.context() != *expected
        {
            return Err(invalid());
        }
        Ok(fence)
    }
    fn context(&self) -> Value {
        json!({"rootDirectory":self.root.path,"sharedDirectory":self.shared.path,"directories":[self.root.snapshot(),self.shared.snapshot()]})
    }
    fn assert(&self) -> CoreResult<()> {
        self.root.assert()?;
        self.shared.assert()
    }
    fn lease(&self, file: Value) -> Value {
        json!({"context":self.context(),"file":file})
    }
    fn has_exclusive(&self) -> CoreResult<bool> {
        self.assert()?;
        match read_control(&self.root, EXCLUSIVE_FILE, "exclusive", None) {
            Ok(_) => Ok(true),
            Err(error) if error.code == "ENOENT" => Ok(false),
            Err(error) => Err(error),
        }
    }
    fn reuse_shared(&self, lease: &Value) -> CoreResult<Value> {
        self.assert_entries()?;
        let (directory, name, _) = lease_file(self, lease, Some(SHARED))?;
        read_control(directory, &name, SHARED, Some(&lease["file"]))?;

        // The caller retains this published lease until revalidation finishes.
        // An exclusive owner publishing after the absence check must drain it
        // before entering. Presence also covers a partially published record.
        for (name, is_directory) in [(ADMISSION, true), (EXCLUSIVE_FILE, false)] {
            match self.root.handle.symlink_metadata(name) {
                Ok(metadata)
                    if (is_directory && metadata.is_dir() && mode(&metadata, 0o700))
                        || (!is_directory
                            && metadata.is_file()
                            && metadata.nlink() == 1
                            && mode(&metadata, 0o600)) =>
                {
                    return Err(busy());
                }
                Ok(_) => return Err(invalid()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.into()),
            }
        }
        self.assert()?;
        Ok(lease.clone())
    }
    fn has_shared(&self) -> CoreResult<bool> {
        self.assert()?;
        for (index, entry) in self.shared.handle.entries()?.enumerate() {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_str().ok_or_else(invalid)?;
            let owner = name.strip_suffix(".json").ok_or_else(invalid)?;
            let kind = entry.file_type()?;
            if index >= MAX_ENTRIES || !owner_valid(owner) || !kind.is_file() || kind.is_symlink() {
                return Err(invalid());
            }
            match read_control(&self.shared, name, SHARED, None) {
                Ok(file) => {
                    if file["metadata"]["owner"] != owner {
                        return Err(invalid());
                    }
                    self.assert()?;
                    return Ok(true);
                }
                Err(error) if error.code == "ENOENT" => (),
                Err(error) => return Err(error),
            }
        }
        self.assert()?;
        Ok(false)
    }
    fn assert_entries(&self) -> CoreResult<()> {
        self.assert()?;
        for (index, entry) in self.root.handle.entries()?.enumerate() {
            let entry = entry?;
            if index >= MAX_ENTRIES {
                return Err(invalid());
            }
            let name = entry.file_name();
            let name = name.to_str().ok_or_else(invalid)?;
            assert_entry_type(name, entry.file_type())?;
        }
        self.assert()
    }
}

fn assert_entry_type(name: &str, kind: std::io::Result<cap_std::fs::FileType>) -> CoreResult<()> {
    let kind = match kind {
        Err(error) if name == ADMISSION && error.kind() == std::io::ErrorKind::NotFound => {
            return Err(busy());
        }
        result => result?,
    };
    if kind.is_symlink()
        || match name {
            SHARED | ADMISSION => !kind.is_dir(),
            EXCLUSIVE_FILE => !kind.is_file(),
            _ => true,
        }
    {
        return Err(invalid());
    }
    Ok(())
}

// Closing is observable: after an unconfirmed close we must not remove the
// verified name. Taking ownership of the raw descriptor prevents a second close.
fn close_checked(file: File) -> CoreResult<()> {
    let file = file.into_std();
    #[cfg(unix)]
    {
        use std::os::fd::IntoRawFd;
        let descriptor = file.into_raw_fd();
        // SAFETY: the owned, live descriptor is consumed exactly once. Never
        // retry close after EINTR because the descriptor may already be reused.
        if unsafe { libc::close(descriptor) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::IntoRawHandle;
        let handle = file.into_raw_handle();
        // SAFETY: IntoRawHandle transfers exclusive ownership of this valid
        // file handle; CloseHandle consumes it once and no Rust owner remains.
        if unsafe { windows_sys::Win32::Foundation::CloseHandle(handle) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    hook("close")
}

#[cfg(windows)]
fn change_time(file: &File) -> CoreResult<i64> {
    use std::{
        mem::{MaybeUninit, size_of},
        os::windows::io::AsRawHandle,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_BASIC_INFO, FileBasicInfo, GetFileInformationByHandleEx,
    };
    let mut information = MaybeUninit::<FILE_BASIC_INFO>::uninit();
    // SAFETY: the borrowed file owns a live handle for the whole call. Windows
    // receives correctly aligned writable storage with its exact declared size;
    // the structure is read only after the API confirms complete initialization.
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileBasicInfo,
            information.as_mut_ptr().cast(),
            size_of::<FILE_BASIC_INFO>() as u32,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    // SAFETY: GetFileInformationByHandleEx succeeded and initialized this value.
    Ok(unsafe { information.assume_init() }.ChangeTime)
}

fn check_unlinked(directory: &Directory, name: &str, metadata: &Metadata) -> CoreResult<()> {
    // Even a successful path stat can observe zero links when unlink wins
    // after name resolution. Ignore removal only while the name is absent;
    // a replacement under that name must still fail closed.
    if metadata.nlink() == 0 {
        directory.handle.symlink_metadata(name)?;
        return Err(invalid());
    }
    Ok(())
}

fn read_control(
    directory: &Directory,
    name: &str,
    kind: &str,
    expected: Option<&Value>,
) -> CoreResult<Value> {
    directory.assert()?;
    let before = directory.handle.symlink_metadata(name)?;
    check_unlinked(directory, name, &before)?;
    if !before.is_file()
        || before.is_symlink()
        || before.nlink() != 1
        || before.len() == 0
        || before.len() > MAX_BYTES
        || !mode(&before, 0o600)
    {
        return Err(invalid());
    }
    let identity = files::identity(&before)?;
    if let Some(expected) = expected
        && (expected["path"] != json!(directory.path.join(name))
            || expected["identity"] != identity)
    {
        return Err(invalid());
    }
    let file = files::open_read(&directory.handle, Path::new(name))?;
    #[cfg(windows)]
    let before_change = change_time(&file)?;
    let result = (|| {
        hook("openedRead")?;
        let opened = file.metadata()?;
        check_unlinked(directory, name, &opened)?;
        if !opened.is_file() || !unchanged(&before, &opened)? || !mode(&opened, 0o600) {
            return Err(invalid());
        }
        let mut bytes = Vec::new();
        (&file).take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 != before.len() {
            return Err(invalid());
        }
        let record = parse_record(&bytes, kind)?;
        if let Some(expected) = expected
            && expected["metadata"] != serde_json::to_value(&record)?
        {
            return Err(invalid());
        }
        let after = file.metadata()?;
        check_unlinked(directory, name, &after)?;
        if !unchanged(&before, &after)? {
            return Err(invalid());
        }
        #[cfg(windows)]
        if before_change != change_time(&file)? {
            return Err(invalid());
        }
        Ok(record)
    })();
    let close = close_checked(file);
    let record = result?;
    close?;
    let at_path = directory.handle.symlink_metadata(name)?;
    check_unlinked(directory, name, &at_path)?;
    if !at_path.is_file()
        || at_path.is_symlink()
        || !unchanged(&before, &at_path)?
        || !mode(&at_path, 0o600)
    {
        return Err(invalid());
    }
    #[cfg(windows)]
    {
        let at_path_file = files::open_read(&directory.handle, Path::new(name))?;
        let stable = files::same(&before, &at_path_file.metadata()?)
            && before_change == change_time(&at_path_file)?;
        close_checked(at_path_file)?;
        if !stable {
            return Err(invalid());
        }
    }
    directory.assert()?;
    Ok(json!({"path":directory.path.join(name),"identity":identity,"metadata":record}))
}
fn create_control(
    fence: &Fence,
    directory: &Directory,
    name: &str,
    kind: &str,
    owner: Option<&str>,
) -> CoreResult<Value> {
    fence.assert()?;
    directory.assert()?;
    let mut record = Record::new(kind);
    if let Some(owner) = owner {
        record.owner = owner.into();
    }
    let bytes = serde_json::to_vec(&record)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(invalid());
    }
    hook("beforeCreate")?;
    let mut file = files::create_file(&directory.handle, Path::new(name))?;
    let result = (|| {
        let created = file.metadata()?;
        if created.nlink() != 1 || !mode(&created, 0o600) {
            return Err(invalid());
        }
        fence.assert()?;
        directory.assert()?;
        if !files::same(&created, &directory.handle.symlink_metadata(name)?) {
            return Err(invalid());
        }
        hook("write")?;
        file.write_all(&bytes)?;
        hook("fileSync")?;
        file.sync_all()?;
        Ok(
            json!({"path":directory.path.join(name),"identity":files::identity(&created)?,"metadata":record}),
        )
    })();
    let close = close_checked(file);
    let expected = result?;
    close?;
    fence.assert()?;
    read_control(directory, name, kind, Some(&expected))
}
struct Gate {
    directory: Directory,
    file: Value,
}
fn try_gate(fence: &Fence) -> CoreResult<Option<Gate>> {
    fence.assert_entries()?;
    match files::create_directory(&fence.root.handle, Path::new(ADMISSION)) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            hook("gateExists")?;
            match fence.root.handle.open_dir_nofollow(ADMISSION) {
                Ok(directory) if mode(&directory.dir_metadata()?, 0o700) => (),
                Ok(_) => return Err(invalid()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.into()),
            }
            fence.assert()?;
            return Ok(None);
        }
        Err(error) => return Err(error.into()),
    }
    let handle = fence.root.handle.open_dir_nofollow(ADMISSION)?;
    let identity = files::identity(&handle.dir_metadata()?)?;
    files::secure_directory(&handle)?;
    let directory = Directory {
        path: fence.root.path.join(ADMISSION),
        handle,
        identity,
    };
    let file = create_control(fence, &directory, OWNER_FILE, ADMISSION, None)?;
    directory.sync()?;
    fence.root.sync()?;
    Ok(Some(Gate { directory, file }))
}
fn acquire_gate(
    fence: &Fence,
    try_only: bool,
    context: &OperationContext,
) -> CoreResult<Option<Gate>> {
    let deadline = Instant::now() + Duration::from_millis(1000);
    loop {
        context.check()?;
        let gate = try_gate(fence)?;
        if gate.is_some() || try_only {
            return Ok(gate);
        }
        if Instant::now() >= deadline {
            return Err(busy());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}
fn release_gate(fence: &Fence, gate: Gate) -> CoreResult<()> {
    fence.assert()?;
    read_control(&gate.directory, OWNER_FILE, ADMISSION, Some(&gate.file))?;
    hook("gateUnlink")?;
    gate.directory.handle.remove_file(OWNER_FILE)?;
    gate.directory.assert()?;
    hook("gateRemove")?;
    // cap-std Windows directory handles deliberately deny delete sharing.
    // Verify the pinned directory before closing it for the final rmdir.
    drop(gate.directory);
    fence.root.handle.remove_dir(ADMISSION)?;
    fence.assert()?;
    fence.root.sync()
}
fn lease_file<'a>(
    fence: &'a Fence,
    lease: &Value,
    required_kind: Option<&str>,
) -> CoreResult<(&'a Directory, String, String)> {
    if lease["context"] != fence.context() {
        return Err(invalid());
    }
    let record: Record = serde_json::from_value(lease["file"]["metadata"].clone())?;
    if !record.valid(&record.kind)
        || !matches!(record.kind.as_str(), SHARED | "exclusive")
        || required_kind.is_some_and(|kind| record.kind != kind)
    {
        return Err(invalid());
    }
    let (directory, name) = if record.kind == SHARED {
        (&fence.shared, format!("{}.json", record.owner))
    } else {
        (&fence.root, EXCLUSIVE_FILE.into())
    };
    if lease["file"]["path"] != json!(directory.path.join(&name)) {
        return Err(invalid());
    }
    Ok((directory, name, record.kind))
}
fn execute_inner(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    context.check()?;
    match string(request, "operation")? {
        "fenceAdmitShared" | "fenceAcquireExclusive" => {
            let shared = request["operation"] == "fenceAdmitShared";
            let current = request.get("currentLease").filter(|value| !value.is_null());
            if !shared && current.is_some() {
                return Err(invalid());
            }
            let root = files::absolute(string(request, "rootDirectory")?)?;
            let fence = Fence::open(&root, current.map(|lease| &lease["context"]))?;
            if let Some(lease) = current {
                return fence.reuse_shared(lease);
            }
            let try_only = if shared {
                true
            } else {
                request["tryOnly"].as_bool().ok_or_else(invalid)?
            };
            let Some(gate) = acquire_gate(&fence, try_only, context)? else {
                return if shared { Err(busy()) } else { Ok(Value::Null) };
            };
            if fence.has_exclusive()? {
                release_gate(&fence, gate)?;
                return if !shared && try_only {
                    Ok(Value::Null)
                } else {
                    Err(busy())
                };
            }
            if !shared && try_only && fence.has_shared()? {
                release_gate(&fence, gate)?;
                return Ok(Value::Null);
            }
            let directory = if shared { &fence.shared } else { &fence.root };
            // File names use the same owner as the canonical file bytes.
            let owner = uuid::Uuid::new_v4().to_string();
            let name = if shared {
                format!("{owner}.json")
            } else {
                EXCLUSIVE_FILE.into()
            };
            let file = create_control(
                &fence,
                directory,
                &name,
                if shared { SHARED } else { "exclusive" },
                Some(&owner),
            )?;
            directory.sync()?;
            release_gate(&fence, gate)?;
            Ok(fence.lease(file))
        }
        "fenceRelease" | "fenceDrain" => {
            let lease = &request["lease"];
            let root = files::absolute(string(&lease["context"], "rootDirectory")?)?;
            let fence = Fence::open(&root, Some(&lease["context"]))?;
            let drain = request["operation"] == "fenceDrain";
            let (directory, name, kind) = lease_file(&fence, lease, drain.then_some("exclusive"))?;
            loop {
                context.check()?;
                fence.assert()?;
                read_control(directory, &name, &kind, Some(&lease["file"]))?;
                if !drain {
                    hook("leaseUnlink")?;
                    directory.handle.remove_file(&name)?;
                    directory.sync()?;
                    fence.assert()?;
                    return Ok(success());
                }
                if !fence.has_shared()? {
                    read_control(directory, &name, &kind, Some(&lease["file"]))?;
                    if !fence.has_shared()? {
                        return Ok(success());
                    }
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        _ => Err(invalid()),
    }
}

pub(crate) fn execute(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    execute_inner(request, context).map_err(|error| match error.code.as_str() {
        "STORAGE_MUTATION_ADMISSION_BUSY" | "CORE_CANCELLED" => error,
        _ => unavailable(),
    })
}

#[cfg(test)]
#[path = "../../tests/unit/storage_fence.rs"]
mod tests;
