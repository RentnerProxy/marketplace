use super::valid_iso_timestamp;

#[test]
fn utc_timestamp_syntax_preserves_the_legacy_journal_format() {
    for value in [
        "2026-11-24T12:34:56Z",
        "2026-11-24T23:59:59.0000123456789Z",
        "2026-11-24T29:00:00Z",
    ] {
        assert!(valid_iso_timestamp(value), "{value}");
    }
    for value in [
        "2026-11-24T30:00:00Z",
        "2026-11-24T12:60:00Z",
        "2026-11-24T12:34:60Z",
        "2026-11-24T12:34:56.Z",
        "2026-11-24T12:34:56.٣Z",
        "2026-11-24T12:34:56+00:00",
        "2026-11-24T12:34:56z",
        "2026-1-2T12:34:56Z",
        "prefix2026-11-24T12:34:56Z",
        "2026-11-24T12:34:56.ZZ",
    ] {
        assert!(!valid_iso_timestamp(value), "{value}");
    }
}
