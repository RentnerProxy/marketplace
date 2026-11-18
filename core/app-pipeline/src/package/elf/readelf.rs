use std::collections::BTreeSet;
use std::io::{self, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use regex::Regex;

use super::invalid;

const REPORT_LIMIT: u64 = 2 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);

pub(super) fn verify(path: &Path, needed: &[String]) -> io::Result<()> {
    let report =
        report(path).map_err(|_| invalid("Linux readelf could not verify the candidate binary"))?;
    let reported = report
        .lines()
        .filter_map(|line| dynamic_value(line, "(NEEDED)", "Shared library: ["));
    if !reported.eq(needed.iter().map(String::as_str)) {
        return Err(invalid(
            "ELF dynamic program headers and readelf dependencies disagree",
        ));
    }
    Ok(())
}

fn dynamic_value<'a>(line: &'a str, tag: &str, label: &str) -> Option<&'a str> {
    let (_, detail) = line.split_once(tag)?;
    let library = detail.trim_start().strip_prefix(label)?;
    let (library, _) = library.split_once(']')?;
    (!library.is_empty()).then_some(library)
}

pub(super) fn definitions(path: &Path, library: &str) -> io::Result<BTreeSet<String>> {
    let report = report(path)
        .map_err(|_| invalid("Linux readelf could not verify the pinned appliance library"))?;
    parse_definitions(&report, library)
}

fn parse_definitions(report: &str, library: &str) -> io::Result<BTreeSet<String>> {
    let malformed = || invalid("Could not read the pinned appliance library version definitions");
    let soname = report
        .lines()
        .find_map(|line| dynamic_value(line, "(SONAME)", "Library soname: ["));
    if soname != Some(library) {
        return Err(malformed());
    }
    let mut lines = report.lines();
    let Some(header) = lines.find(|line| line.starts_with("Version definition section ")) else {
        return Ok(BTreeSet::new());
    };
    let (_, declaration) = header.rsplit_once(" contains ").ok_or_else(malformed)?;
    let count = declaration
        .strip_suffix(" entries:")
        .or_else(|| declaration.strip_suffix(" entry:"))
        .and_then(|digits| digits.parse::<usize>().ok())
        .ok_or_else(malformed)?;
    let record =
        Regex::new(r"^\s*(?:0x)?[0-9a-f]+:\s+Rev:\s+[0-9]+.*?\bName:\s+([A-Za-z0-9_.+-]+)\s*$")
            .expect("readelf version definition row pattern");
    let mut names: BTreeSet<_> = lines
        .take_while(|line| !line.starts_with("Version "))
        .filter_map(|line| record.captures(line).and_then(|capture| capture.get(1)))
        .map(|name| name.as_str().to_owned())
        .collect();
    if names.len() != count {
        return Err(malformed());
    }
    names.remove(library);
    Ok(names)
}

fn report(path: &Path) -> io::Result<String> {
    let mut child = Command::new("/usr/bin/readelf")
        .args([
            "--wide",
            "--use-dynamic",
            "--dynamic",
            "--version-info",
            "--",
        ])
        .arg(path)
        .env_clear()
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().expect("piped readelf stdout");
    let stderr = child.stderr.take().expect("piped readelf stderr");
    thread::scope(|scope| {
        let out = scope.spawn(move || read_bounded(stdout));
        let err = scope.spawn(move || read_bounded(stderr));
        let deadline = Instant::now() + TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
                result => {
                    let _ = child.kill();
                    child.wait()?;
                    break Err(result.err().unwrap_or_else(|| {
                        io::Error::new(io::ErrorKind::TimedOut, "readelf timed out")
                    }));
                }
            }
        }?;
        let stdout = out
            .join()
            .map_err(|_| invalid("readelf output read failed"))??;
        let stderr = err
            .join()
            .map_err(|_| invalid("readelf error read failed"))??;
        if !status.success() || !stderr.trim().is_empty() {
            return Err(invalid("readelf reported diagnostics"));
        }
        Ok(stdout)
    })
}

fn read_bounded(stream: impl Read) -> io::Result<String> {
    let mut bytes = Vec::new();
    if stream.take(REPORT_LIMIT + 1).read_to_end(&mut bytes)? > REPORT_LIMIT as usize {
        return Err(invalid("readelf report exceeds its limit"));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_soname_and_reads_definitions_independently_from_dependencies() {
        let report = " 0x000000000000000e (SONAME) Library soname: [libstdc++.so.6]\n\
Version definition section '.gnu.version_d' contains 3 entries:\n\
 Addr: 0x0000000000000050  Offset: 0x00000050  Link: 5 (.dynstr)\n\
  000000: Rev: 1  Flags: BASE  Index: 1  Cnt: 1  Name: libstdc++.so.6\n\
  0x001c: Rev: 1  Flags: none  Index: 2  Cnt: 1  Name: GLIBCXX_3.4.33\n\
  0x0038: Rev: 1  Flags: none  Index: 3  Cnt: 1  Name: CXXABI_1.3.15\n\
Version needs section '.gnu.version_r' contains 1 entry:\n\
  000000: Version: 1  File: libc.so.6  Cnt: 1\n\
  0x0010:   Name: GLIBC_2.41  Flags: none  Version: 4\n";
        assert_eq!(
            parse_definitions(report, "libstdc++.so.6").unwrap(),
            BTreeSet::from(["CXXABI_1.3.15".into(), "GLIBCXX_3.4.33".into(),])
        );
        assert!(parse_definitions(report, "libc.so.6").is_err());
        assert!(
            parse_definitions(&report.replace("3 entries", "4 entries"), "libstdc++.so.6").is_err()
        );
    }
}
