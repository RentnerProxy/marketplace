import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const script = new URL(
    '../../../../../.github/scripts/deploy/dev-image.ts',
    import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const revision = 'a'.repeat(40)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

async function fixture(
    run: (state: {
        directory: string
        env: Record<string, string>
        execute: (
            command: string,
            changes?: Record<string, string>,
        ) => Promise<{ code: number; stderr: string }>
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
    const imageId = 'sha256:' + hash(config)
    const manifest = JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: { digest: imageId },
        layers: [{ digest: 'sha256:' + hash('fixture-layer') }],
    })
    await writeFile(
        join(directory, 'candidate-image.tar'),
        'synthetic archive bytes; never passed to container tools',
    )
    await writeFile(join(directory, 'manifest.json'), manifest)
    await writeFile(join(directory, 'config.json'), config)
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
        TESTED_ARCHIVE_SHA256: hash(
            'synthetic archive bytes; never passed to container tools',
        ),
    }
    const execute = async (
        command: string,
        changes: Record<string, string> = {},
    ) => {
        const child = Bun.spawn(
            [
                process.execPath,
                '--no-env-file',
                decodeURIComponent(script),
                command,
            ],
            {
                env: { ...env, ...changes },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const [code, stderr] = await Promise.all([
            child.exited,
            new Response(child.stderr).text(),
            new Response(child.stdout).text(),
        ])
        return { code, stderr }
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
        expect((await execute('ready')).code).toBe(0)
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
