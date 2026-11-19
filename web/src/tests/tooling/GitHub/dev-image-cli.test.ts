import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { nativeToolPath } from '../../../lib/Core/native-tool.ts'

const script = new URL(
    '../../../../../.github/scripts/deploy/dev-image.ts',
    import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const revision = 'a'.repeat(40)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

function archiveEntry(path: string, content: string) {
    const body = Buffer.from(content)
    const header = Buffer.alloc(512)
    header.write(path)
    header.write('0000600\0', 100)
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
    header.fill(' ', 148, 156)
    header.write('0', 156)
    header.write('ustar\0', 257)
    header.write('00', 263)
    const checksum = header.reduce((total, byte) => total + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148)
    return Buffer.concat([
        header,
        body,
        Buffer.alloc((512 - (body.length % 512)) % 512),
    ])
}

async function fixture(
    run: (state: {
        directory: string
        env: Record<string, string>
        execute: (
            command: string,
            changes?: Record<string, string>,
            args?: string[],
        ) => Promise<{ code: number; stderr: string; stdout: string }>
    }) => Promise<void>,
) {
    const temporary = await mkdtemp(join(tmpdir(), 'marketplace-dev-evidence-'))
    if (
        resolve(dirname(temporary)) !== resolve(tmpdir()) ||
        !basename(temporary).startsWith('marketplace-dev-evidence-')
    )
        throw new Error('Unexpected cleanup path')
    const directory = join(temporary, 'marketplace-dev-candidate')
    await mkdir(directory)
    const config = JSON.stringify({
        os: 'linux',
        architecture: 'amd64',
        rootfs: {
            type: 'layers',
            diff_ids: ['sha256:' + hash('fixture-layer')],
        },
        config: {
            Healthcheck: { Test: ['CMD', 'container-healthcheck.sh'] },
            Labels: {
                'org.opencontainers.image.revision': revision,
                'org.opencontainers.image.version':
                    'dev-' + revision.slice(0, 12),
                'org.opencontainers.image.title':
                    'RentnerProxy Marketplace Dev',
                'org.opencontainers.image.source':
                    'https://github.com/RentnerProxy/marketplace',
            },
        },
    })
    const layer = 'fixture-layer'
    const imageType = 'application/vnd.oci.image.manifest.v1+json'
    const descriptor = (content: string) => ({
        digest: 'sha256:' + hash(content),
        size: Buffer.byteLength(content),
    })
    const imageId = descriptor(config).digest
    const manifest = JSON.stringify({
        schemaVersion: 2,
        mediaType: imageType,
        config: descriptor(config),
        layers: [descriptor(layer)],
    })
    const archive = Buffer.concat([
        archiveEntry(
            'oci-layout',
            JSON.stringify({ imageLayoutVersion: '1.0.0' }),
        ),
        archiveEntry(
            'index.json',
            JSON.stringify({
                schemaVersion: 2,
                manifests: [{ ...descriptor(manifest), mediaType: imageType }],
            }),
        ),
        ...[config, layer, manifest].map((content) =>
            archiveEntry('blobs/sha256/' + hash(content), content),
        ),
        Buffer.alloc(1024),
    ])
    const archiveHash = createHash('sha256').update(archive).digest('hex')
    await writeFile(join(directory, 'candidate-image.tar'), archive)
    await writeFile(
        join(directory, 'runtime-inspect.json'),
        JSON.stringify([
            {
                Id: 'sha256:' + 'c'.repeat(64),
                Os: 'linux',
                Architecture: 'amd64',
                Config: JSON.parse(config).config,
                RootFS: {
                    Type: 'layers',
                    Layers: ['sha256:' + hash('fixture-layer')],
                },
            },
        ]),
    )
    const env: Record<string, string> = {
        SystemRoot: process.env.SystemRoot ?? '',
        MARKETPLACE_TOOLING_BIN: nativeToolPath('marketplace-tooling'),
        ...(process.env.LLVM_PROFILE_FILE && {
            LLVM_PROFILE_FILE: process.env.LLVM_PROFILE_FILE,
        }),
        GITHUB_REPOSITORY: 'RentnerProxy/marketplace',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: revision,
        GITHUB_WORKFLOW_SHA: revision,
        GITHUB_WORKFLOW_REF:
            'RentnerProxy/marketplace/.github/workflows/dev-image.yml@refs/heads/main',
        GITHUB_RUN_ID: '1234',
        GITHUB_RUN_ATTEMPT: '1',
        RUNNER_TEMP: temporary,
        CANDIDATE_DIRECTORY: directory,
        GITHUB_OUTPUT: join(temporary, 'outputs'),
        IMAGE_ID: imageId,
        PREFLIGHT_ARCHIVE_SHA256: archiveHash,
        TESTED_ARCHIVE_SHA256: archiveHash,
    }
    const execute = async (
        command: string,
        changes: Record<string, string> = {},
        args: string[] = [],
    ) => {
        const child = Bun.spawn(
            [
                process.execPath,
                '--no-env-file',
                decodeURIComponent(script),
                command,
                ...args,
            ],
            {
                env: { ...env, ...changes },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const [code, stderr, stdout] = await Promise.all([
            child.exited,
            new Response(child.stderr).text(),
            new Response(child.stdout).text(),
        ])
        return { code, stderr, stdout }
    }
    try {
        expect((await execute('candidate')).code).toBe(0)
        const outputs = Object.fromEntries(
            (await readFile(env.GITHUB_OUTPUT!, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => line.split('=')),
        )
        env.EXPECTED_DIGEST = outputs.digest!
        env.EXPECTED_ARCHIVE_SHA256 = outputs.archive_sha256!
        env.EXPECTED_EVIDENCE_SHA256 = outputs.evidence_sha256!
        await run({ directory, env, execute })
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
}

test('CLI verifies sealed data and requires an assessment and two matching remote digests before success evidence', async () => {
    await fixture(async ({ directory, env, execute }) => {
        expect((await execute('loaded')).code).toBe(0)
        expect((await execute('hashes')).code).toBe(0)
        expect((await execute('verify')).code).toBe(0)
        expect(
            JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8'))
                .revision,
        ).toBe(revision)
        expect((await execute('ready')).code).not.toBe(0)
        expect((await execute('assess')).code).toBe(0)
        expect(await execute('ready')).toMatchObject({
            code: 0,
            stdout: 'dev-aaaaaaaaaaaa-1234-1\n',
        })
        expect(
            (
                await execute('published', {
                    REMOTE_IMMUTABLE_DIGEST: env.EXPECTED_DIGEST!,
                    REMOTE_DEV_DIGEST: 'sha256:' + 'b'.repeat(64),
                })
            ).code,
        ).not.toBe(0)
        expect(
            await Bun.file(join(directory, 'publication.json')).exists(),
        ).toBe(false)
        expect(
            (
                await execute('published', {
                    REMOTE_IMMUTABLE_DIGEST: env.EXPECTED_DIGEST!,
                    REMOTE_DEV_DIGEST: env.EXPECTED_DIGEST!,
                })
            ).code,
        ).toBe(0)
        expect(
            JSON.parse(
                await readFile(join(directory, 'publication.json'), 'utf8'),
            ),
        ).toMatchObject({
            published: true,
            revision,
            digest: env.EXPECTED_DIGEST,
            platforms: ['linux/amd64'],
        })
    })
})

test.each(['candidate-image.tar', 'candidate.json'])(
    'CLI rejects altered %s bytes before archive parsing',
    async (name) => {
        await fixture(async ({ directory, execute }) => {
            await writeFile(join(directory, name), 'tampered')
            const result = await execute('hashes')
            expect(result.code).not.toBe(0)
            expect(result.stderr).toContain('artifact hash mismatch')
            expect((await execute('assess')).code).not.toBe(0)
            if (name === 'candidate-image.tar')
                expect((await execute('candidate')).stderr).toContain(
                    'archive changed after runtime verification',
                )
            expect(
                await Bun.file(join(directory, 'assessment.json')).exists(),
            ).toBe(false)
        })
    },
)

test('CLI rejects external directories, a different workflow SHA, forged assessment and unknown commands', async () => {
    await fixture(async ({ directory, execute }) => {
        expect(
            (
                await execute('hashes', {
                    CANDIDATE_DIRECTORY: join(directory, '..'),
                })
            ).code,
        ).not.toBe(0)
        expect(
            (await execute('prepare', { GITHUB_WORKFLOW_SHA: 'b'.repeat(40) }))
                .code,
        ).not.toBe(0)
        expect((await execute('unknown')).code).not.toBe(0)
        expect((await execute('assess')).code).toBe(0)
        const path = join(directory, 'assessment.json')
        const value = JSON.parse(await readFile(path, 'utf8'))
        await writeFile(path, JSON.stringify({ ...value, published: true }))
        expect((await execute('ready')).code).not.toBe(0)
    })
})

test('CLI rejects OCI configuration bytes changed inside the archive', async () => {
    await fixture(async ({ directory, execute }) => {
        const path = join(directory, 'candidate-image.tar')
        const archive = await readFile(path)
        const offset = archive.indexOf('Healthcheck')
        expect(offset).toBeGreaterThan(0)
        archive[offset] = 'h'.charCodeAt(0)
        await writeFile(path, archive)
        const result = await execute('loaded')
        expect(result.code).not.toBe(0)
        expect(result.stderr).toContain(
            'blob content does not match its SHA-256 path',
        )
        expect((await execute('verify')).code).not.toBe(0)
        expect(await Bun.file(join(directory, 'identity.json')).exists()).toBe(
            false,
        )
    })
})

test('CLI prepares the run, checks the exact archive before import, and binds the runtime result', async () => {
    await fixture(async ({ directory, env, execute }) => {
        expect(await execute('prepare')).toMatchObject({ code: 0, stderr: '' })
        const output = await readFile(env.GITHUB_OUTPUT!, 'utf8')
        expect(output).toContain('revision=' + revision + '\n')
        expect(output).toContain('immutable_tag=dev-aaaaaaaaaaaa-1234-1\n')

        expect(await execute('preflight')).toMatchObject({
            code: 0,
            stdout: env.EXPECTED_ARCHIVE_SHA256 + '\n',
        })
        const wrongId = await execute('preflight', {
            IMAGE_ID: 'sha256:' + 'b'.repeat(64),
        })
        expect(wrongId.code).toBe(1)
        expect(wrongId.stderr).toContain('OCI config digest mismatch')

        const changedArchive = await execute('loaded', {
            PREFLIGHT_ARCHIVE_SHA256: 'b'.repeat(64),
        })
        expect(changedArchive.code).toBe(1)
        expect(changedArchive.stderr).toContain(
            'archive changed after preflight',
        )

        await writeFile(join(directory, 'runtime-inspect.json'), '[]')
        const missingImage = await execute('loaded')
        expect(missingImage.code).toBe(1)
        expect(missingImage.stderr).toContain(
            'exactly one imported runtime image',
        )
    })
})

test('CLI accepts only exact registry bytes and current main', async () => {
    await fixture(async ({ directory, execute }) => {
        const raw = JSON.stringify({ schemaVersion: 2 })
        const file = join(directory, 'raw-registry-manifest.json')
        await writeFile(file, raw)
        const digest = 'sha256:' + hash(raw)
        expect(
            await execute('registry-digest', {}, [file, digest]),
        ).toMatchObject({
            code: 0,
            stdout: digest + '\n',
        })
        const different = await execute('registry-digest', {}, [
            file,
            'sha256:' + 'b'.repeat(64),
        ])
        expect(different.code).toBe(1)
        expect(different.stderr).toContain('registry tag digest mismatch')

        expect((await execute('registry-main', {}, [revision])).code).toBe(0)
        const stale = await execute('registry-main', {}, ['b'.repeat(40)])
        expect(stale.code).toBe(1)
        expect(stale.stderr).toContain('main advanced')
    })
})
