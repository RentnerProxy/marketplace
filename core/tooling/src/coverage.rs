use rentnerproxy_artifacts::{invalid, read_file};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::io;
use std::path::PathBuf;

const MAX_SAFE: u64 = 9_007_199_254_740_991;
const METRICS: [&str; 5] = ["SF", "LF", "LH", "FNF", "FNH"];

#[derive(Default, Deserialize, Serialize)]
struct Count {
    found: u64,
    hit: u64,
}

#[derive(Default, Deserialize, Serialize)]
struct Summary {
    files: u64,
    lines: Count,
    functions: Count,
}

#[derive(Deserialize)]
struct Thresholds {
    lines: f64,
    functions: f64,
}

fn totals(current: &mut Count, values: &[u64]) -> io::Result<()> {
    if values[1] > values[0] {
        return Err(invalid("LCOV covered counts exceed measured totals."));
    }
    let add = |left: u64, right: u64| {
        left.checked_add(right)
            .filter(|sum| *sum <= MAX_SAFE)
            .ok_or_else(|| invalid("LCOV coverage totals exceed safe integers."))
    };
    current.found = add(current.found, values[0])?;
    current.hit = add(current.hit, values[1])?;
    Ok(())
}

fn parse(report: &str) -> io::Result<Summary> {
    if report.trim_end().lines().last() != Some("end_of_record") {
        return Err(invalid("Missing or incomplete LCOV report."));
    }
    let mut summary = Summary::default();
    let mut sources = HashSet::new();
    let mut fields = HashMap::new();
    for line in report.trim_end().lines() {
        if line == "end_of_record" {
            let source = fields
                .remove("SF")
                .filter(|source: &&str| !source.is_empty());
            if !source.is_some_and(|source| sources.insert(source)) {
                return Err(invalid("Missing or duplicate LCOV source record."));
            }
            let mut counts = [0; 4];
            for (count, key) in counts.iter_mut().zip(&METRICS[1..]) {
                let value = fields
                    .remove(key)
                    .filter(|s| !s.is_empty() && s.bytes().all(|byte| byte.is_ascii_digit()))
                    .ok_or_else(|| invalid("Missing or invalid LCOV coverage counts."))?;
                *count = value
                    .parse::<u64>()
                    .ok()
                    .filter(|value| *value <= MAX_SAFE)
                    .ok_or_else(|| invalid("LCOV coverage counts exceed safe integers."))?;
            }
            totals(&mut summary.lines, &counts[..2])?;
            totals(&mut summary.functions, &counts[2..])?;
            summary.files += 1;
        } else if let Some((key, value)) = line.split_once(':')
            && METRICS.contains(&key)
            && fields.insert(key, value).is_some()
        {
            return Err(invalid("Duplicate LCOV summary field."));
        }
    }
    if summary.files == 0 || summary.lines.found == 0 || summary.functions.found == 0 {
        return Err(invalid(
            "Coverage report has no measured source lines or functions.",
        ));
    }
    Ok(summary)
}

fn check(summary: &Summary, minimum: Thresholds) -> io::Result<Value> {
    if ![minimum.lines, minimum.functions]
        .into_iter()
        .all(|value| (0.0..=1.0).contains(&value))
    {
        return Err(invalid(
            "Coverage thresholds must be fractions between zero and one.",
        ));
    }
    let checked = |count: &Count| count.hit as f64 / count.found as f64;
    let lines = checked(&summary.lines);
    let functions = checked(&summary.functions);
    let failures = [
        ("lines", lines, minimum.lines),
        ("functions", functions, minimum.functions),
    ]
    .into_iter()
    .filter(|(_, actual, minimum)| actual < minimum)
    .map(|(name, actual, minimum)| {
        format!(
            "Global {name} coverage {:.2}% is below {:.2}%.",
            actual * 100.0,
            minimum * 100.0
        )
    })
    .collect::<Vec<_>>();
    if !failures.is_empty() {
        return Err(invalid(failures.join(" ")));
    }
    Ok(json!({ "lines": lines, "functions": functions }))
}

fn thresholds(input: &Value) -> io::Result<Thresholds> {
    serde_json::from_value(input["thresholds"].clone())
        .map_err(|_| invalid("Coverage thresholds must be fractions between zero and one."))
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation {
        "parse" => Ok(serde_json::to_value(parse(
            input["report"]
                .as_str()
                .ok_or_else(|| invalid("Missing or incomplete LCOV report."))?,
        )?)?),
        "check" => check(
            &serde_json::from_value(input["summary"].clone())?,
            thresholds(&input)?,
        ),
        "file" => {
            let path: PathBuf = serde_json::from_value(input["path"].clone())?;
            let bytes = read_file(&path, 64 * 1024 * 1024)?;
            let report =
                std::str::from_utf8(&bytes).map_err(|_| invalid("Invalid LCOV encoding."))?;
            let summary = parse(report)?;
            Ok(json!({ "percentages": check(&summary, thresholds(&input)?)?, "summary": summary }))
        }
        _ => Err(invalid("Unknown coverage operation")),
    }
}
