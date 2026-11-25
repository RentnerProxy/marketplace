use super::{CHUNK, MAX_ARCHIVE, MAX_PLAINTEXT, files, invalid};
use crate::protocol::{CoreResult, OperationContext};
use aead_gcm_stream::AesGcm;
use aes::Aes256;
use hkdf::Hkdf;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::Path;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

// The streaming crate counts authenticated bytes with usize. The product's
// 25 GiB archive budget therefore requires the deployed 64-bit targets.
#[cfg(not(target_pointer_width = "64"))]
compile_error!("Der Archiv-Core benötigt für das 25-GiB-Budget ein 64-Bit-Ziel.");

const HEADER_LENGTH: usize = 54;
const TAG_LENGTH: usize = 16;
pub(super) const ENVELOPE_OVERHEAD: u64 = (HEADER_LENGTH + TAG_LENGTH) as u64;
pub(super) const FILE_BUFFER_SIZE: usize = 256 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Metadata {
    pub archive_size: u64,
    pub plaintext_size: u64,
    pub checksum_sha256: String,
}
fn failure() -> crate::protocol::CoreError {
    invalid(
        "Die verschlüsselte Backup-Datei ist ungültig oder konnte nicht authentifiziert werden.",
    )
}
fn derive(key: &[u8], salt: &[u8]) -> Zeroizing<[u8; 32]> {
    let mut output = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(Some(salt), key)
        .expand(
            b"tanstackdummy/backup/envelope-v1/aes-256-gcm",
            output.as_mut(),
        )
        .expect("32 Byte liegen innerhalb des HKDF-SHA-256-Ausgabelimits von 8160 Byte.");
    output
}
pub(crate) struct EncryptWriter<'a> {
    output: BufWriter<File>,
    buffer: Zeroizing<Vec<u8>>,
    cipher: AesGcm<Aes256>,
    hash: Sha256,
    plain: u64,
    size: u64,
    context: &'a OperationContext,
}
impl<'a> EncryptWriter<'a> {
    pub fn new(path: &Path, key: &[u8], context: &'a OperationContext) -> CoreResult<Self> {
        let mut header = [0; HEADER_LENGTH];
        header[..10].copy_from_slice(b"TDBAKENC\x01\x01");
        getrandom::fill(&mut header[10..]).map_err(|_| failure())?;
        let derived = derive(key, &header[10..42]);
        let mut cipher = AesGcm::<Aes256>::new((&*derived).into(), &header[42..]);
        cipher.set_aad(&header);
        let mut output = BufWriter::with_capacity(FILE_BUFFER_SIZE, files::new_file(path)?);
        output.write_all(&header)?;
        let mut hash = Sha256::new();
        hash.update(header);
        Ok(Self {
            output,
            buffer: Zeroizing::new(vec![0; CHUNK]),
            cipher,
            hash,
            plain: 0,
            size: HEADER_LENGTH as u64,
            context,
        })
    }
    pub fn finish(mut self) -> CoreResult<Metadata> {
        self.context.check_now()?;
        let tag = self.cipher.finish();
        self.output.write_all(&tag)?;
        self.hash.update(tag);
        self.size += TAG_LENGTH as u64;
        self.output.flush()?;
        self.output.get_ref().sync_all()?;
        Ok(Metadata {
            archive_size: self.size,
            plaintext_size: self.plain,
            checksum_sha256: files::hex(&self.hash.finalize()),
        })
    }
}
impl Write for EncryptWriter<'_> {
    fn write(&mut self, input: &[u8]) -> std::io::Result<usize> {
        self.context.check().map_err(std::io::Error::other)?;
        let count = input.len().min(CHUNK);
        if count as u64 > MAX_PLAINTEXT - self.plain {
            return Err(std::io::Error::other(failure()));
        }
        let output = &mut self.buffer[..count];
        output.copy_from_slice(&input[..count]);
        self.cipher.encrypt(output);
        self.output.write_all(output)?;
        self.hash.update(output);
        self.plain += count as u64;
        self.size += count as u64;
        Ok(count)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.output.flush()
    }
}
pub(super) struct DecryptReader<'a> {
    source: BufReader<File>,
    before: files::Identity,
    cipher: AesGcm<Aes256>,
    hash: Sha256,
    buffer: Zeroizing<Vec<u8>>,
    start: usize,
    end: usize,
    remaining: u64,
    read_failure: Option<crate::protocol::CoreError>,
    request: &'a Value,
    context: &'a OperationContext,
}
impl<'a> DecryptReader<'a> {
    pub(super) fn new(
        source_path: &Path,
        key: &[u8],
        request: &'a Value,
        context: &'a OperationContext,
    ) -> CoreResult<Self> {
        let source = files::open_source(source_path)?;
        let before = files::identity(&source)?;
        files::assert_expected_identity(&before, request)?;
        let maximum = request
            .get("maximumBytes")
            .and_then(Value::as_u64)
            .unwrap_or(MAX_ARCHIVE)
            .min(MAX_ARCHIVE);
        if before.size < ENVELOPE_OVERHEAD || before.size > maximum {
            return Err(failure());
        }
        let mut source = BufReader::with_capacity(FILE_BUFFER_SIZE, source);
        let mut header = [0; HEADER_LENGTH];
        source.read_exact(&mut header)?;
        if &header[..10] != b"TDBAKENC\x01\x01" {
            return Err(failure());
        }
        let derived = derive(key, &header[10..42]);
        let mut cipher = AesGcm::<Aes256>::new((&*derived).into(), &header[42..]);
        cipher.set_aad(&header);
        let mut hash = Sha256::new();
        hash.update(header);
        Ok(Self {
            source,
            remaining: before.size - ENVELOPE_OVERHEAD,
            before,
            cipher,
            hash,
            buffer: Zeroizing::new(vec![0; CHUNK]),
            start: 0,
            end: 0,
            read_failure: None,
            request,
            context,
        })
    }
    pub(super) fn plaintext_size(&self) -> u64 {
        self.before.size - ENVELOPE_OVERHEAD
    }
    pub(super) fn report_start(&self) -> CoreResult<()> {
        self.context
            .progress(json!({"processedBytes":0,"totalBytes":self.before.size}))
    }
    fn next_chunk(&mut self) -> CoreResult<()> {
        self.context.check()?;
        let count = self.remaining.min(CHUNK as u64) as usize;
        let bytes = &mut self.buffer[..count];
        self.source.read_exact(bytes)?;
        self.hash.update(&*bytes);
        self.cipher.decrypt(bytes);
        self.start = 0;
        self.end = count;
        self.remaining -= count as u64;
        self.context.progress(json!({
            "processedBytes": self.before.size - TAG_LENGTH as u64 - self.remaining,
            "totalBytes": self.before.size,
        }))
    }
    pub(super) fn finish(mut self) -> CoreResult<Metadata> {
        if let Some(error) = self.read_failure.take() {
            return Err(error);
        }
        // A parser may reject untrusted plaintext early. Verify the whole
        // envelope before the caller exposes any TAR diagnostics or result.
        while self.remaining > 0 {
            self.next_chunk()?;
        }
        self.context.check_now()?;
        let plaintext_size = self.plaintext_size();
        let mut tag = [0; TAG_LENGTH];
        self.source.read_exact(&mut tag)?;
        self.hash.update(tag);
        let actual_tag = self.cipher.finish();
        if !bool::from(actual_tag.as_slice().ct_eq(&tag)) {
            return Err(failure());
        }
        let mut extra = [0; 1];
        if self.source.read(&mut extra)? != 0 {
            return Err(failure());
        }
        let after = files::identity(self.source.get_ref())?;
        if after != self.before {
            return Err(failure());
        }
        files::assert_expected_identity(&after, self.request)?;
        let checksum = files::hex(&self.hash.finalize());
        if let Some(expected) = self.request["expectedChecksumSha256"].as_str() {
            files::checksum_matches(&checksum, expected)?;
        }
        self.context
            .progress(json!({"processedBytes":self.before.size,"totalBytes":self.before.size}))?;
        Ok(Metadata {
            archive_size: self.before.size,
            plaintext_size,
            checksum_sha256: checksum,
        })
    }
    pub(super) fn write_temporary(mut self, path: &Path) -> CoreResult<Metadata> {
        let mut output = files::new_file(path)?;
        let mut budget = files::Budget::new(self.request, self.plaintext_size())?;
        self.report_start()?;
        while self.remaining > 0 {
            self.next_chunk()?;
            budget.before(self.end as u64, self.context)?;
            output.write_all(&self.buffer[..self.end])?;
        }
        // The owning temporary directory cleans up on success and failure.
        self.finish()
    }
}
impl Read for DecryptReader<'_> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.read_failure.is_some() {
            return Err(io::Error::other("Archive decryption failed."));
        }
        if self.start == self.end {
            if self.remaining == 0 {
                return Ok(0);
            }
            if let Err(error) = self.next_chunk() {
                self.read_failure = Some(error);
                return Err(io::Error::other("Archive decryption failed."));
            }
        }
        let count = output.len().min(self.end - self.start);
        output[..count].copy_from_slice(&self.buffer[self.start..self.start + count]);
        self.start += count;
        Ok(count)
    }
}

#[cfg(test)]
#[path = "../../tests/unit/archive_crypto.rs"]
mod tests;
