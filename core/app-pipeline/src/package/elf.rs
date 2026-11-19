mod readelf;
mod versions;

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::invalid;

const LOAD: u32 = 1;
const DYNAMIC: u32 = 2;
const INTERP: u32 = 3;

#[derive(Clone, Copy, Deserialize)]
pub(super) enum Target {
    #[serde(rename = "linux-amd64")]
    Amd64,
    #[serde(rename = "linux-arm64")]
    Arm64,
}

impl Target {
    pub fn name(self) -> &'static str {
        match self {
            Self::Amd64 => "linux-amd64",
            Self::Arm64 => "linux-arm64",
        }
    }

    fn machine(self) -> u16 {
        match self {
            Self::Amd64 => 62,
            Self::Arm64 => 183,
        }
    }

    fn interpreter(self) -> &'static str {
        match self {
            Self::Amd64 => "/lib64/ld-linux-x86-64.so.2",
            Self::Arm64 => "/lib/ld-linux-aarch64.so.1",
        }
    }
}

pub(super) type LibraryVersions = BTreeMap<String, BTreeSet<String>>;

#[derive(Deserialize, Serialize)]
pub(super) struct Linkage {
    pub needed: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interpreter: Option<String>,
    pub versions: LibraryVersions,
}

impl Linkage {
    pub fn verify_appliance(&self, available: &LibraryVersions) -> io::Result<()> {
        if self
            .interpreter
            .as_ref()
            .is_some_and(|path| !available.contains_key(basename(path)))
        {
            return Err(invalid(
                "ELF interpreter is missing from the pinned appliance",
            ));
        }
        for library in &self.needed {
            let definitions = available.get(library).ok_or_else(|| {
                invalid("Required ELF library is missing from the pinned appliance")
            })?;
            for version in self.versions.get(library).into_iter().flatten() {
                if version.split('_').any(|part| part == "PRIVATE")
                    || !definitions.contains(version)
                {
                    return Err(invalid(
                        "Required ELF symbol version is unavailable in the pinned appliance",
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn verify_readelf(&self, path: &Path) -> io::Result<()> {
        readelf::verify(path, &self.needed)
    }
}

pub(super) fn inspect(input: File, target: Target) -> io::Result<Option<Linkage>> {
    let mut image = Image {
        size: input.metadata()?.len(),
        input,
    };
    let segments = program_headers(&mut image, target)?;
    let dynamic = unique_segment(&segments, DYNAMIC)?;
    let interpreter = unique_segment(&segments, INTERP)?;
    let expected = target.interpreter();
    if let Some(segment) = interpreter {
        if dynamic.is_none() || segment.length != expected.len() as u64 + 1 {
            return Err(invalid(
                "ELF interpreter is outside the Debian 13 appliance profile",
            ));
        }
        let bytes = image.bytes(segment.offset, segment.length as usize)?;
        if bytes.strip_suffix(b"\0") != Some(expected.as_bytes()) {
            return Err(invalid(
                "ELF interpreter is outside the Debian 13 appliance profile",
            ));
        }
    }
    let Some(dynamic) = dynamic else {
        return Ok(None);
    };
    let mut linkage = dynamic_linkage(&mut image, dynamic, &segments)?;
    if (!linkage.needed.is_empty() && interpreter.is_none())
        || linkage
            .needed
            .iter()
            .any(|library| !approved_library(library, basename(expected)))
    {
        return Err(invalid(
            "ELF requires a library outside the Debian 13 appliance profile",
        ));
    }
    linkage.interpreter = interpreter.map(|_| expected.to_owned());
    Ok(Some(linkage))
}

pub(super) fn appliance_library(path: &Path, library: &str) -> io::Result<BTreeSet<String>> {
    marketplace_artifacts::open_regular(path, 16 * 1024 * 1024)?;
    readelf::definitions(path, library)
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn approved_library(library: &str, loader: &str) -> bool {
    library == loader
        || matches!(
            library,
            "libc.so.6"
                | "libdl.so.2"
                | "libgcc_s.so.1"
                | "libm.so.6"
                | "libpthread.so.0"
                | "libresolv.so.2"
                | "librt.so.1"
                | "libstdc++.so.6"
        )
}

struct Image {
    input: File,
    size: u64,
}

impl Image {
    fn read(&mut self, offset: u64, buffer: &mut [u8]) -> io::Result<()> {
        verify_bounds(self.size, offset, buffer.len() as u64)?;
        self.input.seek(SeekFrom::Start(offset))?;
        self.input.read_exact(buffer)
    }

    fn bytes(&mut self, offset: u64, size: usize) -> io::Result<Vec<u8>> {
        let mut bytes = vec![0; size];
        self.read(offset, &mut bytes)?;
        Ok(bytes)
    }

    fn array<const N: usize>(&mut self, offset: u64) -> io::Result<[u8; N]> {
        let mut bytes = [0; N];
        self.read(offset, &mut bytes)?;
        Ok(bytes)
    }
}

struct Segment {
    kind: u32,
    flags: u32,
    offset: u64,
    length: u64,
    address: u64,
    memory_length: u64,
}

fn verify_bounds(size: u64, offset: u64, length: u64) -> io::Result<()> {
    if offset > size || length > size - offset {
        return Err(invalid("ELF segment exceeds its file or memory bounds"));
    }
    Ok(())
}

fn program_headers(image: &mut Image, target: Target) -> io::Result<Vec<Segment>> {
    let invalid_elf = || {
        invalid("Candidate binary must be a native Linux ELF64 executable for its declared target")
    };
    if image.size < 64 {
        return Err(invalid_elf());
    }
    let header = image.array::<64>(0)?;
    if &header[..7] != b"\x7fELF\x02\x01\x01"
        || !matches!(header[7], 0 | 3)
        || !matches!(word(&header, 16), 2 | 3)
        || word(&header, 18) != target.machine()
        || dword(&header, 20) != 1
        || word(&header, 52) != 64
        || word(&header, 54) != 56
    {
        return Err(invalid_elf());
    }
    let table_offset = qword(&header, 32);
    let count = usize::from(word(&header, 56));
    if table_offset < 64
        || !(1..=128).contains(&count)
        || verify_bounds(image.size, table_offset, (count * 56) as u64).is_err()
    {
        return Err(invalid("Invalid ELF program header table"));
    }
    let table = image.bytes(table_offset, count * 56)?;
    let mut segments = Vec::new();
    for record in table.as_chunks::<56>().0 {
        let kind = dword(record, 0);
        if kind == 0 {
            continue;
        }
        let segment = Segment {
            kind,
            flags: dword(record, 4),
            offset: qword(record, 8),
            address: qword(record, 16),
            length: qword(record, 32),
            memory_length: qword(record, 40),
        };
        verify_bounds(image.size, segment.offset, segment.length)?;
        if kind == LOAD && segment.length > segment.memory_length {
            return Err(invalid("ELF segment exceeds its file or memory bounds"));
        }
        segments.push(segment);
    }
    let entry = qword(&header, 24);
    if entry == 0
        || !segments.iter().any(|segment| {
            segment.kind == LOAD
                && segment.flags & 1 != 0
                && entry >= segment.address
                && entry - segment.address < segment.length
        })
    {
        return Err(invalid(
            "ELF executable entrypoint is outside its executable load segment",
        ));
    }
    Ok(segments)
}

fn unique_segment(segments: &[Segment], kind: u32) -> io::Result<Option<&Segment>> {
    let mut matches = segments.iter().filter(|segment| segment.kind == kind);
    let segment = matches.next();
    if matches.next().is_some() {
        return Err(invalid("Duplicate ELF runtime segment"));
    }
    Ok(segment)
}

fn mapped_file_offset(segments: &[Segment], address: u64, size: u64) -> io::Result<u64> {
    let outside = || invalid("ELF runtime metadata is outside a unique file-backed load segment");
    if size == 0 {
        return Err(outside());
    }
    let address_end = u128::from(address) + u128::from(size);
    let mut loads = segments.iter().filter(|segment| {
        segment.kind == LOAD
            && u128::from(segment.address) < address_end
            && u128::from(address) < u128::from(segment.address) + u128::from(segment.memory_length)
    });
    let load = loads.next().ok_or_else(outside)?;
    let relative = address.checked_sub(load.address).ok_or_else(outside)?;
    if loads.next().is_some() || relative > load.length || size > load.length - relative {
        return Err(outside());
    }
    Ok(load.offset + relative)
}

struct StringTable {
    offset: u64,
    size: u64,
}

impl StringTable {
    fn name(&self, image: &mut Image, start: u64) -> io::Result<String> {
        let invalid_name = || invalid("Invalid ELF dependency or version name");
        if start >= self.size {
            return Err(invalid_name());
        }
        let size = (self.size - start).min(129) as usize;
        let mut bytes = [0; 129];
        image.read(self.offset + start, &mut bytes[..size])?;
        let end = bytes[..size]
            .iter()
            .position(|&byte| byte == 0)
            .filter(|end| *end > 0)
            .ok_or_else(invalid_name)?;
        let name = str::from_utf8(&bytes[..end]).map_err(|_| invalid_name())?;
        Ok(name.to_owned())
    }
}

fn set_tag(slot: &mut Option<u64>, value: u64, name: &str) -> io::Result<()> {
    if slot.replace(value).is_some() {
        return Err(invalid(format!("Duplicate ELF {name}")));
    }
    Ok(())
}

fn dynamic_linkage(
    image: &mut Image,
    dynamic: &Segment,
    segments: &[Segment],
) -> io::Result<Linkage> {
    if !(16..=64 * 1024).contains(&dynamic.length)
        || !dynamic.length.is_multiple_of(16)
        || mapped_file_offset(segments, dynamic.address, dynamic.length)? != dynamic.offset
    {
        return Err(invalid("Invalid ELF dynamic segment length"));
    }
    let table = image.bytes(dynamic.offset, dynamic.length as usize)?;
    let mut table_address = None;
    let mut table_size = None;
    let mut version_address = None;
    let mut version_count = None;
    let mut terminated = false;
    let mut needed = Vec::new();
    for entry in table.as_chunks::<16>().0 {
        let value = qword(entry, 8);
        match qword(entry, 0) {
            0 => {
                terminated = true;
                break;
            }
            1 => needed.push(value),
            5 => set_tag(&mut table_address, value, "DT_STRTAB")?,
            10 => set_tag(&mut table_size, value, "DT_STRSZ")?,
            0x6fff_fffe => set_tag(&mut version_address, value, "DT_VERNEED")?,
            0x6fff_ffff => set_tag(&mut version_count, value, "DT_VERNEEDNUM")?,
            15 | 29 | 0x6fff_fefa | 0x6fff_fefb | 0x6fff_fefc | 0x7fff_fffd | 0x7fff_ffff => {
                return Err(invalid("ELF custom loader paths and modules are forbidden"));
            }
            _ => {}
        }
    }
    if !terminated {
        return Err(invalid("Unterminated ELF dynamic section"));
    }
    if version_address.is_some() != version_count.is_some()
        || version_count.is_some_and(|count| count == 0 || count > needed.len() as u64)
    {
        return Err(invalid("Invalid ELF version dependency table"));
    }
    let mut linkage = Linkage {
        needed: Vec::new(),
        interpreter: None,
        versions: LibraryVersions::new(),
    };
    if !needed.is_empty() {
        let (Some(address), Some(size)) = (table_address, table_size) else {
            return Err(invalid("Missing or invalid ELF dependency table"));
        };
        if needed.len() > 32 {
            return Err(invalid("Missing or invalid ELF dependency table"));
        }
        let strings = StringTable {
            offset: mapped_file_offset(segments, address, size)?,
            size,
        };
        for name in needed {
            linkage.needed.push(strings.name(image, name)?);
        }
        if let (Some(address), Some(count)) = (version_address, version_count) {
            linkage.versions =
                versions::requirements(image, segments, &strings, &linkage.needed, address, count)?;
        }
    }
    Ok(linkage)
}

fn word(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(bytes[offset..][..2].try_into().expect("ELF 16-bit field"))
}

fn dword(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..][..4].try_into().expect("ELF 32-bit field"))
}

fn qword(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(bytes[offset..][..8].try_into().expect("ELF 64-bit field"))
}
