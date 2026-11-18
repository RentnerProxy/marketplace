use std::collections::{BTreeSet, HashSet};
use std::io;

use super::{
    Image, LibraryVersions, Segment, StringTable, dword, invalid, mapped_file_offset, word,
};

struct Records<'a> {
    segments: &'a [Segment],
    occupied: HashSet<u64>,
}

impl Records<'_> {
    fn read(&mut self, image: &mut Image, location: u64) -> io::Result<[u8; 16]> {
        if !location.is_multiple_of(4) {
            return Err(invalid("Unaligned ELF version dependency record"));
        }
        let offset = mapped_file_offset(self.segments, location, 16)?;
        let last = location
            .checked_add(12)
            .ok_or_else(|| invalid("Invalid ELF version dependency record"))?;
        for word in (location..=last).step_by(4) {
            if !self.occupied.insert(word) {
                return Err(invalid("Overlapping ELF version dependency records"));
            }
        }
        image.array(offset)
    }
}

pub(super) fn requirements(
    image: &mut Image,
    segments: &[Segment],
    strings: &StringTable,
    needed: &[String],
    mut address: u64,
    count: u64,
) -> io::Result<LibraryVersions> {
    let mut versions = LibraryVersions::new();
    let mut indices = HashSet::new();
    let mut records = Records {
        segments,
        occupied: HashSet::new(),
    };
    for index in 0..count {
        let header = records.read(image, address)?;
        let size = word(&header, 2);
        let library = strings.name(image, u64::from(dword(&header, 4)))?;
        let auxiliary_offset = dword(&header, 8);
        let next = dword(&header, 12);
        if word(&header, 0) != 1
            || size == 0
            || indices.len() + usize::from(size) > 512
            || auxiliary_offset < 16
            || !needed.contains(&library)
            || versions.contains_key(&library)
            || !valid_next(next, index + 1 == count)
        {
            return Err(invalid("Invalid ELF version dependency record"));
        }

        let mut names = BTreeSet::new();
        let mut auxiliary = advance(address, auxiliary_offset)?;
        for item in 0..size {
            let entry = records.read(image, auxiliary)?;
            let name = strings.name(image, u64::from(dword(&entry, 8)))?;
            let index = word(&entry, 6) & 0x7fff;
            let next = dword(&entry, 12);
            if !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
                || elf_hash(name.as_bytes()) != dword(&entry, 0)
                || index < 2
                || !indices.insert(index)
                || !names.insert(name)
                || !valid_next(next, item + 1 == size)
            {
                return Err(invalid("Invalid ELF required symbol version"));
            }
            auxiliary = advance(auxiliary, next)?;
        }
        versions.insert(library, names);
        address = advance(address, next)?;
    }
    Ok(versions)
}

fn valid_next(next: u32, last: bool) -> bool {
    if last { next == 0 } else { next >= 16 }
}

fn advance(address: u64, offset: u32) -> io::Result<u64> {
    address
        .checked_add(u64::from(offset))
        .ok_or_else(|| invalid("Invalid ELF version dependency record"))
}

fn elf_hash(name: &[u8]) -> u32 {
    name.iter().fold(0u32, |hash, &byte| {
        let hash = (hash << 4) + u32::from(byte);
        let high = hash & 0xf000_0000;
        (hash ^ (high >> 24)) & !high
    })
}
