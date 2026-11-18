use std::collections::BTreeMap;

use marketplace_app_catalog::{ReadOptions, read_catalog};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[test]
fn reads_the_catalog_signed_by_the_previous_javascript_publisher() {
    // Immutable output from the former @tufjs/models publisher using synthetic test keys.
    let files: BTreeMap<String, String> =
        serde_json::from_str(include_str!("fixtures/tuf-js-bootstrap.json")).unwrap();
    let root = files["metadata/1.root.json"].as_bytes();
    let now = OffsetDateTime::parse("2026-11-01T01:00:00Z", &Rfc3339).unwrap();
    let verified = read_catalog(
        |path, limit| {
            Ok(files.get(path).map(|contents| {
                assert!(contents.len() <= limit);
                contents.as_bytes().to_vec()
            }))
        },
        root,
        ReadOptions {
            now,
            allow_expired_roles: false,
            next_root: None,
            previous: None,
        },
    )
    .unwrap();

    assert_eq!(
        verified.catalog_bytes(),
        br#"{"formatVersion":1,"revision":1,"releases":[],"revocations":[]}"#,
    );
}
