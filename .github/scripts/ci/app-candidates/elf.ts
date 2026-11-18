import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppManifest } from '../../../../contracts/v1/index.ts'

const exec = promisify(execFile)
const targets = {
    'linux-amd64': { machine: 62, interpreter: '/lib64/ld-linux-x86-64.so.2' },
    'linux-arm64': { machine: 183, interpreter: '/lib/ld-linux-aarch64.so.1' },
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

function dynamicLibraries(
    binary: Buffer,
    dynamic: Segment,
    segments: Segment[],
) {
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
    }
    if (!terminated) throw new Error('Unterminated ELF dynamic section')
    if (needed.length === 0) return []
    if (
        tableAddress === undefined ||
        tableSize === undefined ||
        needed.length > 32
    ) {
        throw new Error('Missing or invalid ELF dependency table')
    }
    const tableStart = mappedFileOffset(segments, tableAddress, tableSize)
    const strings = binary.subarray(tableStart, tableStart + Number(tableSize))
    return needed.map((index) => {
        const start = Number(index)
        const end = strings.indexOf(0, start)
        if (start >= strings.length || end < 0 || end - start > 64) {
            throw new Error('Invalid ELF dependency name')
        }
        return strings.toString('latin1', start, end)
    })
}

export function inspectCandidateElf(
    binary: Buffer,
    target: AppManifest['target'],
) {
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
    const needed = dynamicLibraries(binary, dynamic, segments)
    const loader = profile.interpreter.split('/').at(-1)
    if (
        needed.some(
            (library) => !approvedLibraries.has(library) && library !== loader,
        ) ||
        (needed.length !== 0 && !interpreter)
    ) {
        throw new Error(
            'ELF requires a library outside the Debian 13 appliance profile',
        )
    }
    return needed
}

export async function verifyReadelf(path: string, needed: readonly string[]) {
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
    for (const [, version] of report.matchAll(
        /\bName: GLIBC_([a-zA-Z0-9_.]+)/g,
    )) {
        if (version === 'ABI_DT_RELR') continue
        const match = /^2\.(\d+)(?:\.\d+)?$/.exec(version)
        if (!match || Number(match[1]) > 41) {
            throw new Error(
                'ELF requires glibc symbols outside the Debian 13 appliance profile',
            )
        }
    }
}
