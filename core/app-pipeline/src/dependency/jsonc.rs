use std::io;

pub(super) fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes)
}

// Retain JSON tokens verbatim. Replace comments with whitespace and discard a
// trailing comma only after a value, leaving grammar and duplicate checks to
// the shared JSON decoder.
pub(super) fn strict_json(bytes: &[u8]) -> io::Result<Vec<u8>> {
    let bytes = strip_bom(bytes);
    std::str::from_utf8(bytes).map_err(io::Error::other)?;
    let mut output = Vec::with_capacity(bytes.len());
    let mut cursor = 0;
    let mut string = false;
    let mut pending_comma = None;
    let mut last_token = None;
    while let Some(&byte) = bytes.get(cursor) {
        cursor += 1;
        if string {
            output.push(byte);
            if byte == b'\\' {
                if let Some(&escaped) = bytes.get(cursor) {
                    output.push(escaped);
                    cursor += 1;
                }
            } else if byte == b'"' {
                string = false;
            }
            continue;
        }
        if byte == b'/' && bytes.get(cursor) == Some(&b'/') {
            output.push(b' ');
            while bytes
                .get(cursor)
                .is_some_and(|byte| !matches!(byte, b'\r' | b'\n'))
            {
                cursor += 1;
            }
            continue;
        }
        if byte == b'/' && bytes.get(cursor) == Some(&b'*') {
            output.push(b' ');
            let end = bytes[cursor + 1..]
                .windows(2)
                .position(|pair| pair == b"*/")
                .ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "Unterminated Bun lock comment")
                })?;
            cursor += 3 + end;
            continue;
        }
        if !matches!(byte, b' ' | b'\r' | b'\n' | b'\t') {
            if let Some(index) = pending_comma.take()
                && matches!(byte, b'}' | b']')
            {
                output[index] = b' ';
            }
            if byte == b','
                && last_token.is_some_and(|token| !matches!(token, b'{' | b'[' | b',' | b':'))
            {
                pending_comma = Some(output.len());
            }
            last_token = Some(byte);
            string = byte == b'"';
        }
        output.push(byte);
    }
    Ok(output)
}
