use marketplace_app_pipeline::{
    dependency, evidence, package, publication, sandbox, sbom, smoke, source,
};
use marketplace_artifacts::{FileIdentity, invalid, read_request, verify_stream};
use serde_json::Value;
use std::io::{self, Write};
use std::path::Path;
use std::process::ExitCode;

fn execute(operation: &str, input: Value) -> io::Result<Value> {
    if let Some(command) = operation.strip_prefix("evidence-") {
        evidence::execute(command, input)
    } else if let Some(command) = operation.strip_prefix("source-") {
        source::execute(command, input)
    } else if let Some(command) = operation.strip_prefix("dependency-") {
        dependency::execute(command, input)
    } else if let Some(command) = operation.strip_prefix("sbom-") {
        sbom::execute(command, input)
    } else if let Some(command) = operation.strip_prefix("sandbox-") {
        sandbox::execute(command, input)
    } else if let Some(command) = operation.strip_prefix("publication-") {
        publication::execute(command, input)
    } else if operation == "smoke-bootstrap" {
        smoke::bootstrap(&input)
    } else if operation == "smoke-probe" {
        smoke::probe(input)?;
        Ok(Value::Null)
    } else {
        package::execute(operation, input)
    }
}

fn run() -> io::Result<()> {
    let mut args = std::env::args().skip(1);
    let operation = args
        .next()
        .ok_or_else(|| invalid("Expected a native app pipeline operation"))?;
    let stdin = io::stdin().lock();
    let result = if operation == "stream-verify" {
        let expected = FileIdentity {
            size_bytes: args
                .next()
                .and_then(|size| size.parse::<u64>().ok())
                .filter(|size| *size <= evidence::BUNDLE_LIMIT)
                .ok_or_else(|| invalid("Invalid expected artifact length"))?,
            sha256: args
                .next()
                .filter(|sha| {
                    sha.len() == 64
                        && sha
                            .bytes()
                            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                })
                .ok_or_else(|| invalid("Invalid expected artifact digest"))?,
        };
        let destination = args.next();
        if args.next().is_some() {
            return Err(invalid("Unexpected stream verification argument"));
        }
        serde_json::to_value(verify_stream(
            stdin,
            &expected,
            destination.as_deref().map(Path::new),
        )?)?
    } else {
        execute(&operation, read_request(stdin)?)?
    };
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    serde_json::to_writer(&mut stdout, &result)?;
    stdout.flush()
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
