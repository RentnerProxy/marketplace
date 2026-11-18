import { constants, open, type FileHandle } from 'node:fs/promises'

const blockSize = 512
const archiveLimit = 256 * 1024 * 1024
const regularFileLimit = 64 * 1024 * 1024
const executableLimit = 192 * 1024 * 1024
const entryLimit = 4096
const directories = new Set([
    'api',
    'bin',
    'licenses',
    'migrations',
    'schemas',
    'ui',
])
const rootFiles = new Set(['app.json', 'LICENSE'])
const pathComponent = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/
const deviceName = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i

export interface ArchiveEntry {
    path: string
    directory: boolean
    executable: boolean
    bytes: Buffer
}

function zero(bytes: Buffer) {
    return bytes.every((byte) => byte === 0)
}

function stringField(bytes: Buffer, offset: number, length: number) {
    const field = bytes.subarray(offset, offset + length)
    const terminator = field.indexOf(0)
    const value = terminator < 0 ? field : field.subarray(0, terminator)
    if (
        (terminator >= 0 && !zero(field.subarray(terminator))) ||
        !value.every((byte) => byte >= 0x20 && byte <= 0x7e)
    ) {
        throw new Error('Invalid ustar text field')
    }
    return value.toString('ascii')
}

function octalField(bytes: Buffer, offset: number, length: number) {
    const value = bytes.toString('latin1', offset, offset + length)
    if (!/^ *[0-7]+[\0 ]+$/.test(value)) {
        throw new Error('Invalid ustar numeric field')
    }
    return Number.parseInt(value, 8)
}

export function safePackagePath(path: string) {
    return (
        path.length <= 240 &&
        path
            .split('/')
            .every(
                (component) =>
                    pathComponent.test(component) &&
                    !deviceName.test(component),
            )
    )
}

function headerEntry(header: Buffer, bytes: Buffer, offset: number) {
    const declaredChecksum = octalField(header, 148, 8)
    let checksum = 0
    for (const [index, byte] of header.entries()) {
        checksum += index >= 148 && index < 156 ? 32 : byte
    }
    if (
        checksum !== declaredChecksum ||
        header.toString('latin1', 257, 265) !== 'ustar\x0000' ||
        !zero(header.subarray(500))
    ) {
        throw new Error('Invalid ustar header')
    }

    const type = header[156]
    const directory = type === 53
    if (
        (!directory && type !== 48 && type !== 0) ||
        !zero(header.subarray(157, 257))
    ) {
        throw new Error(
            'Only regular ustar files and directories are supported',
        )
    }
    const name = stringField(header, 0, 100)
    const prefix = stringField(header, 345, 155)
    const path = prefix ? prefix + '/' + name : name
    const mode = octalField(header, 100, 8)
    const executable = (mode & 0o111) !== 0
    const size = octalField(header, 124, 12)
    const sizeLimit =
        executable && !directory ? executableLimit : regularFileLimit
    if (
        mode !== (directory || executable ? 0o755 : 0o644) ||
        size > sizeLimit ||
        (directory && size !== 0) ||
        (!zero(header.subarray(329, 345)) &&
            (octalField(header, 329, 8) !== 0 ||
                octalField(header, 337, 8) !== 0))
    ) {
        throw new Error(
            'Invalid ustar permissions, file size or device metadata',
        )
    }
    // Ownership and archive timestamps have no effect during staging.
    octalField(header, 108, 8)
    octalField(header, 116, 8)
    octalField(header, 136, 12)

    const end = offset + blockSize + size
    const next = Math.ceil(end / blockSize) * blockSize
    if (next > bytes.length || !zero(bytes.subarray(end, next))) {
        throw new Error('Truncated ustar entry or nonzero file padding')
    }
    return {
        path,
        directory,
        executable,
        bytes: bytes.subarray(offset + blockSize, end),
        next,
    }
}

function packagePath(entry: ArchiveEntry, dotted: boolean) {
    const rawPath = dotted ? entry.path.slice(2) : entry.path
    const path =
        entry.directory && rawPath.endsWith('/')
            ? rawPath.slice(0, -1)
            : rawPath
    if (!safePackagePath(path)) throw new Error('Unsafe ustar package path')

    const slash = path.indexOf('/')
    const root = path.split('/', 1)[0]
    if (
        (slash === -1 && !entry.directory
            ? !rootFiles.has(root)
            : !directories.has(root)) ||
        (!entry.directory && entry.executable !== (root === 'bin'))
    ) {
        throw new Error('File or mode outside the candidate package layout')
    }
    return path
}

function indexLocation(
    locations: Map<
        string,
        { path: string; directory: boolean; declared: boolean }
    >,
    path: string,
    directory: boolean,
) {
    const parts = path.split('/')
    let current = ''
    for (const [index, part] of parts.entries()) {
        current = current ? current + '/' + part : part
        const key = current.toLowerCase()
        const existing = locations.get(key)
        const declared = index === parts.length - 1
        const isDirectory = !declared || directory
        if (
            existing &&
            (existing.path !== current ||
                existing.directory !== isDirectory ||
                (declared && existing.declared))
        ) {
            throw new Error('Conflicting or duplicate ustar package path')
        }
        if (!existing || declared)
            locations.set(key, {
                path: current,
                directory: isDirectory,
                declared,
            })
    }
}

function parseArchive(bytes: Buffer) {
    const entries = new Map<string, ArchiveEntry>()
    const locations = new Map<
        string,
        { path: string; directory: boolean; declared: boolean }
    >()
    let dotted: boolean | undefined
    let offset = 0
    let count = 0
    while (offset < bytes.length) {
        const header = bytes.subarray(offset, offset + blockSize)
        if (zero(header)) {
            // GNU tar may pad the zero end blocks to its final record size.
            if (
                bytes.length - offset >= 2 * blockSize &&
                zero(bytes.subarray(offset))
            )
                return entries
            throw new Error(
                'Invalid ustar end blocks or data after the archive',
            )
        }
        if (++count > entryLimit)
            throw new Error('Candidate archive has too many entries')
        const { next, ...entry } = headerEntry(header, bytes, offset)
        offset = next
        const usesDot = entry.path.startsWith('./')
        if (entry.path === './' || entry.path === '.') {
            if (!entry.directory || count !== 1)
                throw new Error('Invalid ustar root entry')
            dotted = usesDot
            continue
        }
        if (dotted !== undefined && dotted !== usesDot)
            throw new Error('Mixed ustar path prefixes')
        dotted = usesDot
        const path = packagePath(entry, dotted)
        indexLocation(locations, path, entry.directory)
        entries.set(path, { ...entry, path })
    }
    throw new Error('Missing ustar end blocks')
}

async function readArchive(file: FileHandle) {
    const info = await file.stat()
    if (
        !info.isFile() ||
        info.size < 2 * blockSize ||
        info.size > archiveLimit ||
        info.size % blockSize !== 0
    ) {
        throw new Error('Invalid candidate archive file or length')
    }
    const bytes = Buffer.allocUnsafe(info.size)
    const { bytesRead } = await file.read({ buffer: bytes })
    if (bytesRead !== info.size || (await file.stat()).size !== info.size) {
        throw new Error('Candidate archive changed while reading')
    }
    return parseArchive(bytes)
}

export async function readCandidateArchive(path: string) {
    const file = await open(
        path,
        constants.O_RDONLY |
            (constants.O_NOFOLLOW ?? 0) |
            (constants.O_NONBLOCK ?? 0),
    )
    try {
        return await readArchive(file)
    } finally {
        await file.close()
    }
}
