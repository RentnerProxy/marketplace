import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppManifest } from '../../../../contracts/v1/index.ts'

const exec = promisify(execFile)
export const targets = {
    'linux-amd64': {
        machine: 62,
        interpreter: '/lib64/ld-linux-x86-64.so.2',
        libraries: '/lib/x86_64-linux-gnu',
    },
    'linux-arm64': {
        machine: 183,
        interpreter: '/lib/ld-linux-aarch64.so.1',
        libraries: '/lib/aarch64-linux-gnu',
    },
} as const
const approvedLibraries = new Set([
    'libc.so.6',
    'libdl.so.2',
    'libgcc_s.so.1',
    'libm.so.6',
    'libpthread.so.0',
    'libresolv.so.2',
    'librt.so.1',
    'libstdc++.so.6',
])
const loaderTags = new Set([
    15n, // DT_RPATH
    29n, // DT_RUNPATH
    0x6ffffefan, // DT_CONFIG
    0x6ffffefbn, // DT_DEPAUDIT
    0x6ffffefcn, // DT_AUDIT
    0x7ffffffdn, // DT_AUXILIARY
    0x7fffffffn, // DT_FILTER
])

interface Segment {
    type: number
    flags: number
    offset: number
    length: number
    address: bigint
    memoryLength: bigint
}

function uniqueSegment(segments: Segment[], type: number) {
    const matches = segments.filter((segment) => segment.type === type)
    if (matches.length > 1) throw new Error('Duplicate ELF runtime segment')
    return matches[0]
}

function programHeaders(binary: Buffer, expectedMachine: number) {
    if (
        binary.length < 64 ||
        binary.toString('latin1', 0, 4) !== '\x7fELF' ||
        binary[4] !== 2 ||
        binary[5] !== 1 ||
        binary[6] !== 1 ||
        (binary[7] !== 0 && binary[7] !== 3) ||
        ![2, 3].includes(binary.readUInt16LE(16)) ||
        binary.readUInt16LE(18) !== expectedMachine ||
        binary.readUInt32LE(20) !== 1 ||
        binary.readUInt16LE(52) !== 64 ||
        binary.readUInt16LE(54) !== 56
    ) {
        throw new Error(
            'Candidate binary must be a native Linux ELF64 executable for its declared target',
        )
    }

    const table = Number(binary.readBigUInt64LE(32))
    const count = binary.readUInt16LE(56)
    if (
        table < 64 ||
        count < 1 ||
        count > 128 ||
        table + count * 56 > binary.length
    ) {
        throw new Error('Invalid ELF program header table')
    }
    const segments: Segment[] = []
    for (let index = 0; index < count; index++) {
        const start = table + index * 56
        const type = binary.readUInt32LE(start)
        if (type === 0) continue
        const offset = Number(binary.readBigUInt64LE(start + 8))
        const length = Number(binary.readBigUInt64LE(start + 32))
        const memoryLength = binary.readBigUInt64LE(start + 40)
        if (
            offset + length > binary.length ||
            (type === 1 && BigInt(length) > memoryLength)
        ) {
            throw new Error('ELF segment exceeds its file or memory bounds')
        }
        segments.push({
            type,
            flags: binary.readUInt32LE(start + 4),
            offset,
            length,
            address: binary.readBigUInt64LE(start + 16),
            memoryLength,
        })
    }
    const entry = binary.readBigUInt64LE(24)
    if (
        entry === 0n ||
        !segments.some(
            ({ type, flags, address, length }) =>
                type === 1 &&
                (flags & 1) !== 0 &&
                entry >= address &&
                entry - address < BigInt(length),
        )
    ) {
        throw new Error(
            'ELF executable entrypoint is outside its executable load segment',
        )
    }
    return segments
}

function mappedFileOffset(segments: Segment[], address: bigint, size: bigint) {
    const loads = segments.filter(
        (segment) =>
            segment.type === 1 &&
            segment.address < address + size &&
            address < segment.address + segment.memoryLength,
    )
    if (
        size < 1n ||
        loads.length !== 1 ||
        address < loads[0].address ||
        address - loads[0].address + size > BigInt(loads[0].length)
    ) {
        throw new Error(
            'ELF runtime metadata is outside a unique file-backed load segment',
        )
    }
    return loads[0].offset + Number(address - loads[0].address)
}

export interface ElfLinkage {
    needed: string[]
    interpreter?: (typeof targets)[AppManifest['target']]['interpreter']
    versions: Map<string, Set<string>>
}

function metadataString(strings: Buffer, start: number) {
    const end = strings.indexOf(0, start)
    if (start >= strings.length || end <= start || end - start > 128)
        throw new Error('Invalid ELF dependency or version name')
    return strings.toString('latin1', start, end)
}

function elfHash(name: string) {
    let hash = 0
    for (let index = 0; index < name.length; index++) {
        hash = (hash << 4) + name.charCodeAt(index)
        const high = hash & 0xf0000000
        hash = (hash ^ (high >>> 24)) & ~high
    }
    return hash
}

function versionNeeds(
    binary: Buffer,
    segments: Segment[],
    strings: Buffer,
    needed: string[],
    address: bigint,
    count: number,
) {
    const versions = new Map<string, Set<string>>()
    const indices = new Set<number>()
    const occupied = new Set<bigint>()
    function recordAt(location: bigint) {
        if (location % 4n !== 0n)
            throw new Error('Unaligned ELF version dependency record')
        for (let word = location; word < location + 16n; word += 4n) {
            if (occupied.has(word))
                throw new Error('Overlapping ELF version dependency records')
            occupied.add(word)
        }
        return mappedFileOffset(segments, location, 16n)
    }
    for (let index = 0; index < count; index++) {
        const offset = recordAt(address)
        const version = binary.readUInt16LE(offset)
        const size = binary.readUInt16LE(offset + 2)
        const library = metadataString(strings, binary.readUInt32LE(offset + 4))
        const auxiliaryOffset = binary.readUInt32LE(offset + 8)
        const next = binary.readUInt32LE(offset + 12)
        if (
            version !== 1 ||
            size < 1 ||
            indices.size + size > 512 ||
            auxiliaryOffset < 16 ||
            !needed.includes(library) ||
            versions.has(library) ||
            (index + 1 === count ? next !== 0 : next < 16)
        ) {
            throw new Error('Invalid ELF version dependency record')
        }

        const names = new Set<string>()
        let auxiliary = address + BigInt(auxiliaryOffset)
        for (let item = 0; item < size; item++) {
            const entry = recordAt(auxiliary)
            const name = metadataString(strings, binary.readUInt32LE(entry + 8))
            const versionIndex = binary.readUInt16LE(entry + 6) & 0x7fff
            const nextAuxiliary = binary.readUInt32LE(entry + 12)
            if (
                !/^[A-Za-z0-9_.-]+$/u.test(name) ||
                elfHash(name) !== binary.readUInt32LE(entry) ||
                versionIndex < 2 ||
                indices.has(versionIndex) ||
                names.has(name) ||
                (item + 1 === size ? nextAuxiliary !== 0 : nextAuxiliary < 16)
            ) {
                throw new Error('Invalid ELF required symbol version')
            }
            indices.add(versionIndex)
            names.add(name)
            auxiliary += BigInt(nextAuxiliary)
        }
        versions.set(library, names)
        address += BigInt(next)
    }
    return versions
}

function dynamicLinkage(binary: Buffer, dynamic: Segment, segments: Segment[]) {
    if (
        dynamic.length < 16 ||
        dynamic.length % 16 !== 0 ||
        dynamic.length > 64 * 1024 ||
        mappedFileOffset(segments, dynamic.address, BigInt(dynamic.length)) !==
            dynamic.offset
    ) {
        throw new Error('Invalid ELF dynamic segment length')
    }
    let tableAddress: bigint | undefined
    let tableSize: bigint | undefined
    let versionAddress: bigint | undefined
    let versionCount: bigint | undefined
    let terminated = false
    const needed: bigint[] = []
    for (
        let offset = dynamic.offset;
        offset < dynamic.offset + dynamic.length;
        offset += 16
    ) {
        const tag = binary.readBigUInt64LE(offset)
        const value = binary.readBigUInt64LE(offset + 8)
        if (tag === 0n) {
            terminated = true
            break
        }
        if (loaderTags.has(tag))
            throw new Error('ELF custom loader paths and modules are forbidden')
        if (tag === 1n) needed.push(value)
        if (tag === 5n) {
            if (tableAddress !== undefined)
                throw new Error('Duplicate ELF DT_STRTAB')
            tableAddress = value
        }
        if (tag === 10n) {
            if (tableSize !== undefined)
                throw new Error('Duplicate ELF DT_STRSZ')
            tableSize = value
        }
        if (tag === 0x6ffffffen) {
            if (versionAddress !== undefined)
                throw new Error('Duplicate ELF DT_VERNEED')
            versionAddress = value
        }
        if (tag === 0x6fffffffn) {
            if (versionCount !== undefined)
                throw new Error('Duplicate ELF DT_VERNEEDNUM')
            versionCount = value
        }
    }
    if (!terminated) throw new Error('Unterminated ELF dynamic section')
    if (
        (versionAddress === undefined) !== (versionCount === undefined) ||
        (versionCount !== undefined &&
            (versionCount < 1n || versionCount > BigInt(needed.length)))
    ) {
        throw new Error('Invalid ELF version dependency table')
    }
    if (needed.length === 0)
        return { needed: [], versions: new Map<string, Set<string>>() }
    if (
        tableAddress === undefined ||
        tableSize === undefined ||
        needed.length > 32
    ) {
        throw new Error('Missing or invalid ELF dependency table')
    }
    const tableStart = mappedFileOffset(segments, tableAddress, tableSize)
    const strings = binary.subarray(tableStart, tableStart + Number(tableSize))
    const libraries = needed.map((index) =>
        metadataString(strings, Number(index)),
    )
    const versions =
        versionAddress === undefined
            ? new Map<string, Set<string>>()
            : versionNeeds(
                  binary,
                  segments,
                  strings,
                  libraries,
                  versionAddress,
                  Number(versionCount),
              )
    return { needed: libraries, versions }
}

export function inspectCandidateLinkage(
    binary: Buffer,
    target: AppManifest['target'],
): ElfLinkage | null {
    const profile = targets[target]
    const segments = programHeaders(binary, profile.machine)
    const dynamic = uniqueSegment(segments, 2)
    const interpreter = uniqueSegment(segments, 3)
    if (
        interpreter &&
        (!dynamic ||
            interpreter.length !== profile.interpreter.length + 1 ||
            binary.toString(
                'latin1',
                interpreter.offset,
                interpreter.offset + interpreter.length,
            ) !==
                profile.interpreter + '\0')
    ) {
        throw new Error(
            'ELF interpreter is outside the Debian 13 appliance profile',
        )
    }
    if (!dynamic) return null
    const linkage = dynamicLinkage(binary, dynamic, segments)
    const loader = profile.interpreter.split('/').at(-1)
    if (
        linkage.needed.some(
            (library) => !approvedLibraries.has(library) && library !== loader,
        ) ||
        (linkage.needed.length !== 0 && !interpreter)
    ) {
        throw new Error(
            'ELF requires a library outside the Debian 13 appliance profile',
        )
    }
    return {
        ...linkage,
        interpreter: interpreter ? profile.interpreter : undefined,
    }
}

export function inspectCandidateElf(
    binary: Buffer,
    target: AppManifest['target'],
) {
    return inspectCandidateLinkage(binary, target)?.needed ?? null
}

export async function readelf(path: string) {
    let report: string
    try {
        const result = await exec(
            '/usr/bin/readelf',
            [
                '--wide',
                '--use-dynamic',
                '--dynamic',
                '--version-info',
                '--',
                path,
            ],
            {
                encoding: 'utf8',
                env: { LC_ALL: 'C' },
                timeout: 10_000,
                maxBuffer: 2 * 1024 * 1024,
            },
        )
        if (result.stderr.trim()) throw new Error('readelf diagnostics')
        report = result.stdout
    } catch {
        throw new Error('Linux readelf could not verify the candidate binary')
    }

    return report
}

export async function verifyReadelf(path: string, needed: readonly string[]) {
    const report = await readelf(path)
    const reported = [
        ...report.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]\r\n]+)\]/g),
    ].map((match) => match[1])
    if (
        reported.length !== needed.length ||
        reported.some((library, index) => library !== needed[index])
    ) {
        throw new Error(
            'ELF dynamic program headers and readelf dependencies disagree',
        )
    }
}
