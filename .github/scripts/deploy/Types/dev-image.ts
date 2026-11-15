export type DevImageContext = {
    repository: string
    eventName: string
    ref: string
    revision: string
    workflowSha: string
    workflowRef: string
    runId: string
    runAttempt: string
}

export type DevImageIdentity = {
    repository: 'RentnerProxy/marketplace'
    image: 'ghcr.io/rentnerproxy/marketplace'
    revision: string
    version: string
    immutableTag: string
    platforms: ['linux/amd64']
    runId: string
    runAttempt: string
}

export type DevImageActual = {
    archiveSha256: string
    manifestDigest: string
    manifest: unknown
    config: unknown
    imageId: string
}

export type DevCandidate = DevImageIdentity & {
    schemaVersion: 1
    policy: 'marketplace-dev-v1'
    archiveSha256: string
    digest: string
    imageId: string
    checks: [
        'runtime-vulnerabilities',
        'isolated-appliance',
        'native-core-integration',
    ]
}

export type DevAssessment = Omit<DevImageIdentity, 'immutableTag'> & {
    schemaVersion: 1
    policy: 'marketplace-dev-v1'
    verdict: 'marketplace-dev-approved'
    digest: string
    assessedAt: string
    checks: [
        'typescript',
        'rust',
        'bun-advisories',
        'cargo-advisories',
        'runtime-vulnerabilities',
        'isolated-appliance',
        'native-core-integration',
        'publisher-runtime-vulnerabilities',
    ]
}

export type DevPublication = Omit<
    DevImageIdentity,
    'repository' | 'immutableTag'
> & {
    schemaVersion: 1
    published: true
    digest: string
    reference: string
    tags: [string, 'dev']
    publishedAt: string
}
