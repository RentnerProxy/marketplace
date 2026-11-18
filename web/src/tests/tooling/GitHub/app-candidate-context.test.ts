import { describe, expect, test } from 'bun:test'
import {
    classifyRun,
    readCandidateContext,
} from '../../../../../.github/scripts/ci/app-candidates/context.ts'
import {
    checkSourceTree,
    sourceRequest,
} from '../../../../../.github/scripts/ci/app-candidates/source.ts'

const commit = 'a'.repeat(40)
const repository = 'RentnerProxy/marketplace'
const candidateWorkflow =
    repository + '/.github/workflows/app-candidate-review.yml@refs/heads/main'
const directRun = {
    callerRepository: repository,
    callerWorkflow: candidateWorkflow,
    event: 'workflow_dispatch',
    callerRef: 'refs/heads/main',
    callerSha: commit,
    workflowSha: commit,
    source: { repository: 'example/greeter', commit, path: '.' },
}

describe('app candidate workflow identity', () => {
    test('admits a review candidate from the direct Marketplace main run', () => {
        expect(classifyRun(directRun)).toBe('candidate')
        expect(
            classifyRun({
                ...directRun,
                source: {
                    repository,
                    commit,
                    path: '.github/scripts/ci/fixtures/app-candidate/v1',
                },
            }),
        ).toBe('reference')
    })

    test('limits other workflows, repositories or branches to development', () => {
        for (const run of [
            { ...directRun, callerRepository: 'example/market' },
            {
                ...directRun,
                callerWorkflow:
                    repository + '/.github/workflows/other.yml@refs/heads/main',
            },
            { ...directRun, callerRef: 'refs/heads/test' },
            { ...directRun, workflowSha: 'b'.repeat(40) },
            { ...directRun, event: 'pull_request' },
        ])
            expect(classifyRun(run)).toBe('development')
    })

    test('ties the internal reference to the exact reviewed commit and known module', () => {
        const run = {
            ...directRun,
            callerWorkflow:
                repository +
                '/.github/workflows/app-candidate-reference.yml@refs/pull/1/merge',
            event: 'pull_request',
            source: {
                repository,
                commit,
                path: '.github/scripts/ci/fixtures/app-candidate/v2',
            },
        }
        expect(classifyRun(run)).toBe('reference')
        expect(() =>
            classifyRun({
                ...run,
                source: { ...run.source, commit: 'b'.repeat(40) },
            }),
        ).toThrow()
        expect(() =>
            classifyRun({ ...run, source: { ...run.source, path: '.' } }),
        ).toThrow()
    })

    test('binds the effective workflow commit to its run and attempt', () => {
        const env = {
            SOURCE_REPOSITORY: 'example/greeter',
            SOURCE_COMMIT: commit,
            SOURCE_PATH: '.',
            ARTIFACT_PREFIX: 'greeter',
            DRIVER_REPOSITORY: repository,
            DRIVER_SHA: commit,
            DRIVER_PATH: '.github/workflows/app-candidate.yml',
            GITHUB_REPOSITORY_ID: '500',
            GITHUB_REPOSITORY: repository,
            GITHUB_RUN_ID: '300',
            GITHUB_RUN_ATTEMPT: '2',
            GITHUB_REF: 'refs/heads/main',
            GITHUB_SHA: commit,
            GITHUB_EVENT_NAME: 'workflow_dispatch',
            GITHUB_WORKFLOW_REF: candidateWorkflow,
        }
        expect(readCandidateContext(env).build).toEqual({
            repositoryId: '500',
            workflowCommit: commit,
            workflowPath: '.github/workflows/app-candidate.yml',
            runId: '300',
            attempt: 2,
        })
        expect(() =>
            readCandidateContext({
                ...env,
                DRIVER_REPOSITORY: 'example/market',
            }),
        ).toThrow()
        expect(() =>
            readCandidateContext({ ...env, ARTIFACT_PREFIX: 'path/unsafe' }),
        ).toThrow()
        expect(() =>
            readCandidateContext({
                ...env,
                GITHUB_RUN_ATTEMPT: '9007199254740992',
            }),
        ).toThrow()
    })

    test('rejects mutable refs and repository or path syntax that could change the source', () => {
        const request = {
            repository: 'example/greeter',
            commit,
            path: 'apps/greeter',
        }
        expect(sourceRequest.safeParse(request).success).toBe(true)
        for (const overrides of [
            { repository: 'example/../greeter' },
            { repository: 'https://github.com/example/greeter' },
            { commit: 'main' },
            { path: '../greeter' },
            { path: 'apps/.git' },
            { path: 'apps//greeter' },
            { path: '/greeter' },
        ])
            expect(
                sourceRequest.safeParse({ ...request, ...overrides }).success,
            ).toBe(false)
    })

    test('requires a complete, bounded list of blobs for the exact source tree', () => {
        const tree = {
            sha: commit,
            truncated: false,
            tree: [{ type: 'blob', sha: 'b'.repeat(40), size: 300 }],
        }
        expect(checkSourceTree(tree, commit)).toEqual(['b'.repeat(40)])
        for (const candidate of [
            { ...tree, sha: 'b'.repeat(40) },
            { ...tree, truncated: true },
            { ...tree, tree: [{ type: 'blob', sha: commit }] },
            {
                ...tree,
                tree: [{ type: 'blob', sha: commit, size: 64 * 1024 * 1024 }],
            },
            { ...tree, tree: [{ type: 'commit', sha: commit }] },
        ])
            expect(() => checkSourceTree(candidate, commit)).toThrow()
    })

    test('selects unique admitted blob IDs even when thousands of paths share an object', () => {
        const blobs = Array.from({ length: 2000 }, (_, index) => ({
            type: 'blob',
            sha: index.toString(16).padStart(40, '0'),
            size: 120,
        }))
        expect(
            checkSourceTree(
                { sha: commit, truncated: false, tree: [...blobs, ...blobs] },
                commit,
            ),
        ).toEqual(blobs.map(({ sha }) => sha))
    })
})
