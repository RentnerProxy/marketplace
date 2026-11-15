use super::{CHUNK, MAX_ARCHIVE, MAX_PLAINTEXT, files, invalid};
use crate::protocol::{CoreResult, OperationContext};
use aead_gcm_stream::AesGcm;
use aes::Aes256;
use hkdf::Hkdf;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

// The streaming crate counts authenticated bytes with usize. The product's
// 25 GiB archive budget therefore requires the deployed 64-bit targets.
#[cfg(not(target_pointer_width = "64"))]
compile_error!("Der Archiv-Core benötigt für das 25-GiB-Budget ein 64-Bit-Ziel.");

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
    output: File,
    cipher: AesGcm<Aes256>,
    hash: Sha256,
    plain: u64,
    size: u64,
    context: &'a OperationContext,
}
impl<'a> EncryptWriter<'a> {
    pub fn new(path: &Path, key: &[u8], context: &'a OperationContext) -> CoreResult<Self> {
        let mut header = [0; 54];
        header[..10].copy_from_slice(b"TDBAKENC\x01\x01");
        getrandom::fill(&mut header[10..]).map_err(|_| failure())?;
        let derived = derive(key, &header[10..42]);
        let mut cipher = AesGcm::<Aes256>::new((&*derived).into(), &header[42..]);
        cipher.set_aad(&header);
        let mut output = files::new_file(path)?;
        output.write_all(&header)?;
        let mut hash = Sha256::new();
        hash.update(header);
        Ok(Self {
            output,
            cipher,
            hash,
            plain: 0,
            size: 54,
            context,
        })
    }
    pub fn finish(mut self) -> CoreResult<Metadata> {
        self.context.check()?;
        let tag = self.cipher.finish();
        self.output.write_all(&tag)?;
        self.hash.update(tag);
        self.size += 16;
        self.output.sync_all()?;
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
        let mut output = [0; CHUNK];
        output[..count].copy_from_slice(&input[..count]);
        self.cipher.encrypt(&mut output[..count]);
        self.output.write_all(&output[..count])?;
        self.hash.update(&output[..count]);
        self.plain += count as u64;
        self.size += count as u64;
        Ok(count)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.output.flush()
    }
}
pub(crate) fn encrypt_file(
    source_path: &Path,
    destination: &Path,
    key: &[u8],
    context: &OperationContext,
) -> CoreResult<Metadata> {
    let mut source = files::open_source(source_path)?;
    let before = files::identity(&source)?;
    if before.size > MAX_PLAINTEXT {
        return Err(failure());
    }
    let mut writer = EncryptWriter::new(destination, key, context)?;
    let result = (|| {
        let mut buffer = [0; CHUNK];
        let mut count = 0;
        loop {
            context.check()?;
            let read = source.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            count += read as u64;
            if count > before.size {
                return Err(failure());
            }
            writer.write_all(&buffer[..read])?;
        }
        if count != before.size || files::identity(&source)? != before {
            return Err(failure());
        }
        writer.finish()
    })();
    if result.is_err() {
        std::fs::remove_file(destination)?;
    }
    result
}
pub(crate) fn decrypt(
    source_path: &Path,
    destination_path: Option<&Path>,
    key: &[u8],
    expected_checksum: Option<&str>,
    request: &Value,
    context: &OperationContext,
) -> CoreResult<Metadata> {
    let mut source = files::open_source(source_path)?;
    let before = files::identity(&source)?;
    files::assert_expected_identity(&before, request)?;
    let maximum = request
        .get("maximumBytes")
        .and_then(Value::as_u64)
        .unwrap_or(MAX_ARCHIVE)
        .min(MAX_ARCHIVE);
    if before.size < 70 || before.size > maximum {
        return Err(failure());
    }
    let mut header = [0; 54];
    source.read_exact(&mut header)?;
    if &header[..10] != b"TDBAKENC\x01\x01" {
        return Err(failure());
    }
    let derived = derive(key, &header[10..42]);
    let mut cipher = AesGcm::<Aes256>::new((&*derived).into(), &header[42..]);
    cipher.set_aad(&header);
    let mut output = destination_path.map(files::new_file).transpose()?;
    let result = (|| {
        let mut budget = files::Budget::new(request, before.size - 70)?;
        let mut hash = Sha256::new();
        hash.update(header);
        let mut remaining = before.size - 70;
        let mut size = 0;
        let mut plaintext = Zeroizing::new([0; CHUNK]);
        context.progress(json!({"processedBytes":0,"totalBytes":before.size}))?;
        while remaining > 0 {
            context.check()?;
            let count = remaining.min(CHUNK as u64) as usize;
            source.read_exact(&mut plaintext[..count])?;
            hash.update(&plaintext[..count]);
            cipher.decrypt(&mut plaintext[..count]);
            let written = count;
            size += written as u64;
            if size > MAX_PLAINTEXT {
                return Err(failure());
            }
            if let Some(output) = output.as_mut() {
                budget.before(written as u64, context)?;
                output.write_all(&plaintext[..written])?;
            }
            remaining -= count as u64;
            context.progress(
                json!({"processedBytes":before.size-16-remaining,"totalBytes":before.size}),
            )?;
        }
        let mut tag = [0; 16];
        source.read_exact(&mut tag)?;
        hash.update(tag);
        let actual_tag = cipher.finish();
        if !bool::from(actual_tag.as_slice().ct_eq(&tag)) {
            return Err(failure());
        }
        let mut extra = [0; 1];
        if source.read(&mut extra)? != 0
            || size != before.size - 70
            || files::identity(&source)? != before
        {
            return Err(failure());
        }
        files::assert_expected_identity(&files::identity(&source)?, request)?;
        let checksum = files::hex(&hash.finalize());
        if let Some(expected) = expected_checksum {
            files::checksum_matches(&checksum, expected)?;
        }
        if let Some(output) = output.as_mut() {
            output.sync_all()?;
        }
        context.progress(json!({"processedBytes":before.size,"totalBytes":before.size}))?;
        Ok(Metadata {
            archive_size: before.size,
            plaintext_size: size,
            checksum_sha256: checksum,
        })
    })();
    drop(output);
    if result.is_err()
        && let Some(path) = destination_path
    {
        std::fs::remove_file(path)?;
    }
    result
}

#[cfg(test)]
#[path = "../../tests/unit/archive_crypto.rs"]
mod tests;
