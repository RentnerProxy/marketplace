import { z } from 'zod'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { commit, sha256 } from '../../../../../contracts/v1/primitives.ts'
import type {
    marketplaceRepositoryClaims,
    marketplaceSubmissions,
} from '@/db/schema.ts'
import {
    candidateApiPath,
    githubJson,
    githubNumericId,
} from './github.service.ts'

const runSchema = z.object({
    id: githubNumericId,
    workflow_id: githubNumericId,
    run_attempt: z.number().int().positive(),
    path: z.string(),
    head_branch: z.string(),
    head_sha: commit,
    event: z.string(),
    display_title: z.string(),
    status: z.string().nullable(),
    conclusion: z.string().nullable(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
    repository: z.object({ id: githubNumericId }),
    head_repository: z.object({ id: githubNumericId }),
})
export type CandidateRun = z.output<typeof runSchema>
type SubmissionRunRequest = Pick<
    typeof marketplaceSubmissions.$inferSelect,
    'buildKey' | 'dispatchRequestedAt' | 'buildRunId' | 'request'
>

export function assertSubmissionRun(
    run: CandidateRun,
    submission: SubmissionRunRequest,
) {
    const [workflow, ref] = run.path.split('@')
    if (
        run.workflow_id !== pipeline.workflowId ||
        workflow !== pipeline.workflow ||
        (ref !== undefined &&
            ref !== pipeline.branch &&
            ref !== 'refs/heads/' + pipeline.branch) ||
        run.event !== 'workflow_dispatch' ||
        run.head_branch !== pipeline.branch ||
        run.repository.id !== pipeline.repositoryId ||
        run.head_repository.id !== pipeline.repositoryId ||
        run.display_title !== 'Marketplace submission ' + submission.buildKey ||
        (submission.buildRunId && run.id !== submission.buildRunId) ||
        !submission.dispatchRequestedAt ||
        Date.parse(run.created_at) <
            submission.dispatchRequestedAt.getTime() - 60_000 ||
        run.run_attempt !== 1
    ) {
        throw new InvalidCandidateError('invalidEvidence')
    }
}

export class InvalidCandidateError extends Error {
    constructor(readonly reason: 'invalidEvidence' | 'expiredEvidence') {
        super(reason)
    }
}

export async function dispatchCandidate(
    submission: SubmissionRunRequest,
    claim: typeof marketplaceRepositoryClaims.$inferSelect,
    token: string,
) {
    const { request } = submission
    const output = await githubJson(
        candidateApiPath('workflows/' + pipeline.workflowId + '/dispatches'),
        {
            token,
            input: {
                ref: pipeline.branch,
                inputs: {
                    source_repository: claim.repository,
                    source_commit: request.commit,
                    source_path: request.path,
                    publisher_name: request.publisherName,
                    submission_id: submission.buildKey,
                },
            },
        },
    )
    return z.object({ workflow_run_id: githubNumericId }).parse(output)
        .workflow_run_id
}

export async function findCandidateRun(
    submission: SubmissionRunRequest,
    token: string,
) {
    if (submission.buildRunId) return loadRun(submission.buildRunId)

    if (!submission.dispatchRequestedAt) return null
    const requestedAt = submission.dispatchRequestedAt.getTime()
    const from = new Date(requestedAt - 60_000).toISOString()
    const until = new Date(
        requestedAt + pipeline.dispatchTimeoutMs,
    ).toISOString()
    const query = new URLSearchParams({
        branch: pipeline.branch,
        event: 'workflow_dispatch',
        created: (from + '..' + until).replace(/\.\d+Z/g, 'Z'),
        per_page: '100',
    })
    const first = await loadPage(1)
    // The GitHub workflow-run search API caps filtered results at 1,000.
    if (first.total_count > 1000)
        throw new InvalidCandidateError('invalidEvidence')
    const pages = await Promise.all(
        Array.from(
            { length: Math.max(0, Math.ceil(first.total_count / 100) - 1) },
            (_, index) => loadPage(index + 2),
        ),
    )
    const title = 'Marketplace submission ' + submission.buildKey
    const matching = [first, ...pages]
        .flatMap(({ workflow_runs }) => workflow_runs)
        .filter(
            (entry) =>
                typeof entry === 'object' &&
                entry !== null &&
                'display_title' in entry &&
                entry.display_title === title,
        )
    const idOnly = z.object({ id: githubNumericId })
    const runIds = new Set(matching.map((entry) => idOnly.parse(entry).id))
    if (runIds.size > 1) throw new InvalidCandidateError('invalidEvidence')
    const [runId] = runIds
    return runId ? loadRun(runId) : null

    async function loadRun(id: string) {
        const run = runSchema.parse(
            await githubJson(candidateApiPath('runs/' + id), { token }),
        )
        assertSubmissionRun(run, submission)
        return run
    }

    async function loadPage(page: number) {
        const path =
            'workflows/' +
            pipeline.workflowId +
            '/runs?' +
            query +
            '&page=' +
            page
        return z
            .object({
                total_count: z.number().int().min(0),
                workflow_runs: z.array(z.unknown()).max(100),
            })
            .parse(await githubJson(candidateApiPath(path), { token }))
    }
}

const githubArtifact = z.object({
    id: githubNumericId,
    name: z.string(),
    size_in_bytes: z.number().int().positive().max(2_147_483_647),
    digest: z
        .string()
        .startsWith('sha256:')
        .transform((value) => value.slice(7))
        .pipe(sha256),
    expired: z.boolean(),
    expires_at: z.iso.datetime({ offset: true }),
    workflow_run: z.object({
        id: githubNumericId,
        repository_id: githubNumericId,
        head_repository_id: githubNumericId,
        head_branch: z.string(),
        head_sha: commit,
    }),
})

export function parseRunArtifact(value: unknown, run: CandidateRun) {
    const artifact = githubArtifact.safeParse(value)
    if (!artifact.success) throw new InvalidCandidateError('invalidEvidence')
    const { workflow_run: owner, ...receipt } = artifact.data
    if (
        owner.id !== run.id ||
        owner.repository_id !== pipeline.repositoryId ||
        owner.head_repository_id !== pipeline.repositoryId ||
        owner.head_branch !== pipeline.branch ||
        owner.head_sha !== run.head_sha
    )
        throw new InvalidCandidateError('invalidEvidence')
    if (receipt.expired || Date.parse(receipt.expires_at) <= Date.now()) {
        throw new InvalidCandidateError('expiredEvidence')
    }
    return {
        id: receipt.id,
        name: receipt.name,
        sizeBytes: receipt.size_in_bytes,
        sha256: receipt.digest,
        expiresAt: new Date(receipt.expires_at).toISOString(),
    }
}
