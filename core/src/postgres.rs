//! PostgreSQL child lifecycle. Credentials are confined to child environment;
//! raw child output is never returned across the application boundary.
use crate::protocol::{CoreError, CoreResult, OperationContext};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

fn error(code: &str, message: &str) -> CoreError {
    CoreError::new(code, message)
}
fn decode(value: &str) -> CoreResult<String> {
    let input = value.as_bytes();
    let mut output = Vec::new();
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            if index + 2 >= input.len() {
                return Err(error(
                    "BACKUP_POSTGRES_CONFIG",
                    "DATABASE_URL enthält ein ungültig kodiertes Passwort.",
                ));
            }
            let pair = std::str::from_utf8(&input[index + 1..index + 3])
                .map_err(|_| error("BACKUP_POSTGRES_CONFIG", "DATABASE_URL ist ungültig."))?;
            output.push(u8::from_str_radix(pair, 16).map_err(|_| {
                error(
                    "BACKUP_POSTGRES_CONFIG",
                    "DATABASE_URL enthält ein ungültig kodiertes Passwort.",
                )
            })?);
            index += 3;
        } else {
            output.push(input[index]);
            index += 1;
        }
    }
    String::from_utf8(output).map_err(|_| {
        error(
            "BACKUP_POSTGRES_CONFIG",
            "DATABASE_URL enthält ein ungültig kodiertes Passwort.",
        )
    })
}
pub fn connection(
    database_url: &str,
    fallback: Option<&str>,
) -> CoreResult<(String, Option<String>)> {
    let mut url = url::Url::parse(database_url).map_err(|_| {
        error(
            "BACKUP_POSTGRES_CONFIG",
            "DATABASE_URL ist keine gültige PostgreSQL-URL.",
        )
    })?;
    if !matches!(url.scheme(), "postgres" | "postgresql") {
        return Err(error(
            "BACKUP_POSTGRES_CONFIG",
            "DATABASE_URL ist keine gültige PostgreSQL-URL.",
        ));
    }
    let mut password = url
        .password()
        .map(decode)
        .transpose()?
        .or_else(|| fallback.map(str::to_owned));
    let mut retained = Vec::new();
    if let Some(query) = url.query() {
        for parameter in query.split('&') {
            let (key, value) = parameter.split_once('=').unwrap_or((parameter, ""));
            if decode(key).is_ok_and(|key| key == "password") {
                password = Some(decode(value)?);
            } else {
                retained.push(parameter.to_owned());
            }
        }
    }
    if url.password().is_some() {
        url.set_password(None)
            .map_err(|_| error("BACKUP_POSTGRES_CONFIG", "DATABASE_URL ist ungültig."))?;
    }
    if retained.is_empty() {
        url.set_query(None);
    } else {
        url.set_query(Some(&retained.join("&")));
    }
    Ok((url.to_string(), password))
}

fn executable(command: &str, directory: Option<&str>) -> PathBuf {
    let name = if cfg!(windows) {
        format!("{command}.exe")
    } else {
        command.to_owned()
    };
    if let Some(directory) = directory {
        return Path::new(directory).join(name);
    }
    #[cfg(windows)]
    {
        let root = std::env::var_os("ProgramFiles")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Program Files"))
            .join("PostgreSQL");
        if let Some(path) = find_windows_executable(&root, &name) {
            return path;
        }
    }
    PathBuf::from(name)
}

#[cfg(any(windows, test))]
fn find_windows_executable(root: &Path, name: &str) -> Option<PathBuf> {
    std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path().join("bin").join(name);
            if !path.is_file() {
                return None;
            }
            let major = entry
                .file_name()
                .to_str()
                .and_then(|version| version.split('.').next())
                .filter(|major| major.bytes().all(|byte| byte.is_ascii_digit()))
                .and_then(|major| major.parse::<u32>().ok());
            Some((major, path))
        })
        .max()
        .map(|(_, path)| path)
}
fn capture(mut stream: impl Read + Send + 'static) -> thread::JoinHandle<std::io::Result<Vec<u8>>> {
    thread::spawn(move || {
        let mut kept = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            let count = stream.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            let retain = count.min(65536usize.saturating_sub(kept.len()));
            kept.extend_from_slice(&buffer[..retain]);
        }
        Ok(kept)
    })
}

fn joined_output(output: thread::JoinHandle<std::io::Result<Vec<u8>>>) -> CoreResult<Vec<u8>> {
    output
        .join()
        .map_err(|_| error_fn_start())?
        .map_err(|_| error_fn_start())
}
fn run(mut command: Command, deadline: Instant, context: &OperationContext) -> CoreResult<Vec<u8>> {
    context.check()?;
    command.stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            error_fn_missing()
        } else {
            error_fn_start()
        }
    })?;
    let stderr = capture(child.stderr.take().ok_or_else(error_fn_start)?);
    let stdout = child.stdout.take().map(capture);
    let mut failure = None;
    let status = loop {
        if let Err(error) = context.check() {
            failure = Some(error);
            let _ = child.kill();
            break child.wait();
        }
        if Instant::now() >= deadline {
            failure = Some(error(
                "BACKUP_POSTGRES_TIMEOUT",
                "Der PostgreSQL-Prozess hat das Zeitlimit überschritten und wurde beendet.",
            ));
            let _ = child.kill();
            break child.wait();
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(error);
            }
        }
    };
    let stderr = joined_output(stderr)?;
    let stdout = stdout.map(joined_output).transpose()?.unwrap_or_default();
    if let Some(error) = failure {
        return Err(error);
    }
    if !status.map_err(|_| error_fn_start())?.success() {
        if String::from_utf8_lossy(&stderr).contains("server version mismatch") {
            return Err(error(
                "BACKUP_POSTGRES_VERSION_MISMATCH",
                "Die PostgreSQL-Client-Version ist mit dem Server nicht kompatibel.",
            ));
        }
        return Err(error(
            "BACKUP_POSTGRES_COMMAND_FAILED",
            "Der PostgreSQL-Prozess konnte den Auftrag nicht abschließen.",
        ));
    }
    Ok(stdout)
}
fn error_fn_missing() -> CoreError {
    error(
        "BACKUP_POSTGRES_BINARY_MISSING",
        "Die PostgreSQL-Client-Tools wurden nicht gefunden. Prüfe POSTGRES_BIN_DIR.",
    )
}
fn error_fn_start() -> CoreError {
    error(
        "BACKUP_POSTGRES_COMMAND_FAILED",
        "Der PostgreSQL-Prozess konnte nicht sicher ausgeführt werden.",
    )
}
fn base_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .env_remove("DATABASE_URL")
        .env_remove("PGPASSWORD")
        .env_remove("PGDATABASE")
        .env_remove("PGSERVICE")
        .env_remove("PGSERVICEFILE")
        .env("PGCONNECT_TIMEOUT", "10")
        .stdin(Stdio::null())
        .stdout(Stdio::null());
    command
}

fn service_settings(database_url: &str) -> CoreResult<String> {
    let url = url::Url::parse(database_url).map_err(|_| error_fn_start())?;
    let mut fields = std::collections::BTreeMap::<String, String>::new();
    if let Some(host) = url.host() {
        fields.insert(
            "host".into(),
            match host {
                url::Host::Ipv6(address) => address.to_string(),
                other => decode(&other.to_string())?,
            },
        );
    }
    if let Some(port) = url.port() {
        fields.insert("port".into(), port.to_string());
    }
    if !url.username().is_empty() {
        fields.insert("user".into(), decode(url.username())?);
    }
    if !url.path().trim_start_matches('/').is_empty() {
        fields.insert("dbname".into(), decode(url.path().trim_start_matches('/'))?);
    }
    if let Some(query) = url.query() {
        for parameter in query.split('&') {
            let (key, value) = parameter.split_once('=').unwrap_or((parameter, ""));
            let key = decode(key)?;
            let value = decode(value)?;
            if key == "ssl" && value == "true" {
                fields.insert("sslmode".into(), "require".into());
            } else {
                fields.insert(key, value);
            }
        }
    }
    let mut output = String::from("[marketplace_core]\n");
    for (key, value) in fields {
        if key == "service"
            || key == "password"
            || key.is_empty()
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
            || value.contains(['\0', '\r', '\n'])
            || value.ends_with(|character: char| character.is_ascii_whitespace())
            || key.len() + value.len() + 2 >= 1023
        {
            return Err(error(
                "BACKUP_POSTGRES_CONFIG",
                "Die PostgreSQL-Verbindungsoptionen sind für die private Client-Konfiguration ungültig.",
            ));
        }
        output.push_str(&key);
        output.push('=');
        output.push_str(&value);
        output.push('\n');
    }
    Ok(output)
}

struct PrivateServiceFile {
    directory: cap_std::fs::Dir,
    name: String,
    identity: Value,
    removed: bool,
}
impl PrivateServiceFile {
    fn create(directory: &cap_std::fs::Dir, settings: &str) -> CoreResult<Self> {
        let name = format!(".postgres-service-{}.conf", uuid::Uuid::new_v4());
        let owned_directory = directory.try_clone()?;
        let mut file = crate::storage::files::create_file(directory, Path::new(&name))?;
        let identity = crate::storage::files::identity(&file.metadata()?)?;
        let mut owned = Self {
            directory: owned_directory,
            name,
            identity,
            removed: false,
        };
        let result = (|| {
            file.write_all(settings.as_bytes())?;
            file.sync_all()?;
            crate::storage::files::sync_dir(directory)
        })();
        drop(file);
        if let Err(error) = result {
            let _ = owned.cleanup();
            return Err(error);
        }
        Ok(owned)
    }
    fn cleanup(&mut self) -> CoreResult<()> {
        if self.removed {
            return Ok(());
        }
        if crate::storage::files::identity(&self.directory.symlink_metadata(&self.name)?)?
            != self.identity
        {
            return Err(error_fn_start());
        }
        self.directory.remove_file(&self.name)?;
        self.removed = true;
        crate::storage::files::sync_dir(&self.directory)
    }
}
impl Drop for PrivateServiceFile {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}
pub fn execute(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let dump = request["operation"] == "postgresDump";
    let command = if dump { "pg_dump" } else { "pg_restore" };
    let timeout = request["timeoutMs"]
        .as_u64()
        .filter(|value| (1000..=86_400_000).contains(value))
        .ok_or_else(|| {
            error(
                "BACKUP_POSTGRES_CONFIG",
                "Das PostgreSQL-Zeitlimit ist ungültig.",
            )
        })?;
    let (database_url, password) = connection(
        request["databaseUrl"].as_str().ok_or_else(error_fn_start)?,
        request["fallbackPassword"].as_str(),
    )?;
    let executable = executable(command, request["binaryDirectory"].as_str());
    let deadline = Instant::now() + Duration::from_millis(timeout);
    let mut version = base_command(&executable);
    version.arg("--version").stdout(Stdio::piped());
    let output = run(
        version,
        deadline.min(Instant::now() + Duration::from_secs(10)),
        context,
    )?;
    let text = String::from_utf8_lossy(&output);
    if !text.contains(command)
        || !text.contains("PostgreSQL")
        || !text.chars().any(|character| character.is_ascii_digit())
    {
        return Err(error(
            "BACKUP_POSTGRES_VERSION_MISMATCH",
            "Die PostgreSQL-Client-Version konnte nicht geprüft werden.",
        ));
    }
    let path =
        crate::storage::files::absolute(request["path"].as_str().ok_or_else(error_fn_start)?)?;
    let (dir, name) = crate::storage::files::parent(&path, false)?;
    let settings = service_settings(&database_url)?;
    let mut service = PrivateServiceFile::create(&dir, &settings)?;
    crate::storage::files::assert_location(path.parent().ok_or_else(error_fn_start)?, &dir)?;
    let mut process = base_command(&executable);
    process
        .env(
            "PGSERVICEFILE",
            path.parent()
                .ok_or_else(error_fn_start)?
                .join(&service.name),
        )
        // The explicit dbname option selects direct restore mode. All actual
        // connection fields remain outside argv in the private libpq service.
        .arg("--dbname=service=marketplace_core")
        .arg("--no-password")
        .arg("--no-owner")
        .arg("--no-privileges");
    if let Some(password) = password {
        process.env("PGPASSWORD", password);
    }
    let result = (|| {
        if dump {
            let file = crate::storage::files::create_file(&dir, Path::new(&name))?;
            let metadata = file.metadata()?;
            process
                .arg("--format=custom")
                .stdout(Stdio::from(file.try_clone()?.into_std()));
            let result = run(process, deadline, context);
            if result.is_err() {
                if dir
                    .symlink_metadata(&name)
                    .is_ok_and(|actual| crate::storage::files::same(&metadata, &actual))
                {
                    let _ = dir.remove_file(&name);
                }
                return result.map(|_| Value::Null);
            }
            file.sync_all()?;
            crate::storage::files::sync_dir(&dir)?;
        } else {
            let file = crate::storage::files::open_read(&dir, Path::new(&name))?;
            if file.metadata()?.len() == 0 {
                return Err(error(
                    "BACKUP_POSTGRES_DUMP_INVALID",
                    "Der PostgreSQL-Dump ist leer.",
                ));
            }
            process
                .args([
                    "--clean",
                    "--if-exists",
                    "--exit-on-error",
                    "--single-transaction",
                ])
                .stdin(Stdio::from(file.into_std()));
            run(process, deadline, context)?;
        }
        Ok(json!({"ok":true}))
    })();
    let cleanup = service.cleanup();
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), _) => Err(error),
        (Ok(_), Err(_)) => Err(error(
            "BACKUP_POSTGRES_COMMAND_FAILED",
            "Die private PostgreSQL-Client-Konfiguration konnte nicht sicher bereinigt werden.",
        )),
    }
}

#[cfg(test)]
#[path = "../tests/unit/postgres.rs"]
mod tests;
