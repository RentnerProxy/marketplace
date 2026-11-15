use marketplace_core::postgres::connection;
use marketplace_core::{postgres::execute, protocol::OperationContext};
use serde_json::json;
use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

#[test]
fn passwords_are_decoded_and_removed_from_connection_url() {
    let (url,password)=connection("postgresql://user:user%2Bpass@localhost/test?sslmode=require&password=first&password=query%2Bsecret",Some("fallback")).unwrap();
    assert_eq!(password.as_deref(), Some("query+secret"));
    assert!(!url.contains("secret"));
    assert!(!url.contains("password"));
    assert!(!url.contains("user%2Bpass"));
    assert!(url.contains("sslmode=require"));
}

#[test]
fn malformed_password_and_protocol_are_rejected_without_echoing_secrets() {
    for url in [
        "postgresql://user:secret%ZZ@localhost/test",
        "https://user:secret@localhost/test",
        "not-a-url-secret",
    ] {
        let error = connection(url, None).unwrap_err();
        assert!(!error.message.contains("secret"));
    }
}

#[test]
fn empty_query_password_overrides_fallback_and_plus_is_literal() {
    assert_eq!(
        connection(
            "postgresql://user@localhost/test?password=",
            Some("fallback")
        )
        .unwrap()
        .1,
        Some(String::new())
    );
    assert_eq!(
        connection("postgresql://user:a+b@localhost/test", None)
            .unwrap()
            .1
            .as_deref(),
        Some("a+b")
    );
}

fn process_fixture(mode: &str) -> (tempfile::TempDir, PathBuf) {
    let fixture = tempfile::tempdir().unwrap();
    let source = fixture.path().join("fake-postgres.rs");
    fs::write(&source,r#"
use std::{env,fs,io::{self,Read,Write},process,time::Duration,thread};
fn main(){
    let exe=env::current_exe().unwrap();let name=exe.file_stem().unwrap().to_str().unwrap();
    let args=env::args().skip(1).collect::<Vec<_>>();
    if args==["--version"] {if fs::read_to_string(exe.parent().unwrap().join("mode")).unwrap()=="invalid-version"{println!("unexpected tool");}else{println!("{} (PostgreSQL) 17.0",name);}return;}
    if args.iter().any(|arg|arg.contains("postgresql:")||arg.contains("synthetic-secret")) {process::exit(91);}
    if !args.iter().any(|argument|argument=="--dbname=service=marketplace_core") {process::exit(94);}
    let service=fs::read_to_string(env::var("PGSERVICEFILE").unwrap()).unwrap();
    if !service.contains("[marketplace_core]\n")||!service.contains("host=localhost\n")||!service.contains("dbname=synthetic\n")||!service.contains("user=user\n")||service.contains("secret")||service.contains("password=")||env::var("PGPASSWORD").unwrap()!="synthetic-secret"||env::var_os("PGDATABASE").is_some() {process::exit(92);}
    let parent=exe.parent().unwrap();fs::write(parent.join("started"),b"started").unwrap();
    match fs::read_to_string(parent.join("mode")).unwrap().as_str(){
        "failure"=>{eprintln!("server version mismatch synthetic-secret");process::exit(1);},
        "command-failure"=>{eprintln!("synthetic-secret");process::exit(3);},
        "sleep"=>thread::sleep(Duration::from_secs(30)),
        _=>(),
    }
    if name=="pg_dump" {io::stdout().write_all(b"PGDMP-synthetic").unwrap();}
    else {let mut input=Vec::new();io::stdin().read_to_end(&mut input).unwrap();if input!=b"PGDMP-synthetic" {process::exit(93);}}
}
"#).unwrap();
    let executable = fixture.path().join(if cfg!(windows) {
        "pg_dump.exe"
    } else {
        "pg_dump"
    });
    let status = std::process::Command::new("rustc")
        .args(["--edition=2024", "-o"])
        .arg(&executable)
        .arg(&source)
        .status()
        .unwrap();
    assert!(status.success());
    fs::copy(
        &executable,
        fixture.path().join(if cfg!(windows) {
            "pg_restore.exe"
        } else {
            "pg_restore"
        }),
    )
    .unwrap();
    fs::write(fixture.path().join("mode"), mode).unwrap();
    (fixture, executable)
}
fn process_request(fixture: &tempfile::TempDir, operation: &str) -> serde_json::Value {
    json!({"operation":operation,"path":fixture.path().join("database.dump"),"binaryDirectory":fixture.path(),"databaseUrl":"postgresql://user:userinfo-secret@localhost/synthetic?password=synthetic-secret","timeoutMs":5000})
}

fn assert_service_file_removed(fixture: &tempfile::TempDir) {
    assert!(fs::read_dir(fixture.path()).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".postgres-service-")
    }));
}

#[test]
fn native_process_uses_secret_free_argv_and_handle_based_dump_restore() {
    let (fixture, _) = process_fixture("success");
    execute(
        &process_request(&fixture, "postgresDump"),
        &OperationContext::default(),
    )
    .unwrap();
    assert_eq!(
        fs::read(fixture.path().join("database.dump")).unwrap(),
        b"PGDMP-synthetic"
    );
    execute(
        &process_request(&fixture, "postgresRestore"),
        &OperationContext::default(),
    )
    .unwrap();
    assert_service_file_removed(&fixture);
}

#[test]
fn native_process_suppresses_raw_stderr_and_preserves_version_error_code() {
    let (fixture, _) = process_fixture("failure");
    let error = execute(
        &process_request(&fixture, "postgresDump"),
        &OperationContext::default(),
    )
    .unwrap_err();
    assert_eq!(error.code, "BACKUP_POSTGRES_VERSION_MISMATCH");
    assert!(!error.message.contains("synthetic-secret"));
    assert!(!fixture.path().join("database.dump").exists());
    assert_service_file_removed(&fixture);
}

#[test]
fn native_process_deadline_terminates_and_reaps_child_before_return() {
    let (fixture, _) = process_fixture("sleep");
    let mut request = process_request(&fixture, "postgresDump");
    request["timeoutMs"] = json!(1000);
    let started = Instant::now();
    let error = execute(&request, &OperationContext::default()).unwrap_err();
    assert_eq!(error.code, "BACKUP_POSTGRES_TIMEOUT");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!fixture.path().join("database.dump").exists());
    assert_service_file_removed(&fixture);
}

#[test]
fn native_process_cancellation_terminates_and_reaps_child_before_return() {
    let (fixture, _) = process_fixture("sleep");
    let context = OperationContext::default();
    let cancellation = context.clone();
    let marker = fixture.path().join("started");
    let cancel = std::thread::spawn(move || {
        for _ in 0..200 {
            if marker.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        cancellation.cancel();
    });
    let error = execute(&process_request(&fixture, "postgresDump"), &context).unwrap_err();
    cancel.join().unwrap();
    assert_eq!(error.code, "CORE_CANCELLED");
    assert!(!fixture.path().join("database.dump").exists());
    assert_service_file_removed(&fixture);
}

#[test]
fn native_process_rejects_missing_binary_invalid_version_empty_dump_and_bad_timeout() {
    let (fixture, _) = process_fixture("invalid-version");
    assert_eq!(
        execute(
            &process_request(&fixture, "postgresDump"),
            &OperationContext::default()
        )
        .unwrap_err()
        .code,
        "BACKUP_POSTGRES_VERSION_MISMATCH"
    );
    fs::write(fixture.path().join("mode"), "success").unwrap();
    fs::write(fixture.path().join("database.dump"), []).unwrap();
    assert_eq!(
        execute(
            &process_request(&fixture, "postgresRestore"),
            &OperationContext::default()
        )
        .unwrap_err()
        .code,
        "BACKUP_POSTGRES_DUMP_INVALID"
    );
    let mut request = process_request(&fixture, "postgresDump");
    request["timeoutMs"] = json!(0);
    assert_eq!(
        execute(&request, &OperationContext::default())
            .unwrap_err()
            .code,
        "BACKUP_POSTGRES_CONFIG"
    );
    request["timeoutMs"] = json!(1000);
    request["binaryDirectory"] = json!(fixture.path().join("missing-bin"));
    assert_eq!(
        execute(&request, &OperationContext::default())
            .unwrap_err()
            .code,
        "BACKUP_POSTGRES_BINARY_MISSING"
    );
}

#[test]
fn non_version_process_failures_never_echo_stderr() {
    let (fixture, _) = process_fixture("command-failure");
    let error = execute(
        &process_request(&fixture, "postgresDump"),
        &OperationContext::default(),
    )
    .unwrap_err();
    assert_eq!(error.code, "BACKUP_POSTGRES_COMMAND_FAILED");
    assert!(!error.message.contains("synthetic-secret"));
    assert!(!fixture.path().join("database.dump").exists());
}
