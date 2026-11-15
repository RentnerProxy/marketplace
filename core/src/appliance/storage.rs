use super::{
    Result,
    environment::{Environment, service_environment},
    process,
};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

const MARKER: &str = ".initializing";

struct Paths {
    data: String,
    runtime: String,
}
impl Paths {
    fn production() -> Self {
        Self {
            data: "/data".into(),
            runtime: "/run/marketplace".into(),
        }
    }
    fn postgres(&self) -> String {
        format!("{}/postgresql", self.data)
    }
    fn cluster(&self) -> String {
        format!("{}/18/docker", self.postgres())
    }
    fn socket(&self) -> String {
        format!("{}/postgresql", self.runtime)
    }
}
type Runner<'a> =
    dyn Fn(&str, &[&str], &Environment, Duration, &AtomicBool) -> Result<Vec<u8>> + 'a;

pub fn require_root() -> Result<()> {
    #[cfg(unix)]
    {
        if unsafe { libc::geteuid() } == 0 {
            return Ok(());
        }
    }
    Err("appliance_initialization_requires_root")
}

#[cfg(unix)]
fn directory(path: &Path, create: bool) -> std::io::Result<File> {
    use std::{
        ffi::CString,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::ffi::OsStrExt,
        },
        path::Component,
    };
    if !path.is_absolute() {
        return Err(std::io::Error::other("appliance_directory_invalid"));
    }
    let mut current = File::open("/")?;
    for component in path.components() {
        let Component::Normal(component) = component else {
            if matches!(component, Component::RootDir) {
                continue;
            }
            return Err(std::io::Error::other("appliance_directory_invalid"));
        };
        let component = CString::new(component.as_bytes())?;
        // Walk held parent descriptors without following links, including concurrently replaced paths.
        let open = || unsafe {
            libc::openat(
                current.as_raw_fd(),
                component.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        let mut fd = open();
        if fd < 0
            && create
            && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
        {
            let result = unsafe { libc::mkdirat(current.as_raw_fd(), component.as_ptr(), 0o700) };
            if result != 0
                && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
            {
                return Err(std::io::Error::last_os_error());
            }
            fd = open();
        }
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        current = unsafe { File::from_raw_fd(fd) };
    }
    Ok(current)
}

#[cfg(not(unix))]
fn directory(path: &Path, create: bool) -> std::io::Result<File> {
    for ancestor in path.ancestors() {
        if let Ok(metadata) = fs::symlink_metadata(ancestor)
            && (metadata.is_symlink() || !metadata.is_dir())
        {
            return Err(std::io::Error::other("appliance_directory_invalid"));
        }
    }
    if create {
        fs::create_dir_all(path)?;
    }
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(0x02000000)
        .open(path)
}

pub fn assert_directory(path: &Path) -> Result<()> {
    directory(path, false)
        .map(|_| ())
        .map_err(|_| "appliance_directory_invalid")
}

fn prepare_directory(path: &str, owner: (u32, u32), mode: u32, create: bool) -> Result<()> {
    let file = directory(Path::new(path), create).map_err(|_| "appliance_directory_invalid")?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        if unsafe { libc::fchown(file.as_raw_fd(), owner.0, owner.1) } != 0
            || unsafe { libc::fchmod(file.as_raw_fd(), mode) } != 0
        {
            return Err("appliance_directory_permissions_failed");
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (file, owner, mode);
    }
    Ok(())
}

#[cfg(unix)]
fn private_file(parent: &str, name: &str, create: bool) -> std::io::Result<File> {
    use std::{
        ffi::CString,
        os::fd::{AsRawFd, FromRawFd},
    };
    let parent = directory(Path::new(parent), false)?;
    let name = CString::new(name)?;
    let flags = libc::O_NOFOLLOW
        | libc::O_CLOEXEC
        | if create {
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL
        } else {
            libc::O_RDONLY | libc::O_NONBLOCK
        };
    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags, 0o600) };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(std::io::Error::other("appliance_file_invalid"));
    }
    Ok(file)
}

#[cfg(not(unix))]
fn private_file(parent: &str, name: &str, create: bool) -> std::io::Result<File> {
    assert_directory(Path::new(parent)).map_err(std::io::Error::other)?;
    let path = Path::new(parent).join(name);
    if fs::symlink_metadata(&path)
        .is_ok_and(|metadata| metadata.is_symlink() || !metadata.is_file())
    {
        return Err(std::io::Error::other("appliance_file_invalid"));
    }
    std::fs::OpenOptions::new()
        .read(!create)
        .write(create)
        .create_new(create)
        .open(path)
}

fn identity(name: &str, cancelled: &AtomicBool) -> Result<(u32, u32)> {
    let env = [("PATH".into(), "/usr/bin:/bin".into())]
        .into_iter()
        .collect();
    let id = |flag| -> Result<u32> {
        let bytes = process::execute("id", &[flag, name], &env, Duration::from_secs(3), cancelled)?;
        String::from_utf8_lossy(&bytes)
            .trim()
            .parse()
            .map_err(|_| "appliance_identity_unavailable")
    };
    Ok((id("-u")?, id("-g")?))
}

pub fn prepare(env: &Environment, maintenance: bool, cancelled: &AtomicBool) -> Result<()> {
    let postgres = identity("postgres", cancelled)?;
    let bun = identity("bun", cancelled)?;
    let valkey = identity("valkey", cancelled)?;
    prepare_with(
        env,
        maintenance,
        cancelled,
        &Paths::production(),
        [(0, 0), postgres, bun, valkey],
        &process::execute,
    )
}

fn prepare_with(
    env: &Environment,
    maintenance: bool,
    cancelled: &AtomicBool,
    paths: &Paths,
    owners: [(u32, u32); 4],
    runner: &Runner<'_>,
) -> Result<()> {
    let [supervisor, postgres, bun, valkey] = owners;
    assert_directory(Path::new(&paths.data))?;
    prepare_directory(&paths.runtime, supervisor, 0o755, true)?;
    prepare_directory(&paths.socket(), postgres, 0o700, true)?;
    for path in [
        paths.postgres(),
        format!("{}/18", paths.postgres()),
        paths.cluster(),
    ] {
        if maintenance {
            assert_directory(Path::new(&path))?;
        } else {
            prepare_directory(&path, postgres, 0o700, true)?;
        }
    }
    if !maintenance {
        for path in [
            format!("{}/storage", paths.data),
            format!("{}/storage/public", paths.data),
            format!("{}/storage/private", paths.data),
            format!("{}/backups", paths.data),
        ] {
            prepare_directory(&path, bun, 0o700, true)?;
        }
        prepare_directory(&format!("{}/valkey", paths.runtime), valkey, 0o700, true)?;
    }
    match private_file(&paths.cluster(), "PG_VERSION", false) {
        Ok(file) => {
            let mut version = String::new();
            file.take(64)
                .read_to_string(&mut version)
                .map_err(|_| "appliance_cluster_version_invalid")?;
            if version.trim() != "18" {
                return Err("PostgreSQL-Major-Version benötigt einen gesonderten Upgradeplan.");
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if maintenance
                || fs::read_dir(paths.cluster())
                    .map_err(|_| "appliance_cluster_invalid")?
                    .next()
                    .is_some()
            {
                return Err(
                    "Kein gültiger PostgreSQL-18-Cluster; vorhandene Daten werden nicht ersetzt.",
                );
            }
            match private_file(&paths.postgres(), MARKER, true) {
                Ok(file) => {
                    file.sync_all().map_err(|_| "appliance_marker_failed")?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    private_file(&paths.postgres(), MARKER, false)
                        .map_err(|_| "appliance_initialization_marker_invalid")?;
                }
                Err(_) => return Err("appliance_initialization_marker_invalid"),
            }
            initialize_cluster(env, postgres, cancelled, paths, runner)?;
        }
        Err(_) => return Err("appliance_cluster_version_invalid"),
    }
    Ok(())
}

fn initialize_cluster(
    env: &Environment,
    owner: (u32, u32),
    cancelled: &AtomicBool,
    paths: &Paths,
    runner: &Runner<'_>,
) -> Result<()> {
    let mut file = private_file(&paths.socket(), "initial-password", true)
        .map_err(|_| "appliance_password_file_failed")?;
    let result = (|| {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            if unsafe { libc::fchown(file.as_raw_fd(), owner.0, owner.1) } != 0 {
                return Err("appliance_password_file_failed");
            }
        }
        #[cfg(not(unix))]
        {
            let _ = owner;
        }
        file.write_all(format!("{}\n", env["POSTGRES_PASSWORD"]).as_bytes())
            .map_err(|_| "appliance_password_file_failed")?;
        file.sync_all()
            .map_err(|_| "appliance_password_file_failed")?;
        if cancelled.load(Ordering::SeqCst) {
            return Err("appliance_stopping");
        }
        runner(
            "su-exec",
            &[
                "postgres:postgres",
                "initdb",
                "-D",
                &paths.cluster(),
                &format!("--username={}", env["POSTGRES_USER"]),
                &format!("--pwfile={}/initial-password", paths.socket()),
                "--auth-host=scram-sha-256",
                "--auth-local=scram-sha-256",
                "--encoding=UTF8",
                "--locale=C",
                "--no-clean",
            ],
            &service_environment(env),
            Duration::from_secs(300),
            cancelled,
        )?;
        Ok(())
    })();
    drop(file);
    let cleanup = fs::remove_file(format!("{}/initial-password", paths.socket()))
        .map_err(|_| "appliance_password_cleanup_failed");
    result.and(cleanup)
}

pub fn initialize_database(env: &Environment, cancelled: &AtomicBool) -> Result<()> {
    initialize_database_with(env, cancelled, &Paths::production(), &process::execute)
}

fn initialize_database_with(
    env: &Environment,
    cancelled: &AtomicBool,
    paths: &Paths,
    runner: &Runner<'_>,
) -> Result<()> {
    match private_file(&paths.postgres(), MARKER, false) {
        Ok(_) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("appliance_initialization_marker_invalid"),
    }
    let mut command_env = service_environment(env);
    command_env.insert("PGPASSWORD".into(), env["POSTGRES_PASSWORD"].clone());
    command_env.insert("PGCONNECT_TIMEOUT".into(), "5".into());
    if runner(
        "psql",
        &[
            "-X",
            "-h",
            "127.0.0.1",
            "-p",
            "5432",
            "-U",
            &env["POSTGRES_USER"],
            "-d",
            &env["POSTGRES_DB"],
            "-Atqc",
            "SELECT 1",
        ],
        &command_env,
        Duration::from_secs(10),
        cancelled,
    )
    .is_err()
    {
        runner(
            "createdb",
            &[
                "-h",
                "127.0.0.1",
                "-p",
                "5432",
                "-U",
                &env["POSTGRES_USER"],
                "--",
                &env["POSTGRES_DB"],
            ],
            &command_env,
            Duration::from_secs(30),
            cancelled,
        )?;
    }
    fs::remove_file(format!("{}/{MARKER}", paths.postgres()))
        .map_err(|_| "appliance_marker_cleanup_failed")
}

#[cfg(all(test, unix))]
#[path = "../../tests/unit/appliance_storage.rs"]
mod tests;
