use std::io;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use rentnerproxy_artifacts::{FileIdentity, invalid, parse_json, read_file};
use serde::Deserialize;
use serde_json::{Value, json};

const FIXTURE_LIMIT: u64 = 1024 * 1024;
const PUBLIC_ASSET_LIMIT: u64 = 32 * 1024 * 1024;
const DATABASE_TARGET: &str =
    "TEST_DATABASE_URL muss auf eine eindeutig benannte PostgreSQL-Testdatenbank zeigen.";
const DATABASE_HOST: &str = "Die automatische Vorbereitung ist ausschließlich für eine lokale oder isolierte CI-Testdatenbank erlaubt.";

static RUNTIME_REFERENCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9./:_-]*$").expect("image reference pattern"));
static RUNTIME_TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$").expect("isolated image tag pattern")
});
static IMAGE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^sha256:[a-f0-9]{64}$").expect("local Docker image ID pattern"));

pub fn execute(command: &str, input: Value) -> io::Result<Value> {
    match command {
        "db-name" => Ok(json!(test_database_name(text(&input, "name")?))),
        "db-target" => database_target(&input),
        "db-test-target" => database_test_target(&input),
        "compose-config" => {
            let output = text(&input, "output")?.replace("$$", "$");
            parse_json(output.as_bytes())
                .map_err(|_| invalid("Invalid rendered Docker Compose JSON"))
        }
        "runtime-image-ref" => Ok(json!(
            RUNTIME_REFERENCE.is_match(text(&input, "reference")?)
        )),
        "runtime-image-tag" => {
            if !RUNTIME_TAG.is_match(text(&input, "tag")?) {
                return Err(invalid("Invalid isolated runtime image tag."));
            }
            Ok(Value::Null)
        }
        "runtime-image-id" => {
            let id = text(&input, "output")?.trim();
            if !IMAGE_ID.is_match(id) {
                return Err(invalid("Invalid local runtime image identity."));
            }
            Ok(json!(id))
        }
        "runtime-image-owner" => {
            let id = text(&input, "expectedId")?;
            if !IMAGE_ID.is_match(id) || text(&input, "output")?.trim() != id {
                return Err(invalid("Refusing cleanup of a changed runtime image tag."));
            }
            Ok(Value::Null)
        }
        "fixture-text" => {
            let bytes = read_file(Path::new(text(&input, "path")?), FIXTURE_LIMIT)?;
            let content =
                String::from_utf8(bytes).map_err(|_| invalid("Invalid UTF-8 fixture source"))?;
            Ok(json!(content))
        }
        "public-assets" => verify_public_assets(parse_json(text(&input, "output")?.as_bytes())?),
        _ => Err(invalid("Unknown verification operation")),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicAsset {
    name: String,
    expected: FileIdentity,
    received: FileIdentity,
    status: u16,
    content_type: String,
    head_status: u16,
    head_size: u64,
}

fn verify_public_assets(input: Value) -> io::Result<Value> {
    let assets: Vec<PublicAsset> = serde_json::from_value(input)
        .map_err(|_| invalid("Invalid public asset verification results"))?;
    if !(13..=4096).contains(&assets.len()) {
        return Err(invalid("Expected the complete packaged public directory"));
    }
    let mut seen = std::collections::HashSet::with_capacity(assets.len());
    for asset in &assets {
        let name = &asset.name;
        if name.is_empty()
            || name.len() > 1024
            || name.chars().any(char::is_control)
            || !seen.insert(name)
        {
            return Err(invalid("Invalid public asset identity"));
        }
        if asset.status != 200 || asset.content_type.contains("text/html") {
            return Err(invalid(format!(
                "Public asset returned a missing-file or HTML response: {name}"
            )));
        }
        let hash = &asset.expected.sha256;
        if !(1..=PUBLIC_ASSET_LIMIT).contains(&asset.expected.size_bytes)
            || hash.len() != 64
            || !hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
            || asset.expected != asset.received
        {
            return Err(invalid(format!(
                "Public asset bytes differ from the packaged file: {name}"
            )));
        }
        let expected_type = match name.rsplit_once('.').map(|(_, extension)| extension) {
            Some("webp") => Some("image/webp"),
            Some("png") => Some("image/png"),
            Some("woff2") => Some("font/woff2"),
            Some("json") => Some("application/json"),
            _ => None,
        };
        if expected_type.is_some_and(|content_type| !asset.content_type.starts_with(content_type)) {
            return Err(invalid(format!(
                "Incorrect public asset content type: {name}"
            )));
        }
        if asset.head_status != 200 || asset.head_size != 0 {
            return Err(invalid(format!("Public asset HEAD failed: {name}")));
        }
    }
    Ok(json!(assets.len()))
}

fn text<'a>(input: &'a Value, field: &'static str) -> io::Result<&'a str> {
    input[field]
        .as_str()
        .ok_or_else(|| invalid(format!("Expected verification request field {field}")))
}

fn test_database_name(name: &str) -> bool {
    name.split(['_', '-'])
        .any(|part| part.eq_ignore_ascii_case("test"))
}

fn database_target(input: &Value) -> io::Result<Value> {
    let scheme = text(input, "protocol")?;
    let path = text(input, "pathname")?;
    let hostname = text(input, "hostname")?;
    let name = decode_path(path).ok_or_else(|| invalid(DATABASE_TARGET))?;
    let name = name.trim_start_matches('/');
    if !matches!(scheme, "postgres:" | "postgresql:") || !test_database_name(name) {
        return Err(invalid(DATABASE_TARGET));
    }
    let ci_postgres = input["ci"].as_bool() == Some(true) && hostname == "postgres";
    if !(ci_postgres || matches!(hostname, "127.0.0.1" | "::1" | "localhost")) {
        return Err(invalid(DATABASE_HOST));
    }
    Ok(json!(name))
}

fn database_test_target(input: &Value) -> io::Result<Value> {
    if !matches!(text(input, "protocol")?, "postgres:" | "postgresql:") {
        return Err(invalid(
            "TEST_DATABASE_URL muss eine PostgreSQL-Verbindungs-URL sein.",
        ));
    }
    let name_error = || {
        invalid(
            "Der Datenbankname in TEST_DATABASE_URL muss \"test\" als klar abgegrenzten Bestandteil enthalten, z. B. app_test.",
        )
    };
    let decoded = decode_path(text(input, "pathname")?).ok_or_else(name_error)?;
    let name = decoded.trim_start_matches('/');
    if name.contains('/') || !test_database_name(name) {
        return Err(name_error());
    }
    Ok(Value::Null)
}

fn decode_path(path: &str) -> Option<String> {
    let mut encoded = path.bytes();
    let mut output = Vec::with_capacity(path.len());
    while let Some(byte) = encoded.next() {
        output.push(if byte == b'%' {
            let high = char::from(encoded.next()?).to_digit(16)?;
            let low = char::from(encoded.next()?).to_digit(16)?;
            (high * 16 + low) as u8
        } else {
            byte
        });
    }
    String::from_utf8(output).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepares_only_isolated_databases_with_decoded_test_names() {
        let mut input = json!({"protocol":"postgresql:", "pathname":"/app%5FTeST", "hostname":"localhost", "ci":false});
        assert_eq!(execute("db-target", input.clone()).unwrap(), "app_TeST");
        input["hostname"] = "postgres".into();
        assert!(execute("db-target", input.clone()).is_err());
        input["ci"] = true.into();
        assert!(execute("db-target", input.clone()).is_ok());
        input["hostname"] = "postgres.example.test".into();
        assert!(execute("db-target", input.clone()).is_err());
        input["pathname"] = "/app_test-%2Fshadow".into();
        assert!(execute("db-test-target", input).is_err());
    }

    #[test]
    fn compose_rejects_keys_that_collide_after_dollar_decoding() {
        assert!(
            execute(
                "compose-config",
                json!({"output":r#"{"$$label":1,"$label":2}"#})
            )
            .is_err()
        );
        assert_eq!(
            execute(
                "compose-config",
                json!({"output":r#"{"$$label":"$$$${TOKEN}"}"#})
            )
            .unwrap(),
            json!({"$label":"$${TOKEN}"})
        );
    }

    #[test]
    fn public_assets_bind_response_bytes_types_and_head() {
        let hash = "a".repeat(64);
        let mut assets: Vec<Value> = (0..13)
            .map(|index| {
                json!({
                    "name": format!("assets/{index}.png"),
                    "expected": {"sha256": hash, "sizeBytes": 12},
                    "received": {"sha256": hash, "sizeBytes": 12},
                    "status": 200,
                    "contentType": "image/png",
                    "headStatus": 200,
                    "headSize": 0,
                })
            })
            .collect();
        let check = |assets: &[Value]| {
            execute(
                "public-assets",
                json!({"output": serde_json::to_string(assets).unwrap()}),
            )
        };
        assert_eq!(check(&assets).unwrap(), 13);
        assets[0]["received"]["sha256"] = "b".repeat(64).into();
        assert!(
            check(&assets)
                .unwrap_err()
                .to_string()
                .contains("bytes differ")
        );
        assets[0]["received"]["sha256"] = hash.into();
        assets[0]["contentType"] = "application/octet-stream".into();
        assert!(
            check(&assets)
                .unwrap_err()
                .to_string()
                .contains("content type")
        );
        assets[0]["contentType"] = "image/png".into();
        assets[0]["headSize"] = 1.into();
        assert!(
            check(&assets)
                .unwrap_err()
                .to_string()
                .contains("HEAD failed")
        );
    }
}
