import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateCandidatePackage } from '../../../../../.github/scripts/ci/app-candidates/archive.ts'
import { inspectCandidateElf } from '../../../../../.github/scripts/ci/app-candidates/elf.ts'
import { decodeWireJson } from '../../../../../.github/scripts/ci/app-candidates/wire-json.ts'
import type { AppManifest } from '../../../../../contracts/v1/index.ts'

interface FixtureEntry {
    path: string
    data?: Buffer | string
    mode?: number
    type?: string
}

const manifest: AppManifest = {
    formatVersion: 1,
    id: 'rentnerproxy.reference',
    version: '0.1.0',
    target: 'linux-amd64',
    source: { repositoryId: '8001234', commit: 'a'.repeat(40) },
    display: {
        name: 'Reference',
        summary: 'Archive test fixture',
        license: 'MIT',
    },
    requires: {
        runtimeProfile: 'rentnerproxy-linux-v1',
        platformApi: '>=1.0.0 <2.0.0',
        appProtocol: '>=1.0.0 <2.0.0',
        engineCapabilities: [],
    },
    entrypoint: 'bin/app',
    api: 'api/openapi.json',
    providers: [],
    capabilities: [],
    permissions: [],
    resources: {
        startupTimeoutMs: 1000,
        drainTimeoutMs: 1000,
        memoryMiB: 128,
        processLimit: 1,
    },
}

function elf(
    machine: number,
    dynamic?: { library: string; tag?: bigint; interpreter: string },
) {
    const bytes = Buffer.alloc(dynamic ? 512 : 128)
    bytes.write('\x7fELF')
    bytes.set([2, 1, 1, 0], 4)
    bytes.writeUInt16LE(dynamic ? 3 : 2, 16)
    bytes.writeUInt16LE(machine, 18)
    bytes.writeUInt32LE(1, 20)
    bytes.writeBigUInt64LE(0x400078n, 24)
    bytes.writeBigUInt64LE(64n, 32)
    bytes.writeUInt16LE(64, 52)
    bytes.writeUInt16LE(56, 54)
    bytes.writeUInt16LE(dynamic ? 3 : 1, 56)

    function segment(
        index: number,
        type: number,
        offset: number,
        length: number,
    ) {
        const position = 64 + index * 56
        bytes.writeUInt32LE(type, position)
        bytes.writeUInt32LE(type === 1 ? 5 : 4, position + 4)
        bytes.writeBigUInt64LE(BigInt(offset), position + 8)
        bytes.writeBigUInt64LE(BigInt(0x400000 + offset), position + 16)
        bytes.writeBigUInt64LE(BigInt(length), position + 32)
        bytes.writeBigUInt64LE(BigInt(length), position + 40)
    }
    segment(0, 1, 0, bytes.length)
    if (dynamic) {
        const tableOffset = 0x110
        const interpreterOffset = 0xe8
        const stringsOffset = 0x180
        segment(1, 3, interpreterOffset, dynamic.interpreter.length + 1)
        segment(2, 2, tableOffset, 5 * 16)
        bytes.write(dynamic.interpreter, interpreterOffset)
        bytes.write(dynamic.library, stringsOffset)
        const tags = [
            [5n, BigInt(0x400000 + stringsOffset)],
            [10n, BigInt(dynamic.library.length + 1)],
            [1n, 0n],
            [dynamic.tag ?? 0n, 0n],
            [0n, 0n],
        ]
        for (const [index, [tag, value]] of tags.entries()) {
            const position = tableOffset + index * 16
            bytes.writeBigUInt64LE(tag, position)
            bytes.writeBigUInt64LE(value, position + 8)
        }
    }
    return bytes
}

function octal(value: number, length: number) {
    return value.toString(8).padStart(length - 1, '0') + '\0'
}

function ustarEntry(entry: FixtureEntry) {
    const header = Buffer.alloc(512)
    const bytes = Buffer.from(entry.data ?? '')
    header.write(entry.path, 0, 100, 'ascii')
    header.write(octal(entry.mode ?? 0o644, 8), 100)
    header.write(octal(0, 8), 108)
    header.write(octal(0, 8), 116)
    header.write(octal(bytes.length, 12), 124)
    header.write(octal(0, 12), 136)
    header.fill(32, 148, 156)
    header.write(entry.type ?? '0', 156)
    header.write('ustar\0', 257)
    header.write('00', 263)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(octal(checksum, 7) + ' ', 148)
    return Buffer.concat([
        header,
        bytes,
        Buffer.alloc((512 - (bytes.length % 512)) % 512),
    ])
}

const api = {
    openapi: '3.1.0',
    info: { title: 'Reference', version: '1' },
    paths: {},
}
function fixtureEntries(
    manifestData: string = JSON.stringify(manifest),
): FixtureEntry[] {
    return [
        { path: './', mode: 0o755, type: '5' },
        { path: './app.json', data: manifestData },
        { path: './bin/', mode: 0o755, type: '5' },
        { path: './bin/app', data: elf(62), mode: 0o755 },
        { path: './api/openapi.json', data: JSON.stringify(api) },
        { path: './LICENSE', data: 'Permission is hereby granted.\n' },
    ]
}

function tar(entries = fixtureEntries(), trailer = Buffer.alloc(1024)) {
    return Buffer.concat([...entries.map(ustarEntry), trailer])
}

async function withCandidateArchive(
    archive: Buffer,
    check: (input: string, output: string, scratch: string) => Promise<void>,
) {
    const tempRoot = join(tmpdir(), 'candidate-archive-')
    const scratch = await mkdtemp(tempRoot)
    if (!scratch.startsWith(tempRoot))
        throw new Error('Unexpected test temp directory')
    const input = join(scratch, 'package.tar')
    const output = join(scratch, 'package')
    try {
        await writeFile(input, archive)
        await check(input, output, scratch)
    } finally {
        await rm(scratch, { recursive: true, force: true })
    }
}

async function verifyRejection(archive: Buffer, message: string) {
    await withCandidateArchive(archive, async (input, output, scratch) => {
        await expect(
            validateCandidatePackage(input, output, manifest),
        ).rejects.toThrow(message)
        expect(await readdir(scratch)).toEqual(['package.tar'])
    })
}

describe('candidate package admission', () => {
    test('materializes a GNU-style ustar package with bound manifest bytes', async () => {
        const originalManifest = JSON.stringify(manifest, null, 2) + '\n'
        const entries = fixtureEntries(originalManifest)
        const archive = tar(entries, Buffer.alloc(4096))
        await withCandidateArchive(archive, async (input, output) => {
            const result = await validateCandidatePackage(
                input,
                output,
                manifest,
            )
            expect(result).toEqual({
                manifest,
                manifestSha256: createHash('sha256')
                    .update(originalManifest)
                    .digest('hex'),
            })
            expect(await readFile(join(output, 'app.json'), 'utf8')).toBe(
                originalManifest,
            )
            expect(await readFile(join(output, 'bin/app'))).toEqual(elf(62))
            expect((await lstat(join(output, 'bin/app'))).isFile()).toBe(true)
        })
    })

    test('never reuses an existing package directory', async () => {
        await withCandidateArchive(tar(), async (input, output) => {
            await mkdir(output)
            await writeFile(join(output, 'keep'), 'existing')
            await expect(
                validateCandidatePackage(input, output, manifest),
            ).rejects.toThrow('already exists')
            expect(await readdir(output)).toEqual(['keep'])
        })
    })

    test.each([
        [{ path: './../escape', data: 'file' }, 'Unsafe ustar'],
        [{ path: './ui/.env.production', data: 'fixture' }, 'Unsafe ustar'],
        [{ path: './ui/.git/config', data: 'fixture' }, 'Unsafe ustar'],
        [{ path: './ui/aux.js', data: 'file' }, 'Unsafe ustar'],
        [{ path: './ui/link', type: '2' }, 'Only regular'],
        [{ path: './ui/hardlink', type: '1' }, 'Only regular'],
        [{ path: './ui/device', type: '3' }, 'Only regular'],
        [{ path: './ui/pax', type: 'x' }, 'Only regular'],
        [{ path: './ui/sparse', type: 'S' }, 'Only regular'],
        [
            { path: './bin/helper', mode: 0o4755, data: 'file' },
            'Invalid ustar permissions',
        ],
        [
            { path: './ui/unreadable', mode: 0o600, data: 'file' },
            'Invalid ustar permissions',
        ],
        [
            { path: './ui/tool', mode: 0o755, data: 'file' },
            'outside the candidate package layout',
        ],
        [{ path: './app.json', data: 'duplicate' }, 'Conflicting or duplicate'],
        [
            { path: './api/OpenApi.json', data: 'collision' },
            'Conflicting or duplicate',
        ],
        [
            { path: './bin/app/helper', data: elf(62), mode: 0o755 },
            'Conflicting or duplicate',
        ],
        [{ path: 'ui/index.html', data: 'mixed' }, 'Mixed ustar path prefixes'],
        [
            { path: './bin/helper', mode: 0o755, data: '#!/bin/sh' },
            'native Linux ELF64',
        ],
    ] satisfies [FixtureEntry, string][])(
        'rejects $path before staging',
        async (entry, message) => {
            await verifyRejection(tar([...fixtureEntries(), entry]), message)
        },
    )

    test('rejects corrupted headers, padding, and noncanonical end blocks', async () => {
        const badChecksum = tar()
        badChecksum[0] = 0
        await verifyRejection(badChecksum, 'Invalid ustar header')

        const badPadding = tar()
        const paddingOffset = 1024 + Buffer.byteLength(JSON.stringify(manifest))
        badPadding[paddingOffset] = 1
        await verifyRejection(badPadding, 'file padding')

        await verifyRejection(
            tar(fixtureEntries(), Buffer.alloc(512)),
            'end blocks',
        )
        const trailingData = Buffer.alloc(1536)
        trailingData[1535] = 1
        await verifyRejection(
            tar(fixtureEntries(), trailingData),
            'data after the archive',
        )
    })

    test('limits the number of files before inspecting their contents', async () => {
        const excess = Array.from({ length: 4096 }, (_, index) => ({
            path: './ui/asset-' + String(index),
        }))
        await verifyRejection(
            tar([...fixtureEntries(), ...excess]),
            'too many entries',
        )
    })

    test.each([
        [
            {
                ...manifest,
                source: { ...manifest.source, repositoryId: '9000' },
            },
            'source identity',
        ],
        [
            {
                ...manifest,
                source: { ...manifest.source, commit: 'b'.repeat(40) },
            },
            'source identity',
        ],
        [{ ...manifest, target: 'linux-arm64' }, 'runtime does not satisfy'],
        [
            {
                ...manifest,
                display: { ...manifest.display, license: 'NOASSERTION' },
            },
            'package license',
        ],
        [
            { ...manifest, configSchema: 'schemas/missing.json' },
            'Missing or empty',
        ],
    ] satisfies [AppManifest, string][])(
        'binds the package to its requested source and contract',
        async (invalid, message) => {
            await verifyRejection(
                tar(fixtureEntries(JSON.stringify(invalid))),
                message,
            )
        },
    )

    test('rejects duplicate manifest members even when a key is escaped', async () => {
        const duplicate =
            '{"\\u0069d":"replacement",' + JSON.stringify(manifest).slice(1)
        await verifyRejection(
            tar(fixtureEntries(duplicate)),
            'ambiguous candidate JSON',
        )
    })

    test.each([
        'https://outside.invalid/a.json',
        '../schemas/a.json',
        '#/components/missing',
    ])('rejects unsafe or unresolved OpenAPI refs (%s)', async (reference) => {
        const entries = fixtureEntries()
        entries[4].data = JSON.stringify({
            ...api,
            components: { schemas: { Item: { $ref: reference } } },
        })
        await verifyRejection(tar(entries), 'JSON reference')
    })

    test('treats schema property names and example values as data', async () => {
        const declared: AppManifest = {
            ...manifest,
            configSchema: 'schemas/config.json',
        }
        const entries = fixtureEntries(JSON.stringify(declared))
        const example = {
            $ref: 'https://outside.invalid/a.json',
            $id: 'data',
            operationRef: 'data',
        }
        const schema = {
            type: 'object',
            properties: {
                $ref: { type: 'string' },
                $id: { type: 'string' },
                examples: { $ref: '#/properties/$ref' },
            },
            examples: [example],
            default: example,
        }
        entries[4].data = JSON.stringify({
            ...api,
            paths: {
                '/test': {
                    get: {
                        responses: {
                            200: {
                                description: 'Reference',
                                content: {
                                    'application/json': {
                                        schema: {
                                            $ref: '#/components/schemas/Fixture',
                                        },
                                        examples: { $ref: { value: example } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            components: {
                schemas: {
                    Fixture: {
                        ...schema,
                        properties: { $ref: { type: 'string' } },
                    },
                },
                examples: { $ref: { value: example } },
            },
        })
        entries.push({
            path: './schemas/config.json',
            data: JSON.stringify(schema),
        })
        await withCandidateArchive(tar(entries), async (input, output) => {
            expect(
                (await validateCandidatePackage(input, output, manifest))
                    .manifest,
            ).toEqual(declared)
        })
    })

    test('checks nested OpenAPI Reference Objects and referenced external schemas', async () => {
        const entries = fixtureEntries()
        const remote = 'https://outside.invalid/a.json'
        entries[4].data = JSON.stringify({
            ...api,
            paths: {
                '/test': { get: { responses: { 200: { $ref: remote } } } },
            },
        })
        await verifyRejection(
            tar(entries),
            'JSON references must be package-local',
        )
        entries[4].data = JSON.stringify({
            ...api,
            components: {
                schemas: { Item: { $ref: 'schema.json#/$defs/item' } },
            },
        })
        entries.push({
            path: './api/schema.json',
            data: JSON.stringify({
                $defs: { item: { properties: { $ref: { $ref: remote } } } },
            }),
        })
        await verifyRejection(
            tar(entries),
            'JSON references must be package-local',
        )
        entries[entries.length - 1].data = JSON.stringify({
            $id: 'https://outside.invalid/root',
            $defs: { item: { type: 'object' } },
        })
        await verifyRejection(
            tar(entries),
            'Unsupported candidate JSON reference or scope',
        )
    })

    test('resolves package-local JSON references and validates declared assets', async () => {
        const declared: AppManifest = {
            ...manifest,
            requires: { ...manifest.requires, uiBridge: '>=1.0.0 <2.0.0' },
            ui: { entrypoint: 'ui/index.html', slots: ['navigation'] },
            configSchema: 'schemas/config.json',
            data: {
                targetVersion: 1,
                writeVersions: [1],
                readVersions: [1],
                migrations: [
                    {
                        fromVersion: 0,
                        toVersion: 1,
                        path: 'migrations/initialize.sql',
                    },
                ],
            },
        }
        const entries = fixtureEntries(JSON.stringify(declared))
        entries[4].data = JSON.stringify({
            ...api,
            components: {
                schemas: { Item: { $ref: 'schemas.json#/$defs/item' } },
            },
        })
        entries.push(
            {
                path: './api/schemas.json',
                data: '{"$defs":{"item":{"type":"object"}}}',
            },
            { path: './schemas/config.json', data: '{"type":"object"}' },
            {
                path: './ui/index.html',
                data: '<!doctype html><title>Fixture</title>',
            },
            { path: './migrations/initialize.sql', data: 'SELECT 1;' },
        )
        await withCandidateArchive(tar(entries), async (input, output) => {
            expect(
                (await validateCandidatePackage(input, output, manifest))
                    .manifest,
            ).toEqual(declared)
        })
        entries.pop()
        await verifyRejection(tar(entries), 'migrations/initialize.sql')
    })
})

describe('candidate wire JSON', () => {
    const encoder = new TextEncoder()

    test('rejects repeated response names including equivalent escapes', () => {
        expect(() =>
            decodeWireJson(encoder.encode('{"healthy":false,"healthy":true}')),
        ).toThrow('Duplicate JSON member')
        expect(() =>
            decodeWireJson(
                encoder.encode('{"healthy":false,"\\u0068ealthy":true}'),
            ),
        ).toThrow('Duplicate JSON member')
    })

    test('accepts the same member name in different objects and rejects malformed UTF-8', () => {
        expect(
            decodeWireJson(
                encoder.encode('{"healthy":true,"nested":{"healthy":true}}'),
            ),
        ).toEqual({ healthy: true, nested: { healthy: true } })
        expect(() =>
            decodeWireJson(Uint8Array.of(0x22, 0xc0, 0xaf, 0x22)),
        ).toThrow()
    })
})

describe('ELF appliance compatibility', () => {
    const interpreter = '/lib64/ld-linux-x86-64.so.2'
    test('checks native architecture and signed-off glibc dependencies without execution', () => {
        expect(inspectCandidateElf(elf(183), 'linux-arm64')).toBeNull()
        expect(
            inspectCandidateElf(
                elf(62, { library: 'libc.so.6', interpreter }),
                'linux-amd64',
            ),
        ).toEqual(['libc.so.6'])
        expect(() => inspectCandidateElf(elf(183), 'linux-amd64')).toThrow(
            'native Linux ELF64',
        )
    })

    test('rejects a dynamic segment whose loaded bytes differ from its file metadata', () => {
        const binary = elf(62, { library: 'libc.so.6', interpreter })
        binary.writeBigUInt64LE(0x400100n, 64 + 2 * 56 + 16)
        expect(() => inspectCandidateElf(binary, 'linux-amd64')).toThrow(
            'dynamic segment',
        )
    })

    test.each([
        [{ library: 'libssl.so.3', interpreter }, 'requires a library'],
        [{ library: '/tmp/libc.so.6', interpreter }, 'requires a library'],
        [
            { library: 'libc.so.6', interpreter: '/lib/ld-musl-x86_64.so.1' },
            'interpreter is outside',
        ],
        [
            { library: 'libc.so.6', interpreter, tag: 29n },
            'custom loader paths',
        ],
    ] as const)(
        'rejects incompatible ELF loader policy',
        (settings, message) => {
            expect(() =>
                inspectCandidateElf(elf(62, settings), 'linux-amd64'),
            ).toThrow(message)
        },
    )
})
