use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

use zip::read::{ArchiveOffset, Config};
use zip::{CompressionMethod, ZipArchive};

const MIB: u64 = 1024 * 1024;
// Match the download limit and the maximum two-target artifact layout.
const ARCHIVE_LIMIT: u64 = 551 * MIB;
const MEMBER_LIMIT: u64 = 257 * MIB;
const TOTAL_OUTPUT_LIMIT: u64 = 548 * MIB;
const ENTRY_LIMIT: usize = 8;
const NAME_LIMIT: usize = 255;
const INPUT_LIMIT: u64 = 4096;

pub(crate) fn extract(archive: &Path, destination: &Path, limits: impl Read) -> io::Result<()> {
    let limits = read_limits(limits)?;
    let source = File::open(archive)?;
    let metadata = source.metadata()?;
    if !metadata.is_file()
        || metadata.len() > ARCHIVE_LIMIT
        || !fs::symlink_metadata(destination)?.is_dir()
    {
        return Err(invalid_zip());
    }
    let mut source = BufReader::new(source);
    let directory = Directory::read(&mut source, metadata.len(), limits.len() as u16)?;
    let names = directory.read_names(&mut source, &limits)?;
    let mut archive = ZipArchive::with_config(
        Config {
            archive_offset: ArchiveOffset::Known(0),
        },
        source,
    )?;
    if archive.central_directory_start() != directory.start || archive.len() != names.len() {
        return Err(invalid_zip());
    }
    archive.validate_header_consistency()?;
    for (index, name) in names.iter().enumerate() {
        let entry = archive.by_index_data(index)?;
        let external = entry.external_attributes();
        // A candidate contains ordinary files only. Never apply any archived permissions.
        if entry.name_raw() != name.as_bytes()
            || entry.encrypted()
            || entry.flags().as_u16() & ((1 << 5) | (1 << 6) | (1 << 13)) != 0
            || entry.is_dir()
            || external & 0x10 != 0
            || !matches!((external >> 16) & 0o170000, 0 | 0o100000)
            || !matches!(
                entry.compression(),
                CompressionMethod::Stored | CompressionMethod::Deflated
            )
            || entry.compressed_size() == 0
            || (entry.compression() == CompressionMethod::Stored
                && entry.compressed_size() != entry.size())
            || entry.size() == 0
            || entry.size() > limits[*name]
        {
            return Err(invalid_zip());
        }
    }
    for (index, name) in names.iter().enumerate() {
        let mut entry = archive.by_index(index)?;
        let size = entry.size();
        let path = destination.join(name);
        let output = File::create_new(path)?;
        let mut output = BufWriter::with_capacity(64 * 1024, output);
        let written = io::copy(&mut (&mut entry).take(size), &mut output)?;
        // Reading through EOF makes the ZIP decoder check CRC and reject a stream
        // that decompresses to more bytes than its header declares.
        if written != size || entry.read(&mut [0])? != 0 {
            return Err(invalid_zip());
        }
        output.flush()?;
    }
    Ok(())
}

fn read_limits(input: impl Read) -> io::Result<BTreeMap<String, u64>> {
    let mut bytes = Vec::new();
    input.take(INPUT_LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > INPUT_LIMIT {
        return Err(invalid_zip());
    }
    let limits: BTreeMap<String, u64> = serde_json::from_slice(&bytes)?;
    if limits.len() > ENTRY_LIMIT
        || limits
            .iter()
            .any(|(name, length)| !valid_name(name) || !(1..=MEMBER_LIMIT).contains(length))
        || limits.values().sum::<u64>() > TOTAL_OUTPUT_LIMIT
    {
        return Err(invalid_zip());
    }
    Ok(limits)
}

fn valid_name(name: &str) -> bool {
    if name.is_empty()
        || name.len() > NAME_LIMIT
        || name.ends_with('.')
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
    {
        return false;
    }
    // Windows also interprets names such as NUL.json as device paths.
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    !matches!(stem.as_str(), "AUX" | "CON" | "NUL" | "PRN")
        && !matches!(
            stem.as_bytes(),
            [b'C', b'O', b'M', b'1'..=b'9'] | [b'L', b'P', b'T', b'1'..=b'9']
        )
}

fn invalid_zip() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid candidate ZIP contents")
}

struct Directory {
    start: u64,
    end: u64,
}

impl Directory {
    fn read(source: &mut (impl Read + Seek), archive_size: u64, count: u16) -> io::Result<Self> {
        // Bound the central directory count and ZIP64 extensible footer before the
        // ZIP library can allocate from either untrusted field.
        const END: usize = 22;
        let tail_len = archive_size.min((END + usize::from(u16::MAX)) as u64) as usize;
        if tail_len < END {
            return Err(invalid_zip());
        }
        let tail_start = archive_size - tail_len as u64;
        source.seek(SeekFrom::Start(tail_start))?;
        let mut tail = vec![0; tail_len];
        source.read_exact(&mut tail)?;
        let offset = tail[..tail_len - END + 4]
            .windows(4)
            .rposition(|bytes| bytes == b"PK\x05\x06")
            .ok_or_else(invalid_zip)?;
        let end = &tail[offset..offset + END];
        if number::<2>(end, 20) as usize != tail_len - offset - END || number::<4>(end, 4) != 0 {
            return Err(invalid_zip());
        }
        let entries_on_disk = number::<2>(end, 8);
        let entries = number::<2>(end, 10);
        let size = number::<4>(end, 12);
        let start = number::<4>(end, 16);
        let eocd = tail_start + offset as u64;
        if entries == u16::MAX as u64 || size == u32::MAX as u64 || start == u32::MAX as u64 {
            let (directory, size64) = Self::read_zip64(source, eocd, count)?;
            if (entries_on_disk != u64::from(count) && entries_on_disk != u64::from(u16::MAX))
                || (entries != u64::from(count) && entries != u64::from(u16::MAX))
                || (size != size64 && size != u64::from(u32::MAX))
                || (start != directory.start && start != u64::from(u32::MAX))
            {
                return Err(invalid_zip());
            }
            return Ok(directory);
        }
        if entries != u64::from(count)
            || entries_on_disk != entries
            || start.checked_add(size) != Some(eocd)
        {
            return Err(invalid_zip());
        }
        Ok(Self { start, end: eocd })
    }

    fn read_zip64(
        source: &mut (impl Read + Seek),
        eocd: u64,
        count: u16,
    ) -> io::Result<(Self, u64)> {
        const LOCATOR_SIZE: usize = 20;
        const ZIP64_END: usize = 56;
        let locator_start = eocd
            .checked_sub(LOCATOR_SIZE as u64)
            .ok_or_else(invalid_zip)?;
        source.seek(SeekFrom::Start(locator_start))?;
        let mut locator = [0; LOCATOR_SIZE];
        source.read_exact(&mut locator)?;
        let directory_end = number::<8>(&locator, 8);
        let length = locator_start
            .checked_sub(directory_end)
            .ok_or_else(invalid_zip)?;
        if &locator[..4] != b"PK\x06\x07"
            || number::<4>(&locator, 4) != 0
            || number::<4>(&locator, 16) != 1
            || !(ZIP64_END as u64..=ZIP64_END as u64 + u64::from(u16::MAX)).contains(&length)
        {
            return Err(invalid_zip());
        }
        source.seek(SeekFrom::Start(directory_end))?;
        let mut footer = [0; ZIP64_END];
        source.read_exact(&mut footer)?;
        let size = number::<8>(&footer, 40);
        let start = number::<8>(&footer, 48);
        if &footer[..4] != b"PK\x06\x06"
            || number::<8>(&footer, 4) != length - 12
            || number::<8>(&footer, 16) != 0
            || number::<8>(&footer, 24) != u64::from(count)
            || number::<8>(&footer, 32) != u64::from(count)
            || start.checked_add(size) != Some(directory_end)
        {
            return Err(invalid_zip());
        }
        Ok((
            Self {
                start,
                end: directory_end,
            },
            size,
        ))
    }

    fn read_names<'a>(
        &self,
        source: &mut (impl Read + Seek),
        limits: &'a BTreeMap<String, u64>,
    ) -> io::Result<Vec<&'a str>> {
        let mut position = self.start;
        let mut names = Vec::with_capacity(limits.len());
        let mut name_bytes = [0; NAME_LIMIT];
        let mut header = [0; 46];
        for _ in 0..limits.len() {
            if self.end - position < header.len() as u64 {
                return Err(invalid_zip());
            }
            source.seek(SeekFrom::Start(position))?;
            source.read_exact(&mut header)?;
            let name_length = number::<2>(&header, 28) as usize;
            position += header.len() as u64
                + name_length as u64
                + number::<2>(&header, 30)
                + number::<2>(&header, 32);
            if &header[..4] != b"PK\x01\x02" || number::<2>(&header, 34) != 0 || position > self.end
            {
                return Err(invalid_zip());
            }
            let raw = name_bytes.get_mut(..name_length).ok_or_else(invalid_zip)?;
            source.read_exact(raw)?;
            let name = std::str::from_utf8(raw).map_err(|_| invalid_zip())?;
            let (name, _) = limits.get_key_value(name).ok_or_else(invalid_zip)?;
            if names.contains(&name.as_str()) {
                return Err(invalid_zip());
            }
            names.push(name.as_str());
        }
        if position != self.end {
            return Err(invalid_zip());
        }
        Ok(names)
    }
}

fn number<const N: usize>(header: &[u8], start: usize) -> u64 {
    let mut bytes = [0; 8];
    bytes[..N].copy_from_slice(&header[start..start + N]);
    u64::from_le_bytes(bytes)
}
