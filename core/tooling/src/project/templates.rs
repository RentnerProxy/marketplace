use std::io;

use regex::{Captures, Regex};
use rentnerproxy_artifacts::invalid;

use super::Config;

struct Rule<'a> {
    pattern: &'static str,
    value: &'a str,
    field: &'static str,
}

fn rules(content: &str, rules: &[Rule<'_>], compose: bool) -> io::Result<String> {
    let mut text = content.to_owned();
    for rule in rules {
        let pattern = Regex::new(rule.pattern).expect("built-in project identity pattern");
        if pattern.find_iter(&text).take(2).count() != 1 {
            let amount = if compose {
                "1 Treffer"
            } else {
                "genau einen Treffer"
            };
            return Err(invalid(format!(
                "Statische Projektidentität benötigt {amount} für {}.",
                rule.field
            )));
        }
        text = pattern
            .replace(&text, |captures: &Captures<'_>| {
                let suffix = captures.get(2).map_or("", |value| value.as_str());
                format!("{}{value}{suffix}", &captures[1], value = rule.value)
            })
            .into_owned();
    }
    Ok(text)
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).expect("project display name is a JSON string")
}

fn dockerfile_string(value: &str) -> String {
    let value = value
        .replace('\\', r"\\")
        .replace('"', r#"\""#)
        .replace('$', r"\$");
    format!(r#""{value}""#)
}

fn documentation_value(key: &str, config: &Config) -> io::Result<String> {
    let id = &config.id;
    let role = &config.database_role;
    let name = &config.database_name;
    let schema = &config.database_schema;
    let value = match key {
        "defaultName" => config
            .default_name
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;"),
        "dataVolume" => format!("`{id}_data`"),
        "applianceService" => format!("`{id}`"),
        "databaseVolume" => format!("`{id}_db_data`"),
        "storageVolume" => format!("`{id}_app_storage`"),
        "databaseRole" => format!("`{role}`"),
        "databaseSchema" => format!("`{schema}`"),
        "databaseNameAssignment" => format!("`POSTGRES_DB={name}`"),
        "runtimeRoleAssignment" => "`POSTGRES_USER=postgres`".to_owned(),
        "mailQueue" => "`rentnerproxy-marketplace-mail-v2`".to_owned(),
        "mailQuiescenceKey" => "`rentnerproxy-marketplace:mail:restore-quiescence:v1`".to_owned(),
        "rolePasswordCommand" => format!("`docker compose exec {id} appliance-psql`"),
        "rolePassword" => format!("`\\password {role}`"),
        _ => {
            return Err(invalid(format!(
                "Unbekanntes Projektfeld in der Dokumentation: {key}"
            )));
        }
    };
    Ok(value)
}

fn documentation(content: &str, config: &Config) -> io::Result<String> {
    let marker = Regex::new(r"(?s)<!-- project:([A-Za-z0-9_]+) -->.*?<!-- /project -->")
        .expect("built-in project documentation marker");
    let mut next = String::with_capacity(content.len());
    let mut copied = 0;
    for captures in marker.captures_iter(content) {
        let span = captures.get(0).expect("project documentation match");
        let key = &captures[1];
        let value = documentation_value(key, config)?;
        next.push_str(&content[copied..span.start()]);
        next.push_str(&format!("<!-- project:{key} -->{value}<!-- /project -->"));
        copied = span.end();
    }
    next.push_str(&content[copied..]);
    for (pattern, value) in [
        (r"(?mR)^([ \t]*-t )[a-z][a-z0-9_-]*(:local \.)$", &config.id),
        (
            r"(?mR)^([ \t]*-U postgres -d )[a-z][a-z0-9_]*( \\)$",
            &config.database_name,
        ),
        (
            r"(?mR)^([ \t]*-v runtime_role=)[a-z][a-z0-9_]*( \\)$",
            &config.database_role,
        ),
    ] {
        let pattern = Regex::new(pattern).expect("built-in project command example");
        next = pattern
            .replace_all(&next, |captures: &Captures<'_>| {
                format!("{}{value}{}", &captures[1], &captures[2])
            })
            .into_owned();
    }
    Ok(next)
}

pub(super) fn render(file: &str, content: &str, config: &Config) -> io::Result<String> {
    let display_name = json_string(&config.default_name);
    let package_name = json_string(&config.package_name);
    let docker_name = dockerfile_string(&config.default_name);
    let volume = format!("{}_data:", config.id);
    let env_comment = format!("\"{}", config.default_name);

    let patches: &[Rule<'_>] = match file {
        "package.json" => &[Rule {
            pattern: r#"("name"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*""#,
            value: &package_name,
            field: "packageName",
        }],
        "bun.lock" => &[Rule {
            pattern: r#"(""\s*:\s*\{\s*\r?\n\s*"name"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*""#,
            value: &package_name,
            field: "packageName in bun.lock",
        }],
        "web/public/manifest.json" => &[
            Rule {
                pattern: r#"("short_name"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*""#,
                value: &display_name,
                field: "manifest short_name",
            },
            Rule {
                pattern: r#"("name"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*""#,
                value: &display_name,
                field: "manifest name",
            },
        ],
        "Dockerfile" => &[
            Rule {
                pattern: r#"(?mR)^(LABEL[ \t]+org\.opencontainers\.image\.title=)"(?:\\[\s\S]|[^"\\\r\n])*""#,
                value: &docker_name,
                field: "OCI title",
            },
            Rule {
                pattern: r#"(?mR)^([ \t]+MAIL_FROM_NAME=)"(?:\\[\s\S]|[^"\\\r\n])*""#,
                value: &docker_name,
                field: "mail sender name",
            },
            Rule {
                pattern: r"(?mR)^([ \t]+POSTGRES_DB=)[a-z][a-z0-9_]*([ \t]+\\)[ \t]*$",
                value: &config.database_name,
                field: "runtime databaseName",
            },
        ],
        "docker-compose.yml" => &[
            Rule {
                pattern: r"(?mR)^(\s*image:\s*)[^@\s]+(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})[ \t]*$",
                value: &config.image_repository,
                field: "production imageRepository",
            },
            Rule {
                pattern: r"(?mR)^(    )[a-z][a-z0-9_-]*(:\r?\n        image:)",
                value: &config.id,
                field: "appliance service",
            },
            Rule {
                pattern: r"(?mR)^(\s*-\s+)[a-z][a-z0-9_-]*_data:(/data\s*)$",
                value: &volume,
                field: "appliance data volume",
            },
            Rule {
                pattern: r"(?mR)^([ \t]+)[a-z][a-z0-9_-]*_data:[ \t]*$",
                value: &volume,
                field: "appliance data volume definition",
            },
        ],
        ".env.dev.example" => &[Rule {
            pattern: r"(?mR)^(DATABASE_URL=.*/)[^\r\n]+$",
            value: &config.database_name,
            field: "development databaseName",
        }],
        ".env.example" => &[Rule {
            pattern: r#"(?mR)^(# @project:defaultName\r?\n# )".*("\. Passkey-Werte erben ORIGIN und die App-Defaults\.)$"#,
            value: &env_comment,
            field: "production mail sender documentation",
        }],
        "web/src/scripts/provision-runtime-database-role.sql" => &[
            Rule {
                pattern: r"(?mR)^(\\set runtime_role\s+)[a-z][a-z0-9_]{0,62}(\s*)$",
                value: &config.database_role,
                field: "SQL databaseRole",
            },
            Rule {
                pattern: r"(?mR)^(\s*application_schema constant text := ')[^']+(';\s*-- @project:databaseSchema\s*)$",
                value: &config.database_schema,
                field: "SQL databaseSchema",
            },
        ],
        "README.md" => return documentation(content, config),
        _ => {
            return Err(invalid(format!(
                "Datei ist nicht für Identitätssync freigegeben: {file}"
            )));
        }
    };
    rules(content, patches, file == "docker-compose.yml")
}
