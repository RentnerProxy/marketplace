use marketplace_app_pipeline::smoke;
use marketplace_artifacts::{invalid, read_request};
use std::io::{self, Write};
use std::process::ExitCode;

fn run() -> io::Result<()> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("smoke-probe") || args.next().is_some() {
        return Err(invalid("Expected the smoke-probe operation"));
    }
    smoke::probe(read_request(io::stdin().lock())?)?;
    let mut stdout = io::stdout().lock();
    stdout.write_all(b"null")?;
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
