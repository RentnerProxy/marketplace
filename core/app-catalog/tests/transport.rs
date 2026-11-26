use std::collections::BTreeMap;
use std::io::{BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};

use ed25519_dalek::{SigningKey, pkcs8::EncodePrivateKey};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

type Files = BTreeMap<String, Vec<u8>>;

const NOW: &str = "2026-11-01T01:00:00Z";
const ROOT: &str = "metadata/1.root.json";
const TIMESTAMP: &str = "metadata/timestamp.json";

struct Worker {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
}

impl Worker {
    fn spawn(signing: bool) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_marketplace-app-catalog"));
        command
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(profile) = std::env::var_os("LLVM_PROFILE_FILE") {
            command.env("LLVM_PROFILE_FILE", profile);
        }
        if signing {
            // These deterministic seeds signed the checked-in legacy fixture.
            for (name, seed) in [
                ("APP_CATALOG_TARGETS_KEY", 3),
                ("APP_CATALOG_SNAPSHOT_KEY", 4),
                ("APP_CATALOG_TIMESTAMP_KEY", 5),
            ] {
                let pem = SigningKey::from_bytes(&[seed; 32])
                    .to_pkcs8_pem(Default::default())
                    .unwrap();
                command.env(name, pem.as_str());
            }
        }
        let mut child = command.spawn().unwrap();
        let input = child.stdin.take();
        let output = BufReader::new(child.stdout.take().unwrap());
        Self {
            child,
            input,
            output,
        }
    }

    fn input(&mut self) -> &mut ChildStdin {
        self.input.as_mut().unwrap()
    }

    fn send(&mut self, value: Value) {
        self.send_bytes(&serde_json::to_vec(&value).unwrap());
    }

    fn send_bytes(&mut self, bytes: &[u8]) {
        let header = u32::try_from(bytes.len()).unwrap().to_be_bytes();
        self.input().write_all(&header[..2]).unwrap();
        self.input().write_all(&header[2..]).unwrap();
        let halfway = bytes.len() / 2;
        self.input().write_all(&bytes[..halfway]).unwrap();
        self.input().write_all(&bytes[halfway..]).unwrap();
    }

    fn receive(&mut self) -> Value {
        serde_json::from_slice(&self.receive_bytes(4096)).unwrap()
    }

    fn receive_bytes(&mut self, max: usize) -> Vec<u8> {
        let mut header = [0; 4];
        self.output.read_exact(&mut header).unwrap();
        let length = u32::from_be_bytes(header) as usize;
        assert!((1..=max).contains(&length));
        let mut bytes = vec![0; length];
        self.output.read_exact(&mut bytes).unwrap();
        bytes
    }

    fn start_read(&mut self, root: &[u8]) {
        self.send(
            json!({"type": "read", "now": NOW, "allowExpiredRoles": false, "nextRoot": false}),
        );
        self.send_bytes(root);
    }

    fn read(&mut self, root: &[u8], files: &Files) -> Value {
        self.start_read(root);
        let mut requests = Vec::new();
        let reply = loop {
            let reply = self.receive();
            if reply["type"] != "request" {
                break reply;
            }
            let path = reply["path"].as_str().unwrap();
            let limit = reply["maxBytes"].as_u64().unwrap() as usize;
            requests.push(path.to_owned());
            let bytes = files.get(path);
            self.send(json!({"type": "file", "found": bytes.is_some()}));
            if let Some(bytes) = bytes {
                assert!(bytes.len() <= limit);
                self.send_bytes(bytes);
            }
        };
        assert!(requests.iter().any(|path| path == ROOT));
        assert!(requests.iter().any(|path| path == "metadata/2.root.json"));
        assert!(requests.iter().any(|path| path == TIMESTAMP));
        reply
    }

    fn update(&mut self, generation: u64, catalog: &[u8], next_root: Option<&[u8]>, icons: &Files) {
        self.send(json!({
            "type": "update", "generation": generation, "now": NOW,
            "nextRoot": next_root.is_some(), "icons": icons.len(),
        }));
        self.send_bytes(catalog);
        if let Some(next_root) = next_root {
            self.send_bytes(next_root);
        }
        for (path, bytes) in icons {
            self.send(json!({"path": path}));
            self.send_bytes(bytes);
        }
    }

    fn files(&mut self) -> Files {
        let reply = self.receive();
        assert_eq!(reply["type"], "files");
        let mut result = Files::new();
        for _ in 0..reply["count"].as_u64().unwrap() {
            let path = self.receive()["path"].as_str().unwrap().to_owned();
            let bytes = self.receive_bytes(16 * 1024 * 1024);
            assert!(result.insert(path, bytes).is_none());
        }
        result
    }

    fn error(&mut self, message: &str) {
        assert_error(&self.receive(), message);
    }

    fn finish(mut self) -> ExitStatus {
        self.input.take();
        self.child.wait().unwrap()
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        if self.child.try_wait().is_ok_and(|status| status.is_none()) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn assert_error(reply: &Value, message: &str) {
    assert_eq!(reply["type"], "error");
    assert!(
        reply["message"].as_str().unwrap().contains(message),
        "{reply}"
    );
}

fn legacy() -> Files {
    let files: BTreeMap<String, String> =
        serde_json::from_str(include_str!("fixtures/tuf-js-bootstrap.json")).unwrap();
    files
        .into_iter()
        .map(|(path, contents)| (path, contents.into_bytes()))
        .collect()
}

fn release(hash: &str, size: usize) -> Vec<u8> {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../contracts/v1/fixtures.json")).unwrap();
    let mut release = fixture["records"]["release"].clone();
    release["icon"] = json!({"format": "png", "sha256": hash, "sizeBytes": size});
    release["packages"] = Value::Array(
        fixture["targets"]
            .as_array()
            .unwrap()
            .iter()
            .cloned()
            .map(|mut package| {
                let target = package.as_object_mut().unwrap().remove("target").unwrap();
                let mut manifest = fixture["manifest"].clone();
                manifest["target"] = target;
                package["manifest"] = manifest;
                package
            })
            .collect(),
    );
    serde_json::to_vec(&json!({
        "formatVersion": 1, "revision": 2, "releases": [release], "revocations": [],
    }))
    .unwrap()
}

#[test]
fn worker_keeps_the_verified_checkpoint_until_it_reads_the_promoted_files() {
    let mut worker = Worker::spawn(true);
    let previous = legacy();
    let root = &previous[ROOT];
    worker.send(json!({"type": "bootstrap", "now": "invalid"}));
    worker.send_bytes(root);
    worker.error("Invalid catalog time");
    worker.send(json!({"type": "bootstrap", "now": NOW}));
    worker.send_bytes(root);
    assert_eq!(worker.files()[ROOT], *root);

    assert_eq!(
        worker.read(root, &previous),
        json!({"type": "catalog", "generation": 1})
    );
    let previous_catalog = worker.receive_bytes(16 * 1024 * 1024);
    assert_eq!(
        serde_json::from_slice::<Value>(&previous_catalog).unwrap()["revision"],
        1
    );
    // The legacy timestamp has under 36 hours left, so an unchanged catalog renews only
    // the timestamp and never republishes the installed root.
    worker.update(1, b"", Some(root), &Files::new());
    assert_eq!(worker.files().into_keys().collect::<Vec<_>>(), [TIMESTAMP]);

    let icon = vec![0xff; 100_000];
    let hash = hex::encode(Sha256::digest(&icon));
    let catalog = release(&hash, icon.len());
    let icon_name = format!("assets/{hash}.png");
    let static_icon = format!("targets/assets/{hash}.{hash}.png");
    worker.update(
        1,
        &catalog,
        None,
        &Files::from([(icon_name.clone(), b"wrong".to_vec())]),
    );
    worker.error("Supplied icon bytes");
    worker.update(1, &catalog, None, &Files::from([(icon_name, icon.clone())]));
    let changes = worker.files();
    assert_eq!(changes[&static_icon], icon);

    worker.update(1, b"", None, &Files::new());
    assert_eq!(worker.files().into_keys().collect::<Vec<_>>(), [TIMESTAMP]);
    let mut promoted = previous.clone();
    promoted.extend(changes);
    assert_eq!(
        worker.read(root, &promoted),
        json!({"type": "catalog", "generation": 2})
    );
    assert_eq!(worker.receive_bytes(16 * 1024 * 1024), catalog);
    assert_error(&worker.read(root, &previous), "rollback");
    worker.update(1, b"", None, &Files::new());
    worker.error("Stale trusted catalog generation");
    worker.update(2, b"", None, &Files::new());
    assert!(worker.files().is_empty());
    assert!(worker.finish().success());
}

#[test]
fn read_only_worker_recovers_from_a_missing_file_but_stops_on_an_oversized_frame() {
    let mut worker = Worker::spawn(false);
    let files = legacy();
    let root = &files[ROOT];
    let mut incomplete = files.clone();
    incomplete.insert(TIMESTAMP.into(), Vec::new());
    assert_error(
        &worker.read(root, &incomplete),
        "Missing or oversized catalog file",
    );
    worker.start_read(root);
    assert_eq!(worker.receive()["type"], "request");
    worker.send(json!({"type": "fileError"}));
    worker.error("Catalog file source failed");
    assert_eq!(
        worker.read(root, &files),
        json!({"type": "catalog", "generation": 1})
    );
    worker.receive_bytes(16 * 1024 * 1024);
    worker.update(1, b"", None, &Files::new());
    worker.error("Missing catalog signing keys");

    worker.start_read(root);
    assert_eq!(
        worker.receive(),
        json!({"type": "request", "path": ROOT, "maxBytes": 512 * 1024})
    );
    worker.send(json!({"type": "file", "found": true}));
    worker
        .input()
        .write_all(&(512_u32 * 1024 + 1).to_be_bytes())
        .unwrap();
    assert!(!worker.finish().success());
}

#[test]
fn worker_rejects_invalid_command_framing_and_out_of_scope_icon_paths() {
    let mut oversized = Worker::spawn(false);
    oversized
        .input()
        .write_all(&4097_u32.to_be_bytes())
        .unwrap();
    assert!(!oversized.finish().success());

    let mut truncated = Worker::spawn(false);
    truncated.input().write_all(&[0, 0]).unwrap();
    assert!(!truncated.finish().success());

    let mut path = Worker::spawn(false);
    path.send(json!({"type": "update", "generation": 1, "nextRoot": false, "icons": 1}));
    path.send_bytes(b"");
    path.send(json!({"path": "../outside.png"}));
    assert!(!path.finish().success());
}
