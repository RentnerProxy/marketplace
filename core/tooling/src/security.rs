pub(crate) use rentnerproxy_artifacts::invalid;
use serde_json::{Value, json};
use std::io;
use std::path::Path;

pub(crate) mod files;
mod picomatch;

pub(crate) fn string<'a>(input: &'a Value, key: &str) -> io::Result<&'a str> {
    input[key]
        .as_str()
        .ok_or_else(|| invalid(format!("Missing {key}")))
}

pub(crate) fn lower_hex(value: &str, size: usize) -> bool {
    value.len() == size
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

pub(crate) fn sha256_digest(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| lower_hex(hex, 64))
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation.strip_prefix("security-").unwrap_or(operation) {
        "checksum" => {
            let expected = string(&input, "expected")?;
            if !lower_hex(expected, 64)
                || rentnerproxy_artifacts::file_identity(
                    Path::new(string(&input, "path")?),
                    1024 * 1024 * 1024,
                )?
                .sha256
                    != expected
            {
                return Err(invalid("Artifact SHA-256 mismatch"));
            }
            Ok(Value::Null)
        }
        "picomatch-audit" => picomatch::audit(&input),
        "bun-lock" => {
            let root = Path::new(string(&input, "root")?);
            let relative = Path::new("bun.lock");
            files::no_links(root, relative)?;
            let bytes = files::read(&root.join(relative), 4 * 1024 * 1024)?;
            let text =
                String::from_utf8(bytes).map_err(|_| invalid("Expected a UTF-8 Bun lockfile"))?;
            Ok(json!(text))
        }
        "picomatch-path" => Ok(json!(picomatch::package_path())),
        "picomatch-image" => {
            picomatch::image_package(string(&input, "directory")?.as_ref())?;
            Ok(Value::Null)
        }
        "oci-scan-index" => {
            picomatch::scan_index(string(&input, "directory")?.as_ref())?;
            Ok(Value::Null)
        }
        "docker-id" => {
            let value = string(&input, "value")?;
            let valid = match string(&input, "kind")? {
                "image" => sha256_digest(value),
                "container" => lower_hex(value, 64),
                _ => return Err(invalid("Unknown Docker identifier kind")),
            };
            Ok(json!(valid))
        }
        _ => Err(invalid("Unknown security operation")),
    }
}
