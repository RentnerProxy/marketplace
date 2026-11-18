import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import {
    catalogPublisherAudience,
    catalogPublisherEnvironment,
    catalogPublisherWorkflow,
} from '@/lib/Marketplace/catalogPublication.ts'
import { commit, githubId } from '../../../../../contracts/v1/primitives.ts'
import type { Publication } from '../../../../../contracts/v1/index.ts'
import {
    candidateGitHubToken,
    candidateApiPath,
    githubJson,
    githubNumericId,
} from './github.service.ts'
import { SubmissionConflictError } from './submission-store.service.ts'

const issuer = 'https://token.actions.githubusercontent.com'
const keys = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'))
const branchRef = 'refs/heads/' + pipeline.branch
const event = z.enum(['schedule', 'workflow_dispatch'])

const publisherClaims = z.object({
    aud: z.literal(catalogPublisherAudience),
    repository: z.literal(pipeline.repository),
    repository_id: z.literal(pipeline.repositoryId),
    repository_owner_id: z.literal(pipeline.officialOwnerId),
    ref: z.literal(branchRef),
    environment: z.literal(catalogPublisherEnvironment),
    event_name: event,
    workflow_ref: z.literal(
        `${pipeline.repository}/${catalogPublisherWorkflow}@${branchRef}`,
    ),
    workflow_sha: commit,
    run_id: githubId,
    run_attempt: githubId.transform(Number).pipe(z.int().positive()),
    iat: z.int(),
    exp: z.int(),
})

export class PublisherAuthenticationError extends Error {}

export async function authenticateCatalogPublisherService(
    request: Request,
    getKey: JWTVerifyGetKey = keys,
): Promise<Publication['run']> {
    const authorization = request.headers.get('authorization')
    const match =
        authorization && authorization.length <= 8192
            ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
                  authorization,
              )
            : null
    if (!match?.[1]) throw new PublisherAuthenticationError()

    try {
        const { payload } = await jwtVerify(match[1], getKey, {
            issuer,
            audience: catalogPublisherAudience,
            algorithms: ['RS256'],
            requiredClaims: ['nbf', 'iat', 'exp'],
            clockTolerance: 10,
            maxTokenAge: '5 minutes',
        })
        const claims = publisherClaims.parse(payload)
        if (claims.exp <= claims.iat || claims.exp - claims.iat > 600)
            throw new PublisherAuthenticationError()
        return {
            repositoryId: claims.repository_id,
            workflowCommit: claims.workflow_sha,
            workflowPath: catalogPublisherWorkflow,
            runId: claims.run_id,
            attempt: claims.run_attempt,
        }
    } catch {
        throw new PublisherAuthenticationError()
    }
}

const githubRun = z.object({
    id: githubNumericId,
    run_attempt: z.int().positive(),
    path: z.string(),
    event,
    head_branch: z.literal(pipeline.branch),
    head_sha: commit,
    status: z.literal('completed'),
    repository: z.object({ id: githubNumericId }),
    head_repository: z.object({ id: githubNumericId }),
})

export function assertCatalogPublisherRun(run: Publication['run']) {
    if (
        run.repositoryId !== pipeline.repositoryId ||
        run.workflowPath !== catalogPublisherWorkflow
    )
        throw new SubmissionConflictError()
}

export async function assertTerminalCatalogPublisherRunService(
    run: Publication['run'],
) {
    assertCatalogPublisherRun(run)
    const token = candidateGitHubToken()
    if (!token) throw new Error('buildsUnavailable')
    const result = githubRun.safeParse(
        await githubJson(
            candidateApiPath(`runs/${run.runId}/attempts/${run.attempt}`),
            { token },
        ),
    )
    if (!result.success) throw new SubmissionConflictError()
    const observed = result.data
    if (
        observed.id !== run.runId ||
        observed.run_attempt !== run.attempt ||
        observed.head_sha !== run.workflowCommit ||
        observed.repository.id !== run.repositoryId ||
        observed.head_repository.id !== run.repositoryId ||
        ![
            run.workflowPath,
            `${run.workflowPath}@${pipeline.branch}`,
            `${run.workflowPath}@${branchRef}`,
        ].includes(observed.path)
    )
        throw new SubmissionConflictError()
}
