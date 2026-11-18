use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::io::{self, BufRead, Write};

const CONTROL_LIMIT: usize = 4096;
pub const ROOT_LIMIT: usize = 512 * 1024;
pub const CATALOG_LIMIT: usize = 16 * 1024 * 1024;
pub const ICON_LIMIT: usize = 2 * 1024 * 1024;
pub const ICON_TOTAL_LIMIT: usize = 64 * 1024 * 1024;
const TIMESTAMP_LIMIT: usize = 32 * 1024;
const SNAPSHOT_LIMIT: usize = 128 * 1024;
const TARGETS_LIMIT: usize = 4 * 1024 * 1024;
pub const FILE_TOTAL_LIMIT: usize = ICON_TOTAL_LIMIT
    + CATALOG_LIMIT
    + ROOT_LIMIT
    + TIMESTAMP_LIMIT
    + SNAPSHOT_LIMIT
    + TARGETS_LIMIT;
pub const MAX_ICONS: usize = 4096;
pub const MAX_FILES: usize = MAX_ICONS + 5;
pub const MAX_REQUESTS: usize = MAX_ICONS + 1024 + 6;
pub const MAX_GENERATION: u64 = (1 << 53) - 1;

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    Read {
        now: Option<String>,
        allow_expired_roles: bool,
        next_root: bool,
    },
    Update {
        generation: u64,
        now: Option<String>,
        next_root: bool,
        icons: usize,
    },
    Bootstrap {
        now: Option<String>,
    },
}

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Reply<'a> {
    Request { path: &'a str, max_bytes: usize },
    Catalog { generation: u64 },
    Files { count: usize },
    Error { message: &'a str },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum FileReply {
    File { found: bool },
    FileError,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FilePath<T> {
    pub path: T,
}

pub struct Pipe<R, W> {
    reader: R,
    writer: W,
}

impl<R: BufRead, W: Write> Pipe<R, W> {
    pub fn new(reader: R, writer: W) -> Self {
        Self { reader, writer }
    }

    pub fn command(&mut self) -> io::Result<Option<Command>> {
        self.next_frame(CONTROL_LIMIT)?
            .map(|bytes| decode(&bytes))
            .transpose()
    }

    pub fn control<T: DeserializeOwned>(&mut self) -> io::Result<T> {
        decode(&self.bytes(CONTROL_LIMIT)?)
    }

    pub fn bytes(&mut self, max: usize) -> io::Result<Vec<u8>> {
        self.next_frame(max)?.ok_or_else(invalid_frame)
    }

    fn next_frame(&mut self, max: usize) -> io::Result<Option<Vec<u8>>> {
        let mut prefix = [0; 4];
        match self.reader.read_exact(&mut prefix[..1]) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(error) => return Err(error),
        }
        self.reader.read_exact(&mut prefix[1..])?;
        let len = u32::from_be_bytes(prefix) as usize;
        if len > max {
            return Err(invalid_frame());
        }
        let mut bytes = vec![0; len];
        self.reader.read_exact(&mut bytes)?;
        Ok(Some(bytes))
    }

    pub fn send_control<T: Serialize>(&mut self, value: T) -> io::Result<()> {
        let bytes = serde_json::to_vec(&value).map_err(|_| invalid_frame())?;
        if bytes.len() > CONTROL_LIMIT {
            return Err(invalid_frame());
        }
        self.send_bytes(&bytes)
    }

    pub fn send_bytes(&mut self, bytes: &[u8]) -> io::Result<()> {
        let len = u32::try_from(bytes.len()).map_err(|_| invalid_frame())?;
        if len == 0 {
            return Err(invalid_frame());
        }
        self.writer.write_all(&len.to_be_bytes())?;
        self.writer.write_all(bytes)
    }

    pub fn flush(&mut self) -> io::Result<()> {
        self.writer.flush()
    }
}

pub fn invalid_frame() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid catalog IPC frame")
}

fn decode<T: DeserializeOwned>(bytes: &[u8]) -> io::Result<T> {
    serde_json::from_slice(bytes).map_err(|_| invalid_frame())
}

fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn icon_file(name: &str) -> Option<&str> {
    let (stem, extension) = name.rsplit_once('.')?;
    matches!(extension, "png" | "webp").then_some(stem)
}

pub fn logical_icon_path(path: &str) -> bool {
    path.strip_prefix("assets/")
        .and_then(icon_file)
        .is_some_and(hash)
}

pub fn static_file_limit(path: &str) -> Option<usize> {
    if path == "metadata/timestamp.json" {
        return Some(TIMESTAMP_LIMIT);
    }
    if let Some(metadata) = path.strip_prefix("metadata/") {
        let (version, role) = metadata.strip_suffix(".json")?.split_once('.')?;
        if version.starts_with('0')
            || !version.bytes().all(|byte| byte.is_ascii_digit())
            || !(1..=MAX_GENERATION).contains(&version.parse::<u64>().ok()?)
        {
            return None;
        }
        return match role {
            "root" => Some(ROOT_LIMIT),
            "snapshot" => Some(SNAPSHOT_LIMIT),
            "targets" => Some(TARGETS_LIMIT),
            _ => None,
        };
    }
    if let Some(icon) = path.strip_prefix("targets/assets/") {
        let (prefix, name) = icon_file(icon)?.split_once('.')?;
        if hash(prefix) && hash(name) {
            return Some(ICON_LIMIT);
        }
    }
    path.strip_prefix("targets/")
        .and_then(|name| name.strip_suffix(".catalog.json"))
        .filter(|name| hash(name))
        .map(|_| CATALOG_LIMIT)
}
