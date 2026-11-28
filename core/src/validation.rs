/// The ASCII UTC timestamp syntax used in restore journals and backup manifests.
/// Callers that require calendar validation also parse the timestamp as RFC 3339.
pub(crate) fn valid_iso_timestamp(value: &str) -> bool {
    let Some(value) = value.as_bytes().strip_suffix(b"Z") else {
        return false;
    };
    let [
        year @ ..,
        b'-',
        m1,
        m2,
        b'-',
        d1,
        d2,
        b'T',
        b'0'..=b'2',
        h2,
        b':',
        b'0'..=b'5',
        m4,
        b':',
        b'0'..=b'5',
        s2,
    ] = value.get(..19).unwrap_or_default()
    else {
        return false;
    };
    if !year
        .iter()
        .chain([m1, m2, d1, d2, h2, m4, s2])
        .all(u8::is_ascii_digit)
    {
        return false;
    }
    match &value[19..] {
        [] => true,
        [b'.', fraction @ ..] => !fraction.is_empty() && fraction.iter().all(u8::is_ascii_digit),
        _ => false,
    }
}

#[cfg(test)]
#[path = "../tests/unit/validation.rs"]
mod tests;
