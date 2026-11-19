use super::*;
use serde_json::json;
use std::io::Cursor;

fn response(frame: &str) -> io::Result<(u16, Value)> {
    let wire = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{frame}");
    read_response(&mut Cursor::new(wire))
}

#[test]
fn accepts_fixed_chunked_and_close_delimited_json() {
    for frame in [
        "Content-Length: 2\r\n\r\n{}",
        "Transfer-Encoding: chunked\r\n\r\n1;extension=value\r\n{\r\n1\r\n}\r\n0\r\nX-Trailer: value\r\n\r\n",
        "Connection: close\r\n\r\n{}",
    ] {
        assert_eq!(response(frame).unwrap(), (200, json!({})));
    }
    let hints = b"HTTP/1.1 103 Early Hints\r\nLink: </example>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}";
    assert_eq!(
        read_response(&mut Cursor::new(hints)).unwrap(),
        (200, json!({}))
    );
}

#[test]
fn rejects_ambiguous_incomplete_and_oversized_http_responses() {
    for frame in [
        "Content-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n",
        "Content-Length: 2\r\ncontent-length: 2\r\n\r\n{}",
        "Content-Length: +2\r\n\r\n{}",
        "Content-Length: 3\r\n\r\n{}",
        "Content-Length: 1048577\r\n\r\n",
        "Transfer-Encoding: chunked\r\n\r\n+2\r\n{}\r\n0\r\n\r\n",
        "Transfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n",
        "Transfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\nX-Trailer: value\r\n",
        "Transfer-Encoding: chunked\r\n\r\n100001\r\n",
        "Content-Encoding: gzip\r\n\r\n{}",
        "\r\n{\"healthy\":true,\"healthy\":false}",
    ] {
        assert!(response(frame).is_err(), "accepted frame {frame:?}");
    }
    let oversized = format!("X-Long: {}\r\n\r\n{{}}", "x".repeat(HEADER_LIMIT));
    assert!(response(&oversized).is_err());
}
