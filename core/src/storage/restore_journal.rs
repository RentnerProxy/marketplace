//! Retained-handle restore evidence. A session owns its original directory,
//! descriptor, canonical bytes and derived key until the final verification.
mod format;

use super::{files, string, success, workflows};
use crate::protocol::{CoreError, CoreResult, OperationContext};
use base64::{Engine, engine::general_purpose::STANDARD};
use cap_fs_ext::{DirExt, FollowSymlinks, MetadataExt, OpenOptionsFollowExt};
use cap_std::fs::{Dir, File, Metadata, OpenOptions};
use format::{Binding, Record};
use serde_json::Value;
use std::{
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

const DIRECTORY: &str = ".restore-journal-v1";
const MAX_BYTES: usize = 32 * 1024;

fn invalid() -> CoreError {
    CoreError::new(
        "RESTORE_JOURNAL_INVALID",
        "Der Restore-Journalnachweis ist ungültig oder beschädigt.",
    )
}

fn private(metadata: &Metadata, directory: bool) -> CoreResult<()> {
    if metadata.is_symlink()
        || (if directory {
            !metadata.is_dir()
        } else {
            !metadata.is_file() || metadata.nlink() != 1
        })
    {
        return Err(invalid());
    }
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt as _;
        if metadata.mode() & 0o077 != 0 {
            return Err(invalid());
        }
    }
    Ok(())
}

pub(crate) struct JournalSession {
    directory: Dir,
    directory_path: PathBuf,
    directory_identity: Metadata,
    file: File,
    file_identity: Metadata,
    name: String,
    binding: Binding,
    key: Zeroizing<[u8; 32]>,
    expected: Vec<u8>,
    previous: Option<Record>,
    poisoned: bool,
}

impl JournalSession {
    pub(crate) fn create(request: &Value, context: &OperationContext) -> CoreResult<Self> {
        context.check()?;
        // Validate secret and binding before acquiring filesystem resources.
        let binding = format::parse_binding(&request["binding"])?;
        let master = Zeroizing::new(
            STANDARD
                .decode(string(request, "masterKeyBase64")?)
                .map_err(|_| invalid())?,
        );
        if master.len() != 32 || STANDARD.encode(master.as_slice()) != request["masterKeyBase64"] {
            return Err(invalid());
        }
        let key = format::derive(&master);
        let roots = workflows::backup_roots(request, context)?;
        match files::create_directory(&roots.backup, Path::new(DIRECTORY)) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(error) => return Err(error.into()),
        }
        let directory = roots.backup.open_dir_nofollow(DIRECTORY)?;
        let directory_identity = directory.dir_metadata()?;
        private(&directory_identity, true)?;
        files::sync_dir(&roots.backup)?;
        let directory_path = roots.backup_path.join(DIRECTORY);
        files::assert_location(&directory_path, &directory)?;
        let name = format!("{}.jsonl", binding.restore_run_id);
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = directory.open_with(&name, &options)?;
        let file_identity = file.metadata()?;
        private(&file_identity, false)?;
        let mut session = Self {
            directory,
            directory_path,
            directory_identity,
            file,
            file_identity,
            name,
            binding,
            key,
            expected: Vec::new(),
            previous: None,
            poisoned: false,
        };
        session.append("started", context)?;
        files::sync_dir(&session.directory)?;
        session.assert_content()?;
        Ok(session)
    }

    fn assert_content(&mut self) -> CoreResult<()> {
        files::assert_location(&self.directory_path, &self.directory)?;
        let directory = self.directory.dir_metadata()?;
        private(&directory, true)?;
        if !files::same(&directory, &self.directory_identity) {
            return Err(invalid());
        }
        let named = self.directory.symlink_metadata(&self.name)?;
        let descriptor = self.file.metadata()?;
        for metadata in [&named, &descriptor] {
            private(metadata, false)?;
            if !files::same(metadata, &self.file_identity)
                || metadata.len() != self.expected.len() as u64
            {
                return Err(invalid());
            }
        }
        if self.expected.len() > MAX_BYTES {
            return Err(invalid());
        }
        self.file.seek(SeekFrom::Start(0))?;
        let mut actual = Vec::new();
        (&mut self.file)
            .take(self.expected.len() as u64 + 1)
            .read_to_end(&mut actual)?;
        if actual != self.expected {
            return Err(invalid());
        }
        let named = self.directory.symlink_metadata(&self.name)?;
        private(&named, false)?;
        if !files::same(&named, &self.file_identity) || named.len() != self.expected.len() as u64 {
            return Err(invalid());
        }
        if !self.expected.is_empty() {
            format::validate(&self.expected, &self.binding, self.key.as_ref())?;
        }
        Ok(())
    }

    pub(crate) fn append(&mut self, event: &str, context: &OperationContext) -> CoreResult<Value> {
        if self.poisoned {
            return Err(invalid());
        }
        let result = (|| {
            context.check()?;
            let record = format::next(
                &self.binding,
                self.previous.as_ref(),
                event,
                self.key.as_ref(),
            )?;
            let serialized = format::serialize(&record)?;
            if self.expected.len() + serialized.len() > MAX_BYTES {
                return Err(invalid());
            }
            self.assert_content()?;
            self.file
                .seek(SeekFrom::Start(self.expected.len() as u64))?;
            // write_all completes short writes and rejects zero writes;
            // fsync precedes every acknowledgement.
            self.file.write_all(&serialized)?;
            self.file.sync_all()?;
            self.expected.extend_from_slice(&serialized);
            self.assert_content()?;
            self.previous = Some(record);
            Ok(success())
        })();
        if result.is_err() {
            self.poisoned = true;
        }
        result
    }

    pub(crate) fn close(&mut self, context: &OperationContext) -> CoreResult<Value> {
        context.check()?;
        if self.poisoned {
            return Err(invalid());
        }
        self.assert_content()?;
        // Rust closes on Drop. Report final persistence failures explicitly;
        // the protocol driver drops descriptor and key before acknowledging.
        self.file.sync_all()?;
        Ok(success())
    }
}

#[cfg(test)]
#[path = "../../tests/unit/storage_restore_journal.rs"]
mod tests;
