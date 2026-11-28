use marketplace_tooling::{coverage, oci, policy, project, release, security, verification};
use rentnerproxy_artifacts::{invalid, read_request};
use serde_json::Value;
use std::io::{self, Write};
use std::process::ExitCode;

fn execute(operation: &str, input: Value) -> io::Result<Value> {
    let (domain, command) = operation
        .split_once('-')
        .ok_or_else(|| invalid("Expected a native tooling operation"))?;
    match domain {
        "oci" => oci::execute(command, input),
        "release" => release::execute(command, input),
        "security" => security::execute(command, input),
        "policy" => policy::execute(command, input),
        "coverage" => coverage::execute(command, input),
        "project" => project::execute(command, input),
        "verification" => verification::execute(command, input),
        _ => Err(invalid("Unknown native tooling operation")),
    }
}

fn run() -> io::Result<()> {
    let operation = std::env::args()
        .nth(1)
        .ok_or_else(|| invalid("Expected a native tooling operation"))?;
    let result = execute(&operation, read_request(io::stdin().lock())?)?;
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
