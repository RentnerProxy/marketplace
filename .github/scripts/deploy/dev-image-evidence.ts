import type {
    DevAssessment,
    DevCandidate,
    DevImageActual,
    DevImageContext,
    DevImageIdentity,
    DevPublication,
} from './Types/dev-image.ts'

function matches(value: unknown, pattern: RegExp): value is string {
    return typeof value === 'string' && pattern.exec(value)?.[0] === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error('Invalid Dev image evidence object')
    }
    return value
}

function digest(value: unknown): string {
    if (!matches(value, /^sha256:[a-f0-9]{64}$/u)) {
        throw new Error('Invalid Dev image SHA-256 digest')
    }
    return value
}

function equal(actual: unknown, expected: unknown): boolean {
    if (Array.isArray(expected)) {
        return (
            Array.isArray(actual) &&
            actual.length === expected.length &&
            expected.every((value, index) => equal(actual[index], value))
        )
    }
    if (expected !== null && typeof expected === 'object') {
        const expectedRecord = record(expected)
        const actualRecord = record(actual)
        const keys = Object.keys(expectedRecord)
        return (
            Object.keys(actualRecord).length === keys.length &&
            keys.every(
                (key) =>
                    Object.hasOwn(actualRecord, key) &&
                    equal(actualRecord[key], expectedRecord[key]),
            )
        )
    }
    return actual === expected
}

export function verifyDevLoadedImage(
    config: unknown,
    inspected: unknown,
): string {
    const expected = record(config)
    const loaded = record(inspected)
    const expectedConfig = record(expected.config)
    const loadedConfig = record(loaded.Config)
    const expectedRoot = record(expected.rootfs)
    const loadedRoot = record(loaded.RootFS)
    const healthcheck = record(expectedConfig.Healthcheck)
    if (
        healthcheck.Disabled === true ||
        !Array.isArray(healthcheck.Test) ||
        !['CMD', 'CMD-SHELL'].includes(healthcheck.Test[0]) ||
        healthcheck.Test.length < 2 ||
        !healthcheck.Test.slice(1).every(
            (command) =>
                typeof command === 'string' && command.trim().length > 0,
        )
    ) {
        throw new Error('Loaded Dev image requires an enabled OCI healthcheck')
    }
    if (
        expected.os !== 'linux' ||
        expected.architecture !== 'amd64' ||
        loaded.Os !== 'linux' ||
        loaded.Architecture !== 'amd64' ||
        expectedRoot.type !== 'layers' ||
        loadedRoot.Type !== 'layers' ||
        !Array.isArray(expectedRoot.diff_ids) ||
        expectedRoot.diff_ids.length === 0
    ) {
        throw new Error('Loaded Dev image platform or root filesystem mismatch')
    }
    for (const layer of expectedRoot.diff_ids) digest(layer)
    if (
        !equal(loadedRoot.Layers, expectedRoot.diff_ids) ||
        !Object.keys(expectedConfig).every(
            (key) =>
                Object.hasOwn(loadedConfig, key) &&
                equal(loadedConfig[key], expectedConfig[key]),
        )
    ) {
        throw new Error('Loaded Dev image runtime configuration mismatch')
    }
    return digest(loaded.Id)
}

export function devImageIdentity(context: DevImageContext): DevImageIdentity {
    const workflowRepository = context.workflowRef
        .split('/')
        .slice(0, 2)
        .join('/')
    if (
        context.repository.toLowerCase() !== 'rentnerproxy/marketplace' ||
        context.eventName !== 'workflow_dispatch' ||
        context.ref !== 'refs/heads/main' ||
        !matches(context.revision, /^[a-f0-9]{40}$/u) ||
        context.revision !== context.workflowSha ||
        workflowRepository.toLowerCase() !== 'rentnerproxy/marketplace' ||
        context.workflowRef !==
            `${workflowRepository}/.github/workflows/dev-image.yml@refs/heads/main` ||
        !matches(context.runId, /^[1-9][0-9]*$/u) ||
        !matches(context.runAttempt, /^[1-9][0-9]*$/u)
    ) {
        throw new Error(
            'Dev images require the Marketplace manual main workflow',
        )
    }
    const version = `dev-${context.revision.slice(0, 12)}`
    return {
        repository: 'RentnerProxy/marketplace',
        image: 'ghcr.io/rentnerproxy/marketplace',
        revision: context.revision,
        version,
        immutableTag: `${version}-${context.runId}-${context.runAttempt}`,
        platforms: ['linux/amd64'],
        runId: context.runId,
        runAttempt: context.runAttempt,
    }
}

function canonicalIdentity(identity: DevImageIdentity): DevImageIdentity {
    const expected = devImageIdentity({
        ...identity,
        eventName: 'workflow_dispatch',
        ref: 'refs/heads/main',
        workflowSha: identity.revision,
        workflowRef:
            'RentnerProxy/marketplace/.github/workflows/dev-image.yml@refs/heads/main',
    })
    if (!equal(identity, expected))
        throw new Error('Invalid Dev image identity')
    return expected
}

function candidateFields(
    identity: DevImageIdentity,
    actual: Pick<
        DevImageActual,
        'archiveSha256' | 'manifestDigest' | 'imageId'
    >,
): DevCandidate {
    if (!matches(actual.archiveSha256, /^[a-f0-9]{64}$/u)) {
        throw new Error('Invalid Dev image archive SHA-256')
    }
    return {
        ...canonicalIdentity(identity),
        schemaVersion: 1,
        policy: 'marketplace-dev-v1',
        archiveSha256: actual.archiveSha256,
        digest: digest(actual.manifestDigest),
        imageId: digest(actual.imageId),
        checks: [
            'runtime-vulnerabilities',
            'isolated-appliance',
            'native-core-integration',
        ],
    }
}

export function createDevCandidate(
    identity: DevImageIdentity,
    actual: DevImageActual,
): DevCandidate {
    const candidate = candidateFields(identity, actual)
    const manifest = record(actual.manifest)
    if (
        manifest.schemaVersion !== 2 ||
        manifest.mediaType !== 'application/vnd.oci.image.manifest.v1+json' ||
        Object.hasOwn(manifest, 'manifests') ||
        record(manifest.config).digest !== candidate.imageId ||
        !Array.isArray(manifest.layers) ||
        manifest.layers.length === 0
    ) {
        throw new Error('Dev image must be a single OCI image manifest')
    }
    for (const layer of manifest.layers) digest(record(layer).digest)
    const config = record(actual.config)
    const runtimeConfig = record(config.config)
    const labels = record(runtimeConfig.Labels)
    const healthcheck = record(runtimeConfig.Healthcheck)
    if (
        config.os !== 'linux' ||
        config.architecture !== 'amd64' ||
        healthcheck.Disabled === true ||
        !equal(healthcheck.Test, ['CMD', 'container-healthcheck.sh']) ||
        labels['org.opencontainers.image.revision'] !== identity.revision ||
        labels['org.opencontainers.image.version'] !== identity.version ||
        labels['org.opencontainers.image.source'] !==
            'https://github.com/RentnerProxy/marketplace' ||
        labels['org.opencontainers.image.title'] !==
            'RentnerProxy Marketplace Dev'
    ) {
        throw new Error(
            'Dev image platform or OCI labels do not match its identity',
        )
    }
    return candidate
}

export function validateDevCandidate(
    value: unknown,
    identity: DevImageIdentity,
    actual: DevImageActual,
): DevCandidate {
    const expected = createDevCandidate(identity, actual)
    if (!equal(value, expected))
        throw new Error('Dev candidate evidence mismatch')
    return expected
}

function canonicalCandidate(candidate: DevCandidate): DevCandidate {
    const identity: DevImageIdentity = {
        repository: candidate.repository,
        image: candidate.image,
        revision: candidate.revision,
        version: candidate.version,
        immutableTag: candidate.immutableTag,
        platforms: candidate.platforms,
        runId: candidate.runId,
        runAttempt: candidate.runAttempt,
    }
    const expected = candidateFields(identity, {
        archiveSha256: candidate.archiveSha256,
        manifestDigest: candidate.digest,
        imageId: candidate.imageId,
    })
    if (!equal(candidate, expected))
        throw new Error('Invalid Dev candidate evidence')
    return expected
}

function timestamp(value: string): string {
    if (
        !matches(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString() !== value
    ) {
        throw new Error('Dev evidence requires a canonical ISO timestamp')
    }
    return value
}

export function createDevAssessment(
    candidate: DevCandidate,
    assessedAt: string,
): DevAssessment {
    const value = canonicalCandidate(candidate)
    return {
        schemaVersion: 1,
        policy: 'marketplace-dev-v1',
        verdict: 'marketplace-dev-approved',
        repository: value.repository,
        image: value.image,
        revision: value.revision,
        digest: value.digest,
        version: value.version,
        platforms: [...value.platforms],
        runId: value.runId,
        runAttempt: value.runAttempt,
        assessedAt: timestamp(assessedAt),
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
    }
}

export function createDevPublication(
    candidate: DevCandidate,
    actualRemoteDigests: { immutable: string; dev: string },
    publishedAt: string,
): DevPublication {
    const value = canonicalCandidate(candidate)
    if (
        digest(actualRemoteDigests.immutable) !== value.digest ||
        digest(actualRemoteDigests.dev) !== value.digest
    ) {
        throw new Error(
            'Published Dev tags do not match the approved image digest',
        )
    }
    return {
        schemaVersion: 1,
        published: true,
        image: value.image,
        revision: value.revision,
        digest: value.digest,
        reference: `${value.image}@${value.digest}`,
        version: value.version,
        platforms: [...value.platforms],
        runId: value.runId,
        runAttempt: value.runAttempt,
        tags: [value.immutableTag, 'dev'],
        publishedAt: timestamp(publishedAt),
    }
}
