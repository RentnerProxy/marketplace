export const CANDIDATE_PIPELINE = {
    repository: 'RentnerProxy/marketplace',
    repositoryId: '1449495731',
    officialOwnerId: '353739658',
    workflowId: '422275470',
    workflow: '.github/workflows/app-candidate-review.yml',
    builder: '.github/workflows/app-candidate.yml',
    branch: 'main',
    evidenceMaxBytes: 1024 * 1024,
    proofPath: '.github/marketplace-publisher.txt',
    officialNamespace: 'rentnerproxy',
    targets: ['linux-amd64', 'linux-arm64'],
    pollMs: 15_000,
    leaseMs: 120_000,
    dispatchTimeoutMs: 15 * 60_000,
    buildTimeoutMs: 75 * 60_000,
    recheckMs: 10 * 60_000,
} as const

export const SUBMISSION_PAGE_SIZE = 20
