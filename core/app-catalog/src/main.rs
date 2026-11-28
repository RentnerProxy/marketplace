mod candidate_zip;
mod ipc;

use ipc::{
    CATALOG_LIMIT, Command, FILE_TOTAL_LIMIT, FilePath, FileReply, ICON_LIMIT, ICON_TOTAL_LIMIT,
    MAX_FILES, MAX_GENERATION, MAX_ICONS, MAX_REQUESTS, Pipe, ROOT_LIMIT, Reply, invalid_frame,
    logical_icon_path, static_file_limit,
};
use rentnerproxy_app_catalog::{
    CatalogError, ReadOptions, SigningKeys, TrustedCatalog, UpdateOptions, bootstrap_catalog,
    read_catalog, update_catalog,
};
use std::collections::BTreeMap;
use std::env;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::process::ExitCode;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use zeroize::Zeroizing;

struct Worker<R, W> {
    pipe: Pipe<R, W>,
    keys: Result<SigningKeys, CatalogError>,
    trusted: Option<(u64, TrustedCatalog)>,
}

impl<R: BufRead, W: Write> Worker<R, W> {
    fn run(&mut self) -> io::Result<()> {
        while let Some(command) = self.pipe.command()? {
            match command {
                Command::Read {
                    now,
                    allow_expired_roles,
                    next_root,
                } => self.read(now, allow_expired_roles, next_root)?,
                Command::Update {
                    generation,
                    now,
                    next_root,
                    icons,
                } => self.update(generation, now, next_root, icons)?,
                Command::Bootstrap { now } => self.bootstrap(now)?,
            }
            self.pipe.flush()?;
        }
        Ok(())
    }

    fn optional_root(&mut self, present: bool) -> io::Result<Option<Vec<u8>>> {
        present.then(|| self.pipe.bytes(ROOT_LIMIT)).transpose()
    }

    fn read(
        &mut self,
        now: Option<String>,
        allow_expired_roles: bool,
        next_root: bool,
    ) -> io::Result<()> {
        let pinned_root = self.pipe.bytes(ROOT_LIMIT)?;
        let next_root = self.optional_root(next_root)?;
        let now = match parse_now(now.as_deref()) {
            Ok(now) => now,
            Err(error) => return self.send_error(&error),
        };
        let mut requests = 0;
        let mut failure = None;
        let result = read_catalog(
            |path, max_bytes| {
                requests += 1;
                let bytes = if failure.is_some() || requests > MAX_REQUESTS {
                    Err(invalid_frame())
                } else {
                    request_file(&mut self.pipe, path, max_bytes)
                };
                bytes.unwrap_or_else(|error| {
                    failure.get_or_insert(error);
                    Err(CatalogError::new("Catalog file transport failed"))
                })
            },
            &pinned_root,
            ReadOptions {
                now,
                allow_expired_roles,
                next_root: next_root.as_deref(),
                previous: self.trusted.as_ref().map(|(_, state)| state),
            },
        );
        if let Some(error) = failure {
            return Err(error);
        }
        let state = match result {
            Ok(state) => state,
            Err(error) => return self.send_error(&error),
        };
        let generation = self
            .trusted
            .as_ref()
            .map_or(1, |(previous, _)| previous + 1);
        if generation > MAX_GENERATION || state.catalog_bytes().len() > CATALOG_LIMIT {
            return Err(invalid_frame());
        }
        self.pipe.send_control(Reply::Catalog { generation })?;
        self.pipe.send_bytes(state.catalog_bytes())?;
        self.trusted = Some((generation, state));
        Ok(())
    }

    fn update(
        &mut self,
        generation: u64,
        now: Option<String>,
        next_root: bool,
        count: usize,
    ) -> io::Result<()> {
        if count > MAX_ICONS {
            return Err(invalid_frame());
        }
        let catalog = self.pipe.bytes(CATALOG_LIMIT)?;
        let next_root = self.optional_root(next_root)?;
        let mut icons = BTreeMap::new();
        let mut icon_bytes_left = ICON_TOTAL_LIMIT;
        for _ in 0..count {
            let FilePath { path } = self.pipe.control::<FilePath<String>>()?;
            if !logical_icon_path(&path) || icons.contains_key(&path) {
                return Err(invalid_frame());
            }
            let bytes = self.pipe.bytes(ICON_LIMIT.min(icon_bytes_left))?;
            icon_bytes_left -= bytes.len();
            icons.insert(path, bytes);
        }
        let result = (|| {
            let (_, state) = self
                .trusted
                .as_ref()
                .filter(|(current, _)| *current == generation)
                .ok_or_else(|| CatalogError::new("Stale trusted catalog generation"))?;
            let next = if catalog.is_empty() {
                state.catalog_bytes()
            } else {
                &catalog
            };
            update_catalog(
                state,
                next,
                self.keys.as_ref().map_err(Clone::clone)?,
                UpdateOptions {
                    now: parse_now(now.as_deref())?,
                    next_root: next_root.as_deref(),
                    icons: &icons,
                },
            )
        })();
        self.send_result(result)
    }

    fn bootstrap(&mut self, now: Option<String>) -> io::Result<()> {
        let root = self.pipe.bytes(ROOT_LIMIT)?;
        let result = (|| {
            bootstrap_catalog(
                &root,
                self.keys.as_ref().map_err(Clone::clone)?,
                parse_now(now.as_deref())?,
            )
        })();
        self.send_result(result)
    }

    fn send_result(
        &mut self,
        result: Result<BTreeMap<String, Vec<u8>>, CatalogError>,
    ) -> io::Result<()> {
        let files = match result {
            Ok(files) => files,
            Err(error) => return self.send_error(&error),
        };
        if files.len() > MAX_FILES {
            return Err(invalid_frame());
        }
        let mut icon_count = 0;
        let mut icon_bytes = 0;
        let mut file_bytes_left = FILE_TOTAL_LIMIT;
        for (path, bytes) in &files {
            let max = static_file_limit(path)
                .ok_or_else(invalid_frame)?
                .min(file_bytes_left);
            if bytes.is_empty() || bytes.len() > max {
                return Err(invalid_frame());
            }
            file_bytes_left -= bytes.len();
            if path.starts_with("targets/assets/") {
                icon_count += 1;
                icon_bytes += bytes.len();
                if icon_count > MAX_ICONS || icon_bytes > ICON_TOTAL_LIMIT {
                    return Err(invalid_frame());
                }
            }
        }
        self.pipe
            .send_control(Reply::Files { count: files.len() })?;
        for (path, bytes) in files {
            self.pipe.send_control(FilePath { path })?;
            self.pipe.send_bytes(&bytes)?;
        }
        Ok(())
    }

    fn send_error(&mut self, error: &CatalogError) -> io::Result<()> {
        let message: String = error
            .to_string()
            .chars()
            .take(220)
            .map(|character| {
                if character.is_control() {
                    ' '
                } else {
                    character
                }
            })
            .collect();
        self.pipe.send_control(Reply::Error { message: &message })
    }
}

fn request_file(
    pipe: &mut Pipe<impl BufRead, impl Write>,
    path: &str,
    max_bytes: usize,
) -> io::Result<Result<Option<Vec<u8>>, CatalogError>> {
    let limit = static_file_limit(path).ok_or_else(invalid_frame)?;
    if max_bytes == 0 || max_bytes > limit {
        return Err(invalid_frame());
    }
    pipe.send_control(Reply::Request { path, max_bytes })?;
    pipe.flush()?;
    match pipe.control()? {
        FileReply::File { found } => Ok(Ok(found.then(|| pipe.bytes(max_bytes)).transpose()?)),
        FileReply::FileError => Ok(Err(CatalogError::new("Catalog file source failed"))),
    }
}

fn parse_now(value: Option<&str>) -> Result<OffsetDateTime, CatalogError> {
    match value {
        Some(value) => OffsetDateTime::parse(value, &Rfc3339)
            .map_err(|_| CatalogError::new("Invalid catalog time")),
        None => Ok(OffsetDateTime::now_utc()),
    }
}

fn load_keys() -> Result<SigningKeys, CatalogError> {
    let read = |name| {
        env::var(name)
            .map(Zeroizing::new)
            .map_err(|_| CatalogError::new("Missing catalog signing keys"))
    };
    let targets = read("APP_CATALOG_TARGETS_KEY")?;
    let snapshot = read("APP_CATALOG_SNAPSHOT_KEY")?;
    let timestamp = read("APP_CATALOG_TIMESTAMP_KEY")?;
    SigningKeys::from_pem(&targets, &snapshot, &timestamp)
}

fn main() -> ExitCode {
    let mut args = env::args_os().skip(1);
    let result = match args.next() {
        None => run_worker(),
        Some(command) if command == "extract-candidate" => {
            let (Some(archive), Some(destination), None) = (args.next(), args.next(), args.next())
            else {
                return ExitCode::FAILURE;
            };
            candidate_zip::extract(
                Path::new(&archive),
                Path::new(&destination),
                io::stdin().lock(),
            )
        }
        Some(_) => return ExitCode::FAILURE,
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => ExitCode::FAILURE,
    }
}

fn run_worker() -> io::Result<()> {
    let mut worker = Worker {
        pipe: Pipe::new(
            BufReader::new(io::stdin().lock()),
            BufWriter::new(io::stdout().lock()),
        ),
        keys: load_keys(),
        trusted: None,
    };
    worker.run()
}
