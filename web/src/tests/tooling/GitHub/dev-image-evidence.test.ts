import { expect, test } from 'bun:test'
import {
    createDevAssessment,
    createDevCandidate,
    createDevPublication,
    devImageIdentity,
    validateDevCandidate,
    verifyDevLoadedImage,
} from '../../../../../.github/scripts/deploy/dev-image-evidence.ts'
import type {
    DevImageActual,
    DevImageContext,
} from '../../../../../.github/scripts/deploy/Types/dev-image.ts'

const revision = 'a'.repeat(40)
const imageId = `sha256:${'b'.repeat(64)}`
const manifestDigest = `sha256:${'c'.repeat(64)}`
const archiveSha256 = 'd'.repeat(64)
const at = '2026-11-15T20:00:00.000Z'
const context: DevImageContext = {
    repository: 'RentnerProxy/marketplace',
    eventName: 'workflow_dispatch',
    ref: 'refs/heads/main',
    revision,
    workflowSha: revision,
    workflowRef:
        'RentnerProxy/marketplace/.github/workflows/dev-image.yml@refs/heads/main',
    runId: '1234',
    runAttempt: '2',
}

function loadedFixture() {
    const runtimeConfig = {
        Env: ['NODE_ENV=production', 'PORT=3000'],
        Entrypoint: ['/entrypoint.sh'],
        Cmd: ['serve'],
        Labels: { title: 'Marketplace', revision },
        Healthcheck: { Test: ['CMD', '/healthcheck'], Interval: 1000000000 },
    }
    const diffIds = [`sha256:${'e'.repeat(64)}`, `sha256:${'f'.repeat(64)}`]
    const config = {
        os: 'linux',
        architecture: 'amd64',
        config: runtimeConfig,
        rootfs: { type: 'layers', diff_ids: diffIds },
    }
    const inspected = {
        Id: manifestDigest,
        Os: 'linux',
        Architecture: 'amd64',
        Config: { ...runtimeConfig, WorkingDir: '/' },
        RootFS: { Type: 'layers', Layers: [...diffIds] },
    }
    return { config, inspected }
}

test('loaded image binds OCI runtime config and layers while permitting a backend image ID', () => {
    const { config, inspected } = loadedFixture()
    expect(verifyDevLoadedImage(config, inspected)).toBe(manifestDigest)
    expect(verifyDevLoadedImage(config, { ...inspected, Id: imageId })).toBe(imageId)
    expect(
        verifyDevLoadedImage(config, {
            ...inspected,
            Config: {
                ...inspected.Config,
                Labels: { revision, title: 'Marketplace' },
            },
        }),
    ).toBe(manifestDigest)
})

test.each([
    { Id: 'sha256:invalid' },
    { Id: `${manifestDigest}\n` },
    { Os: 'windows' },
    { Architecture: 'arm64' },
    { RootFS: { Type: 'other', Layers: [] } },
    { RootFS: { Type: 'layers', Layers: [] } },
    { RootFS: { Type: 'layers', Layers: [`sha256:${'e'.repeat(64)}`] } },
    { RootFS: { Type: 'layers', Layers: [`sha256:${'f'.repeat(64)}`, `sha256:${'e'.repeat(64)}`] } },
    { Config: null },
])('rejects loaded image identity or layer mismatch: %j', (change) => {
    const { config, inspected } = loadedFixture()
    expect(() => verifyDevLoadedImage(config, { ...inspected, ...change })).toThrow()
})

test.each([
    { Env: ['PORT=3000', 'NODE_ENV=production'] },
    { Env: ['NODE_ENV=development', 'PORT=3000'] },
    { Entrypoint: ['/other.sh'] },
    { Cmd: ['other'] },
    { Healthcheck: { Test: ['CMD', '/other'], Interval: 1000000000 } },
    { Healthcheck: { Test: ['CMD', '/healthcheck'], Interval: 1000000000, Disabled: true } },
    { Labels: { title: 'Marketplace', revision: 'forged' } },
])('rejects changed runtime config: %j', (change) => {
    const { config, inspected } = loadedFixture()
    expect(() =>
        verifyDevLoadedImage(config, {
            ...inspected,
            Config: { ...inspected.Config, ...change },
        }),
    ).toThrow()
})

test.each([
    { os: 'windows' },
    { architecture: 'arm64' },
    { config: null },
    { rootfs: { type: 'other', diff_ids: [] } },
    { rootfs: { type: 'layers', diff_ids: [] } },
    { rootfs: { type: 'layers', diff_ids: ['sha256:invalid'] } },
])('rejects unsupported OCI runtime configuration: %j', (change) => {
    const { config, inspected } = loadedFixture()
    expect(() => verifyDevLoadedImage({ ...config, ...change }, inspected)).toThrow()
})

test('rejects missing expected runtime keys and malformed loaded objects', () => {
    const { config, inspected } = loadedFixture()
    const { Env: _env, ...withoutEnv } = inspected.Config
    expect(() => verifyDevLoadedImage(config, { ...inspected, Config: withoutEnv })).toThrow()
    expect(() => verifyDevLoadedImage(config, [inspected])).toThrow()
    expect(() => verifyDevLoadedImage(null, inspected)).toThrow()
})

function fixture() {
    const identity = devImageIdentity(context)
    const manifest = {
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: { digest: imageId },
        layers: [{ digest: `sha256:${'e'.repeat(64)}` }],
    }
    const config = {
        os: 'linux',
        architecture: 'amd64',
        config: {
            Labels: {
                'org.opencontainers.image.revision': revision,
                'org.opencontainers.image.version': identity.version,
                'org.opencontainers.image.source':
                    'https://github.com/RentnerProxy/marketplace',
                'org.opencontainers.image.title': 'RentnerProxy Marketplace Dev',
            },
        },
    }
    const actual: DevImageActual = {
        archiveSha256,
        manifestDigest,
        manifest,
        config,
        imageId,
    }
    return { identity, manifest, config, actual }
}

test('manual main identity binds the repository, revision, run and platform', () => {
    expect(devImageIdentity(context)).toEqual({
        repository: 'RentnerProxy/marketplace',
        image: 'ghcr.io/rentnerproxy/marketplace',
        revision,
        version: `dev-${revision.slice(0, 12)}`,
        immutableTag: `dev-${revision.slice(0, 12)}-1234-2`,
        platforms: ['linux/amd64'],
        runId: '1234',
        runAttempt: '2',
    })
    expect(
        devImageIdentity({
            ...context,
            repository: 'rentnerproxy/marketplace',
            workflowRef: context.workflowRef.replace('RentnerProxy', 'rentnerproxy'),
        }),
    ).toEqual(devImageIdentity(context))
})

const invalidContexts: Partial<DevImageContext>[] = [
    { repository: 'fork/marketplace' },
    { repository: 'RentnerProxy/marketplace\n' },
    { eventName: 'pull_request' },
    { eventName: 'workflow_run' },
    { eventName: 'push' },
    { ref: 'refs/heads/feature' },
    { ref: 'refs/tags/main' },
    { revision: revision.toUpperCase(), workflowSha: revision.toUpperCase() },
    { revision: `${revision}\n` },
    { workflowSha: 'f'.repeat(40) },
    { workflowRef: context.workflowRef.replace('main', 'MAIN') },
    { workflowRef: context.workflowRef.replace('dev-image', 'ci') },
    { workflowRef: `${context.workflowRef}\n` },
    { runId: '0' },
    { runId: '01' },
    { runId: '12\n' },
    { runId: '1; echo unsafe' },
    { runAttempt: '-1' },
    { runAttempt: '01' },
    { runAttempt: '1\n' },
]

test.each(invalidContexts)('rejects identity outside the trusted manual workflow: %j', (change) => {
    expect(() => devImageIdentity({ ...context, ...change })).toThrow()
})

test('candidate validation reconstructs evidence from independently inspected bytes', () => {
    const { identity, actual } = fixture()
    const candidate = createDevCandidate(identity, actual)
    expect(candidate).toEqual({
        ...identity,
        schemaVersion: 1,
        policy: 'marketplace-dev-v1',
        archiveSha256,
        digest: manifestDigest,
        imageId,
        checks: [
            'runtime-vulnerabilities',
            'isolated-appliance',
            'native-core-integration',
        ],
    })
    expect(validateDevCandidate(candidate, identity, actual)).toEqual(candidate)
    expect(
        validateDevCandidate(
            Object.fromEntries(Object.entries(candidate).toReversed()),
            identity,
            actual,
        ),
    ).toEqual(candidate)
})

test.each([
    { schemaVersion: 2 },
    { policy: 'other-policy' },
    { repository: 'fork/marketplace' },
    { image: 'ghcr.io/fork/marketplace' },
    { revision: 'f'.repeat(40) },
    { version: 'dev-forged' },
    { immutableTag: 'dev-forged-1-1' },
    { runId: '1235' },
    { runAttempt: '3' },
    { platforms: ['linux/amd64', 'linux/arm64'] },
    { checks: ['runtime-vulnerabilities'] },
    { checks: ['runtime-vulnerabilities', 'isolated-appliance', 'caddy'] },
    { archiveSha256: 'f'.repeat(64) },
    { digest: `sha256:${'f'.repeat(64)}` },
    { imageId: `sha256:${'f'.repeat(64)}` },
    { approved: true },
])('rejects fabricated candidate fields: %j', (change) => {
    const { identity, actual } = fixture()
    const candidate = createDevCandidate(identity, actual)
    expect(() =>
        validateDevCandidate({ ...candidate, ...change }, identity, actual),
    ).toThrow()
})

test.each([null, [], {}, 'candidate'].map((value) => ({ value })))('rejects malformed evidence %j', ({ value }) => {
    const { identity, actual } = fixture()
    expect(() => validateDevCandidate(value, identity, actual)).toThrow()
})

test.each([
    { manifest: { schemaVersion: 2, manifests: [] } },
    { manifest: null },
    { config: null },
    { archiveSha256: `${archiveSha256}\n` },
    { manifestDigest: `${manifestDigest}\n` },
    { imageId: 'sha256:bad' },
])('rejects malformed actual image data: %j', (change) => {
    const { identity, actual } = fixture()
    expect(() => createDevCandidate(identity, { ...actual, ...change })).toThrow()
})

test.each([
    { schemaVersion: 1 },
    { mediaType: 'application/vnd.oci.image.index.v1+json' },
    { manifests: [] },
    { config: { digest: manifestDigest } },
    { layers: [] },
    { layers: [{ digest: 'sha256:bad' }] },
])('rejects an index, config mismatch or invalid layers: %j', (change) => {
    const { identity, actual, manifest } = fixture()
    expect(() =>
        createDevCandidate(identity, {
            ...actual,
            manifest: { ...manifest, ...change },
        }),
    ).toThrow()
})

test.each([
    { os: 'windows' },
    { architecture: 'arm64' },
    { config: {} },
])('rejects unsupported config: %j', (change) => {
    const { identity, actual, config } = fixture()
    expect(() =>
        createDevCandidate(identity, { ...actual, config: { ...config, ...change } }),
    ).toThrow()
})

test.each(['revision', 'version', 'source', 'title'])(
    'rejects actual label mismatch for %s even when evidence is unchanged',
    (label) => {
        const { identity, actual, config } = fixture()
        const candidate = createDevCandidate(identity, actual)
        const changed = {
            ...config,
            config: {
                Labels: {
                    ...config.config.Labels,
                    [`org.opencontainers.image.${label}`]: 'forged',
                },
            },
        }
        expect(() =>
            validateDevCandidate(candidate, identity, { ...actual, config: changed }),
        ).toThrow()
    },
)

test('assessment records the bounded Marketplace gates', () => {
    const { identity, actual } = fixture()
    const candidate = createDevCandidate(identity, actual)
    expect(createDevAssessment(candidate, at)).toEqual({
        schemaVersion: 1,
        policy: 'marketplace-dev-v1',
        verdict: 'marketplace-dev-approved',
        repository: identity.repository,
        image: identity.image,
        revision,
        digest: manifestDigest,
        version: identity.version,
        platforms: ['linux/amd64'],
        runId: '1234',
        runAttempt: '2',
        assessedAt: at,
        checks: [
            'typescript',
            'rust',
            'bun-advisories',
            'cargo-advisories',
            'runtime-vulnerabilities',
            'isolated-appliance',
            'native-core-integration',
            'publisher-runtime-vulnerabilities',
        ],
    })
})

test('publication requires both actual remote tag digests to match', () => {
    const { identity, actual } = fixture()
    const candidate = createDevCandidate(identity, actual)
    expect(
        createDevPublication(candidate, { immutable: manifestDigest, dev: manifestDigest }, at),
    ).toEqual({
        schemaVersion: 1,
        published: true,
        image: identity.image,
        revision,
        digest: manifestDigest,
        reference: `${identity.image}@${manifestDigest}`,
        version: identity.version,
        platforms: ['linux/amd64'],
        runId: '1234',
        runAttempt: '2',
        tags: [identity.immutableTag, 'dev'],
        publishedAt: at,
    })
    for (const digests of [
        { immutable: imageId, dev: manifestDigest },
        { immutable: manifestDigest, dev: imageId },
        { immutable: imageId, dev: imageId },
        { immutable: manifestDigest, dev: `${manifestDigest}\n` },
    ]) {
        expect(() => createDevPublication(candidate, digests, at)).toThrow()
    }
})

test.each(['not-a-date', '2026-02-30T00:00:00.000Z', `${at}\n`])(
    'rejects invalid assessment and publication timestamps: %j',
    (invalidAt) => {
        const { identity, actual } = fixture()
        const candidate = createDevCandidate(identity, actual)
        expect(() => createDevAssessment(candidate, invalidAt)).toThrow()
        expect(() =>
            createDevPublication(
                candidate,
                { immutable: manifestDigest, dev: manifestDigest },
                invalidAt,
            ),
        ).toThrow()
    },
)

test('rejects forged typed identities and candidates at evidence creation boundaries', () => {
    const { identity, actual } = fixture()
    expect(() =>
        createDevCandidate({ ...identity, version: 'dev-forged' }, actual),
    ).toThrow()
    const candidate = createDevCandidate(identity, actual)
    expect(() => createDevAssessment({ ...candidate, digest: 'bad' }, at)).toThrow()
    expect(() =>
        createDevPublication(
            { ...candidate, immutableTag: 'forged' },
            { immutable: manifestDigest, dev: manifestDigest },
            at,
        ),
    ).toThrow()
})
