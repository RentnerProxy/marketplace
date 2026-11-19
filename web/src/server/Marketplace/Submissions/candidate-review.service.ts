import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import type {
    marketplaceRepositoryClaims,
    marketplaceSubmissions,
} from '@/db/schema.ts'
import type {
    SubmissionArtifact,
    ValidatedSubmission,
} from '@/lib/Marketplace/Types/submission.types.ts'
import { assembleCandidate } from '@/lib/Marketplace/candidateEvidence.ts'
import { byteIdentity } from '@/lib/Marketplace/evidenceIdentity.ts'
import { submissionReceipt } from '@/lib/Marketplace/submissionReceipt.ts'
import {
    findCandidateRun,
    InvalidCandidateError,
    parseRunArtifact,
    type CandidateRun,
} from './candidate-run.service.ts'
import {
    candidateApiPath,
    GitHubRequestError,
    githubJson,
    githubRequest,
    readBoundedBytes,
} from './github.service.ts'

type Submission = typeof marketplaceSubmissions.$inferSelect
type Claim = typeof marketplaceRepositoryClaims.$inferSelect

function bundleName(submission: Submission, run: CandidateRun) {
    return `${submission.buildKey}-${run.id}-${run.run_attempt}-bundle`
}

function evidenceName(run: CandidateRun) {
    return `submission-${run.run_attempt}.json`
}

function storedReceipt(
    artifact: ReturnType<typeof parseRunArtifact>,
): SubmissionArtifact {
    return {
        id: artifact.id,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        expiresAt: artifact.expiresAt,
    }
}

async function downloadEvidence(artifact: SubmissionArtifact, token: string) {
    if (artifact.sizeBytes > pipeline.evidenceMaxBytes) {
        throw new InvalidCandidateError('invalidEvidence')
    }
    const redirect = await githubRequest(
        candidateApiPath('artifacts/' + artifact.id + '/zip'),
        {
            token,
            redirect: 'manual',
        },
    )
    if (redirect.status !== 302)
        throw new GitHubRequestError(redirect.status, redirect.headers)

    const location = redirect.headers.get('location')
    if (!location) throw new InvalidCandidateError('invalidEvidence')
    const url = new URL(location)
    if (
        url.protocol !== 'https:' ||
        url.port ||
        url.username ||
        url.password ||
        !url.hostname.endsWith('.blob.core.windows.net')
    )
        throw new InvalidCandidateError('invalidEvidence')

    const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
    })
    const bytes = await readBoundedBytes(response, artifact.sizeBytes)
    const { sha256, sizeBytes } = byteIdentity(bytes)
    if (sha256 !== artifact.sha256 || sizeBytes !== artifact.sizeBytes) {
        throw new InvalidCandidateError('invalidEvidence')
    }
    try {
        const value: unknown = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        )
        return value
    } catch {
        throw new InvalidCandidateError('invalidEvidence')
    }
}

export async function verifySubmissionReceipt(
    value: unknown,
    submission: Submission,
    claim: Claim,
    run: CandidateRun,
    bundle: SubmissionArtifact,
    evidence: SubmissionArtifact,
): Promise<ValidatedSubmission> {
    if (run.status !== 'completed' || run.conclusion !== 'success') {
        throw new InvalidCandidateError('invalidEvidence')
    }
    try {
        const receipt = submissionReceipt.parse(value)
        const { request } = submission
        if (
            receipt.submissionId !== submission.buildKey ||
            receipt.sourcePath !== request.path ||
            receipt.bundleId !== bundle.id ||
            receipt.bundleSha256 !== bundle.sha256
        )
            throw new InvalidCandidateError('invalidEvidence')
        const { sealed } = await assembleCandidate(
            receipt.report.targets,
            {
                source: {
                    repositoryId: claim.repositoryId,
                    commit: request.commit,
                },
                build: {
                    repositoryId: pipeline.repositoryId,
                    workflowCommit: run.head_sha,
                    workflowPath: pipeline.builder,
                    runId: run.id,
                    attempt: run.run_attempt,
                },
                purpose: 'candidate',
            },
            request.publisherName,
        )
        if (
            !isDeepStrictEqual(receipt.candidate, sealed) ||
            sealed.release.appId !== request.appId ||
            sealed.release.version !== request.version ||
            !isDeepStrictEqual(
                sealed.release.packages.map(({ manifest }) => manifest.target),
                request.targets,
            ) ||
            sealed.release.packages.some(
                ({ manifest }) =>
                    !isDeepStrictEqual(manifest.display, request.display) ||
                    manifest.configSchema !== request.configSchema,
            )
        )
            throw new InvalidCandidateError('invalidEvidence')
        return { candidate: sealed, report: receipt.report, bundle, evidence }
    } catch {
        throw new InvalidCandidateError('invalidEvidence')
    }
}

export async function readCandidateReview(
    submission: Submission,
    claim: Claim,
    run: CandidateRun,
    token: string,
) {
    const { artifacts } = z
        .object({ artifacts: z.array(z.unknown()).max(20) })
        .parse(
            await githubJson(
                candidateApiPath('runs/' + run.id + '/artifacts?per_page=20'),
                { token },
            ),
        )
    function find(name: string) {
        const matches = artifacts.filter(
            (artifact) =>
                typeof artifact === 'object' &&
                artifact !== null &&
                'name' in artifact &&
                artifact.name === name,
        )
        if (matches.length !== 1)
            throw new InvalidCandidateError('invalidEvidence')
        return storedReceipt(parseRunArtifact(matches[0], run))
    }
    const bundle = find(bundleName(submission, run))
    const evidence = find(evidenceName(run))
    const receipt = await downloadEvidence(evidence, token)
    return verifySubmissionReceipt(
        receipt,
        submission,
        claim,
        run,
        bundle,
        evidence,
    )
}

export async function assertRetainedCandidate(
    submission: Submission,
    token: string,
) {
    const { validation } = submission
    if (!validation) throw new InvalidCandidateError('invalidEvidence')
    const { bundle, evidence, candidate } = validation
    if (
        [bundle, evidence].some(
            ({ expiresAt }) => Date.parse(expiresAt) <= Date.now(),
        )
    ) {
        throw new InvalidCandidateError('expiredEvidence')
    }
    try {
        const run = await findCandidateRun(submission, token)
        if (
            !run ||
            run.status !== 'completed' ||
            run.conclusion !== 'success' ||
            run.id !== candidate.build.runId ||
            run.head_sha !== candidate.build.workflowCommit ||
            run.run_attempt !== candidate.build.attempt
        )
            throw new InvalidCandidateError('invalidEvidence')

        const [currentBundle, currentEvidence] = await Promise.all(
            [bundle, evidence].map(async ({ id }) =>
                parseRunArtifact(
                    await githubJson(candidateApiPath('artifacts/' + id), {
                        token,
                    }),
                    run,
                ),
            ),
        )
        if (
            currentBundle.name !== bundleName(submission, run) ||
            currentEvidence.name !== evidenceName(run) ||
            !isDeepStrictEqual(storedReceipt(currentBundle), bundle) ||
            !isDeepStrictEqual(storedReceipt(currentEvidence), evidence)
        )
            throw new InvalidCandidateError('invalidEvidence')
    } catch (error) {
        if (
            error instanceof GitHubRequestError &&
            [404, 410].includes(error.status)
        ) {
            throw new InvalidCandidateError('expiredEvidence')
        }
        throw error
    }
}
