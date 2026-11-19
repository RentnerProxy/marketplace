mod templates;

use std::{
    collections::HashSet,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::LazyLock,
};

use marketplace_artifacts::{invalid, read_file};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const FILES: [&str; 9] = [
    "package.json",
    "bun.lock",
    "web/public/manifest.json",
    "Dockerfile",
    "docker-compose.yml",
    ".env.dev.example",
    ".env.example",
    "web/src/scripts/provision-runtime-database-role.sql",
    "README.md",
];
const FILE_LIMIT: u64 = 32 * 1024 * 1024;

static IDENTIFIER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9_]{0,62}$").unwrap());
static ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9_-]{0,39}$").unwrap());
static PACKAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9_-]{0,99}$").unwrap());
static IMAGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9][a-z0-9._/-]*$").unwrap()
});

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    default_name: String,
    id: String,
    package_name: String,
    database_name: String,
    database_schema: String,
    database_role: String,
    image_repository: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RenderInput {
    file: String,
    content: String,
    config: Config,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlanInput {
    root: PathBuf,
    config: Config,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    root: PathBuf,
    changes: Vec<Change>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    file: String,
    path: PathBuf,
    before: String,
    after: String,
}

fn database_identifier(value: &str) -> bool {
    const RESERVED: &[&str] = &[
        "public",
        "drizzle",
        "information_schema",
        "pg_toast",
        "postgres",
        "template0",
        "template1",
        "none",
        "all",
        "current_user",
        "session_user",
    ];
    IDENTIFIER.is_match(value) && !value.starts_with("pg_") && !RESERVED.contains(&value)
}

impl Config {
    fn validate(&self) -> io::Result<()> {
        let name = self.default_name.as_str();
        let display = (1..=200).contains(&name.encode_utf16().count())
            && !name.encode_utf16().any(|unit| unit < 32 || unit == 127);
        let fields = [
            ("defaultName", display),
            ("id", ID.is_match(&self.id)),
            ("packageName", PACKAGE.is_match(&self.package_name)),
            ("databaseName", database_identifier(&self.database_name)),
            ("databaseSchema", database_identifier(&self.database_schema)),
            ("databaseRole", database_identifier(&self.database_role)),
            ("imageRepository", IMAGE.is_match(&self.image_repository)),
        ];
        if let Some((field, _)) = fields.into_iter().find(|(_, valid)| !valid) {
            return Err(invalid(format!("Ungültige Projektkonfiguration: {field}")));
        }
        Ok(())
    }
}

fn assert_root(root: &Path) -> io::Result<()> {
    if !root.is_absolute() || !fs::symlink_metadata(root)?.is_dir() {
        return Err(invalid(
            "Projektwurzel muss ein regulärer Repositorypfad sein.",
        ));
    }
    Ok(())
}

fn assert_file(root: &Path, file: &str) -> io::Result<PathBuf> {
    assert_root(root)?;
    if !FILES.contains(&file) {
        return Err(invalid(
            "Projektdatei ist nicht für den Identitätssync freigegeben.",
        ));
    }
    let mut path = root.to_owned();
    let mut components = file.split('/').peekable();
    while let Some(component) = components.next() {
        path.push(component);
        let entry = fs::symlink_metadata(&path)?;
        let regular = if components.peek().is_some() {
            entry.is_dir()
        } else {
            entry.is_file()
        };
        if !regular {
            return Err(invalid(format!(
                "Projektdatei muss ein regulärer Repositorypfad sein: {file}"
            )));
        }
    }
    Ok(path)
}

fn read_text(path: &Path) -> io::Result<String> {
    let bytes = read_file(path, FILE_LIMIT)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn plan(input: PlanInput) -> io::Result<Plan> {
    input.config.validate()?;
    let mut changes = Vec::new();
    for file in FILES {
        let path = assert_file(&input.root, file)?;
        let before = read_text(&path)?;
        let after = templates::render(file, &before, &input.config)?;
        if after != before {
            changes.push(Change {
                file: file.to_owned(),
                path,
                before,
                after,
            });
        }
    }
    Ok(Plan {
        root: input.root,
        changes,
    })
}

fn assert_current(root: &Path, change: &Change) -> io::Result<()> {
    let path = assert_file(root, &change.file)?;
    if path.as_os_str() != change.path.as_os_str() {
        return Err(invalid(
            "Projektdateipfad stimmt nicht mit dem Plan überein.",
        ));
    }
    if read_text(&path)? != change.before {
        return Err(invalid(format!(
            "Projektdatei wurde zwischenzeitlich geändert: {}",
            change.file
        )));
    }
    Ok(())
}

fn apply(plan: Plan) -> io::Result<Value> {
    let mut files = HashSet::new();
    for change in &plan.changes {
        if !files.insert(&change.file) {
            return Err(invalid("Projektdatei ist mehrfach im Plan enthalten."));
        }
        assert_current(&plan.root, change)?;
    }
    for change in &plan.changes {
        assert_current(&plan.root, change)?;
        let parent = change
            .path
            .parent()
            .ok_or_else(|| invalid("Projektdateipfad stimmt nicht mit dem Plan überein."))?;
        let mut temp = tempfile::Builder::new()
            .prefix(".project-sync-")
            .suffix(".tmp")
            .tempfile_in(parent)?;
        temp.write_all(change.after.as_bytes())?;
        temp.as_file()
            .set_permissions(fs::metadata(&change.path)?.permissions())?;
        temp.flush()?;
        assert_current(&plan.root, change)?;
        temp.persist(&change.path).map_err(|error| error.error)?;
    }
    Ok(Value::Null)
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation {
        "render" => {
            let input: RenderInput = serde_json::from_value(input)?;
            input.config.validate()?;
            Ok(json!(templates::render(
                &input.file,
                &input.content,
                &input.config
            )?))
        }
        "plan" => Ok(serde_json::to_value(plan(serde_json::from_value(input)?)?)?),
        "apply" => apply(serde_json::from_value(input)?),
        _ => Err(invalid("Unknown project identity operation")),
    }
}
