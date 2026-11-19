use std::io::{self, Read, Write};
use std::path::PathBuf;

use marketplace_artifacts::{FileIdentity, hash_stream, open_regular};
use serde::Deserialize;
use serde_json::Value;
use tempfile::NamedTempFile;
use zstd::stream::{read::Decoder, write::Encoder};

use super::{ARCHIVE_LIMIT, COMPRESSED_LIMIT, invalid, promotion};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CompressRequest {
    input_path: PathBuf,
    output_path: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct DecompressRequest {
    input_path: PathBuf,
    output_path: PathBuf,
    maximum_bytes: Option<u64>,
}

pub(super) fn compress(request: CompressRequest) -> io::Result<Value> {
    let (mut input, before) = open_regular(&request.input_path, ARCHIVE_LIMIT)?;
    if before.len() > ARCHIVE_LIMIT {
        return Err(invalid("Candidate archive exceeds its size limit"));
    }
    let output_path = promotion::fresh_destination(&request.output_path)?;
    let mut output = NamedTempFile::new_in(promotion::parent(&output_path))?;
    let mut encoder = Encoder::new(output.as_file_mut(), 0)?;
    encoder.include_checksum(true)?;
    encoder.set_pledged_src_size(Some(before.len()))?;
    let original = hash_stream(&mut input, &mut encoder, before.len())?;
    encoder.finish()?.flush()?;
    let after = input.metadata()?;
    if original.size_bytes != before.len()
        || before.len() != after.len()
        || before.modified()? != after.modified()?
    {
        return Err(invalid("Candidate archive changed while reading"));
    }
    if output.as_file().metadata()?.len() > COMPRESSED_LIMIT {
        return Err(invalid(
            "Compressed candidate archive exceeds its size limit",
        ));
    }
    let verified = decode(output.reopen()?, io::sink(), before.len())?;
    if original != verified {
        return Err(invalid("Candidate archive compression or checksum failed"));
    }
    output
        .persist_noclobber(output_path)
        .map_err(|error| error.error)?;
    Ok(Value::Null)
}

pub(super) fn decompress(request: DecompressRequest) -> io::Result<Value> {
    let maximum = request.maximum_bytes.unwrap_or(ARCHIVE_LIMIT);
    if maximum > ARCHIVE_LIMIT {
        return Err(invalid(
            "Candidate archive expansion limit exceeds its maximum",
        ));
    }
    let (input, before) = open_regular(&request.input_path, COMPRESSED_LIMIT)?;
    if before.len() > COMPRESSED_LIMIT {
        return Err(invalid(
            "Compressed candidate archive exceeds its size limit",
        ));
    }
    let output_path = promotion::fresh_destination(&request.output_path)?;
    let mut output = NamedTempFile::new_in(promotion::parent(&output_path))?;
    let identity = decode((&input).take(before.len()), output.as_file_mut(), maximum)?;
    let after = input.metadata()?;
    if before.len() != after.len() || before.modified()? != after.modified()? {
        return Err(invalid(
            "Compressed candidate archive changed while reading",
        ));
    }
    output.as_file_mut().flush()?;
    output
        .persist_noclobber(output_path)
        .map_err(|error| error.error)?;
    Ok(serde_json::to_value(identity)?)
}

fn decode(input: impl Read, output: impl Write, limit: u64) -> io::Result<FileIdentity> {
    let mut decoder = Decoder::new(input)?;
    // Bound decoder memory independently from the streamed output budget.
    decoder.window_log_max(28)?;
    hash_stream(decoder, output, limit)
}
