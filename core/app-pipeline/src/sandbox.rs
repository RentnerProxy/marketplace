use marketplace_artifacts::invalid;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

const LOG_LIMIT: u64 = 1024 * 1024;
const MAX_ARCHIVE: u64 = 512 * 1024 * 1024;
const CREATE_TIMEOUT: u64 = 300_000;
const DEFAULT_TIMEOUT: u64 = 20_000;
const PREFIX: &str = "marketplace-candidate-";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Sandbox {
    target: String,
    image: String,
    network: Option<String>,
    user: Option<String>,
    memory_mi_b: u32,
    process_limit: u32,
    mounts: Vec<String>,
    command: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Docker {
    args: Vec<String>,
    timeout: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Archive {
    path: PathBuf,
    max_bytes: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Attach {
    args: Vec<String>,
    operation: String,
    timeout: u64,
    input: Option<String>,
    archive: Option<Archive>,
}

struct Outcome {
    status: ExitStatus,
    output: Vec<u8>,
    error: Vec<u8>,
}

fn output(stream: impl Read, mut target: impl Write, maximum: u64) -> io::Result<()> {
    if io::copy(&mut stream.take(maximum + 1), &mut target)? > maximum {
        return Err(invalid("Sandbox output exceeded its byte limit"));
    }
    Ok(())
}

fn stage_archive(archive: &Archive) -> io::Result<tempfile::NamedTempFile> {
    if !(1..=MAX_ARCHIVE).contains(&archive.max_bytes) {
        return Err(invalid("Invalid sandbox archive byte limit"));
    }
    let parent = archive
        .path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| invalid("Invalid sandbox archive path"))?;
    tempfile::NamedTempFile::new_in(parent)
}

fn run(
    args: &[String],
    timeout: u64,
    input: &str,
    archive: Option<Archive>,
) -> io::Result<Outcome> {
    if !(1..=CREATE_TIMEOUT).contains(&timeout) || input.len() > LOG_LIMIT as usize {
        return Err(invalid("Invalid sandbox process bounds"));
    }
    let mut staged = archive.as_ref().map(stage_archive).transpose()?;
    let mut child = Command::new("docker")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let failed = AtomicBool::new(false);
    let outcome = thread::scope(|scope| {
        let writer = scope.spawn(|| {
            let result = stdin.write_all(input.as_bytes());
            drop(stdin);
            result
        });
        let reader = scope.spawn(|| {
            let mut bytes = Vec::new();
            let result = if let (Some(file), Some(archive)) = (&mut staged, &archive) {
                output(stdout, file, archive.max_bytes)
            } else {
                output(stdout, &mut bytes, LOG_LIMIT)
            };
            if result.is_err() {
                failed.store(true, Ordering::Release);
            }
            result.map(|()| bytes)
        });
        let errors = scope.spawn(|| {
            let mut bytes = Vec::new();
            let result = output(stderr, &mut bytes, LOG_LIMIT);
            if result.is_err() {
                failed.store(true, Ordering::Release);
            }
            result.map(|()| bytes)
        });
        let deadline = Instant::now() + Duration::from_millis(timeout);
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) if Instant::now() < deadline && !failed.load(Ordering::Acquire) => {
                    thread::sleep(Duration::from_millis(15));
                }
                result => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break match result {
                        Err(error) => Err(error),
                        _ => Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "Sandbox process exceeded its limits",
                        )),
                    };
                }
            }
        };
        let output = reader
            .join()
            .map_err(|_| invalid("Sandbox stream failed"))??;
        let error = errors
            .join()
            .map_err(|_| invalid("Sandbox stream failed"))??;
        let input_result = writer.join().map_err(|_| invalid("Sandbox input failed"))?;
        let status = status?;
        if status.success() {
            input_result?;
        }
        Ok::<_, io::Error>(Outcome {
            status,
            output,
            error,
        })
    })?;
    if outcome.status.success()
        && let (Some(file), Some(archive)) = (staged, archive)
    {
        file.persist_noclobber(archive.path)
            .map_err(|error| error.error)?;
    }
    Ok(outcome)
}

fn args(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| (*word).to_owned()).collect()
}

fn valid_name(name: &str) -> bool {
    name.strip_prefix(PREFIX)
        .and_then(|value| uuid::Uuid::parse_str(value).ok())
        .is_some_and(|id| name == format!("{PREFIX}{id}"))
}

fn mount_pairs(mounts: &[String]) -> bool {
    let (pairs, remainder) = mounts.as_chunks::<2>();
    mounts.len() <= 24
        && remainder.is_empty()
        && pairs.iter().all(|[kind, value]| match kind.as_str() {
            "--tmpfs" => value.starts_with('/') && value.contains(",nosuid,nodev"),
            "--mount" => {
                value.starts_with("type=bind,src=")
                    && value.contains(",dst=/")
                    && value.ends_with(",readonly")
            }
            _ => false,
        })
}

fn pinned_image(image: &str) -> bool {
    image
        .strip_prefix("ghcr.io/rentnerproxy/platform@sha256:")
        .is_some_and(|hash| {
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
}

fn create_docker(config: Sandbox, name: &str) -> io::Result<String> {
    if !valid_name(name) {
        return Err(invalid("Invalid candidate sandbox name"));
    }
    let arch = match config.target.as_str() {
        "linux-amd64" => "linux/amd64",
        "linux-arm64" => "linux/arm64",
        _ => return Err(invalid("Invalid sandbox target")),
    };
    let user = config.user.as_deref().unwrap_or("21001:21004");
    let network = config.network.as_deref().unwrap_or("none");
    if !(1..=2048).contains(&config.memory_mi_b)
        || !(1..=512).contains(&config.process_limit)
        || !matches!(user, "21001:21004" | "21002:21004")
        || !matches!(network, "none" | "bridge")
        || !pinned_image(&config.image)
        || !mount_pairs(&config.mounts)
        || config.command.is_empty()
    {
        return Err(invalid("Invalid candidate sandbox configuration"));
    }
    let native = run(
        &args(&["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"]),
        DEFAULT_TIMEOUT,
        "",
        None,
    )?;
    if !native.status.success() || String::from_utf8_lossy(&native.output).trim() != arch {
        return Err(invalid(format!(
            "Expected native Linux Docker for {}",
            config.target
        )));
    }
    let memory = format!("{}m", config.memory_mi_b);
    let pids = config.process_limit.to_string();
    let mut command = args(&[
        "create",
        "--name",
        name,
        "--pull=missing",
        "--platform",
        arch,
        "--network",
        network,
        "--read-only",
        "--no-healthcheck",
        "--user",
        user,
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges=true",
        "--init",
        "--log-driver",
        "none",
        "--workdir",
        "/",
        "--cpus",
        "2",
        "--pids-limit",
        &pids,
        "--memory",
        &memory,
        "--memory-swap",
        &memory,
        "--ulimit",
        "nofile=256:256",
        "--ulimit",
        "core=0:0",
        "--shm-size",
        "16m",
        "--tmpfs",
        "/var/lib/rentnerproxy:ro,nosuid,nodev,noexec,size=1m",
    ]);
    command.extend(config.mounts);
    command.extend(args(&[
        "--entrypoint",
        "/usr/bin/env",
        &config.image,
        "-i",
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "HOME=/tmp",
    ]));
    command.extend(config.command);
    let result = run(&command, CREATE_TIMEOUT, "", None)?;
    if !result.status.success() {
        return Err(invalid("Could not create isolated candidate sandbox"));
    }
    Ok(name.to_owned())
}

fn container_command(args: &[String]) -> bool {
    let words: Vec<_> = args.iter().map(String::as_str).collect();
    match words.as_slice() {
        ["start", name]
        | ["start", "--attach", name]
        | ["rm", "--force", "--volumes", name]
        | ["exec", name, "/usr/bin/cat", "--", _]
        | [
            "exec",
            "--interactive",
            "--user",
            "21002:21004",
            name,
            "/usr/bin/env",
            "-i",
            ..,
        ]
        | [
            "exec",
            "--interactive",
            "--user",
            "21001:21004",
            "--workdir",
            "/package",
            name,
            "/usr/bin/env",
            "-i",
            ..,
        ] => valid_name(name),
        _ => false,
    }
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation {
        "create" => {
            #[derive(Deserialize)]
            struct Launch {
                name: String,
                config: Sandbox,
            }
            let launch: Launch = serde_json::from_value(input)?;
            Ok(json!(create_docker(launch.config, &launch.name)?))
        }
        "docker" => {
            let command: Docker = serde_json::from_value(input)?;
            if !container_command(&command.args) {
                return Err(invalid("Invalid candidate Docker operation"));
            }
            let result = run(
                &command.args,
                command.timeout.unwrap_or(DEFAULT_TIMEOUT),
                "",
                None,
            )?;
            if !result.status.success()
                && !(command.args[0] == "rm"
                    && String::from_utf8_lossy(&result.error)
                        .to_lowercase()
                        .contains("no such container"))
            {
                return Err(invalid("Candidate Docker operation failed"));
            }
            Ok(json!(String::from_utf8_lossy(&result.output).trim()))
        }
        "attach" => {
            let command: Attach = serde_json::from_value(input)?;
            if !container_command(&command.args) || command.args[0] == "rm" {
                return Err(invalid("Invalid candidate Docker attach operation"));
            }
            let result = run(
                &command.args,
                command.timeout,
                command.input.as_deref().unwrap_or_default(),
                command.archive,
            )?;
            if !result.status.success() {
                let status = result
                    .status
                    .code()
                    .map_or("null".to_owned(), |code| code.to_string());
                return Err(invalid(format!(
                    "{} failed with exit status {status}",
                    command.operation
                )));
            }
            Ok(Value::Null)
        }
        "mount" => {
            let source = input["source"]
                .as_str()
                .ok_or_else(|| invalid("Invalid mount path"))?;
            let destination = input["destination"]
                .as_str()
                .ok_or_else(|| invalid("Invalid mount path"))?;
            if !Path::new(source).is_absolute()
                || !destination.starts_with('/')
                || source.contains([',', '"', '\r', '\n'])
                || destination.contains([',', '"', '\r', '\n'])
            {
                return Err(invalid(
                    "Sandbox inputs require an absolute Docker mount path",
                ));
            }
            Ok(json!([
                "--mount",
                format!("type=bind,src={source},dst={destination},readonly")
            ]))
        }
        _ => Err(invalid("Unknown sandbox operation")),
    }
}
