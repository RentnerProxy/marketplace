import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { z } from 'zod'
import { checkApprovalBinding } from '@rentnerproxy/app-contracts'
import { CANDIDATE_PIPELINE as pipeline } from '../../../../web/src/config/submissions.config.ts'
import { verifyNativeArtifactStream } from '../../../../web/src/lib/Core/native-tool.ts'
import {
    assetNames,
    candidateName,
    reportName,
} from '../../../../web/src/lib/Marketplace/candidateEvidence.ts'
import type { publicationHandoff } from '../../../../web/src/lib/Marketplace/catalogPublication.ts'
import type { SubmissionArtifact } from '../../../../web/src/lib/Marketplace/Types/submission.types.ts'
import {
    candidateRunSchema,
    parseRunArtifact,
} from '../../../../web/src/server/Marketplace/Submissions/candidate-run.service.ts'
import {
    candidateApiPath,
    githubJson,
    githubRequest,
} from '../../../../web/src/server/Marketplace/Submissions/github.service.ts'
import { verifyCandidateHandoff } from '../../ci/app-candidates/evidence.ts'
import {
    evidenceLimit,
    metadataLimit,
    packageLimit,
} from '../../ci/app-candidates/evidence-files.ts'
import { extractCandidateZip } from './catalog-core.ts'

type Handoff = z.output<typeof publicationHandoff>
const zipLimit =
    2 * (packageLimit + evidenceLimit + metadataLimit) + 4 * 1024 * 1024

async function verifyBundleReceipt(handoff: Handoff, token: string) {
    const { build } = handoff.approval.candidate
    if (
        build.repositoryId !== pipeline.repositoryId ||
        build.workflowPath !== pipeline.builder ||
        build.attempt !== 1 ||
        handoff.bundle.sizeBytes > zipLimit
    )
        throw new Error('Invalid approved candidate build identity')
    const [runData, artifactData] = await Promise.all([
        githubJson(
            candidateApiPath(`runs/${build.runId}/attempts/${build.attempt}`),
            { token },
        ),
        githubJson(candidateApiPath('artifacts/' + handoff.bundle.id), {
            token,
        }),
    ])
    const run = candidateRunSchema.parse(runData)
    const [path, ref] = run.path.split('@')
    if (
        run.id !== build.runId ||
        run.run_attempt !== build.attempt ||
        run.head_sha !== build.workflowCommit ||
        run.head_branch !== pipeline.branch ||
        run.workflow_id !== pipeline.workflowId ||
        path !== pipeline.workflow ||
        (ref !== undefined &&
            ref !== pipeline.branch &&
            ref !== 'refs/heads/' + pipeline.branch) ||
        run.repository.id !== pipeline.repositoryId ||
        run.head_repository.id !== pipeline.repositoryId ||
        run.event !== 'workflow_dispatch' ||
        run.status !== 'completed' ||
        run.conclusion !== 'success'
    )
        throw new Error(
            'Candidate workflow attempt is not the approved successful run',
        )
    const { name, ...artifact } = parseRunArtifact(artifactData, run)
    if (
        !name.endsWith(`-${run.id}-${run.run_attempt}-bundle`) ||
        !isDeepStrictEqual(artifact, handoff.bundle)
    )
        throw new Error('Candidate artifact no longer matches the approval')
    return { ...artifact, expired: false }
}

async function downloadVerifiedZip(
    path: string,
    artifact: SubmissionArtifact,
    token: string,
) {
    const redirect = await githubRequest(
        candidateApiPath('artifacts/' + artifact.id + '/zip'),
        {
            token,
            redirect: 'manual',
        },
    )
    await redirect.body?.cancel()
    const location = redirect.headers.get('location')
    if (redirect.status !== 302 || !location)
        throw new Error('Candidate artifact download unavailable')
    const url = new URL(location)
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        !url.hostname.endsWith('.blob.core.windows.net')
    ) {
        throw new Error('Unexpected candidate artifact download origin')
    }
    const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new Error('Candidate artifact download failed')
    }
    const result = await verifyNativeArtifactStream(
        response.body,
        artifact,
        path,
    )
    if (result === 'length-exceeded')
        throw new Error('Candidate ZIP exceeds its approved length')
    if (result !== 'verified')
        throw new Error('Candidate ZIP differs from the approved artifact')
    return { id: artifact.id, sha256: artifact.sha256 }
}

export async function withCandidateBundle<T>(
    handoff: Handoff,
    token: string,
    runnerTemp: string,
    publish: (files: ReadonlyMap<string, string>) => Promise<T>,
) {
    const candidate = handoff.approval.candidate
    const artifact = await verifyBundleReceipt(handoff, token)
    const directory = await mkdtemp(
        join(await realpath(runnerTemp), 'app-catalog-'),
    )
    const zip = join(directory, 'candidate.zip')
    const extracted = join(directory, 'extracted')
    const assets = new Map<string, string>()
    const limits: Record<string, number> = {
        [candidateName]: metadataLimit,
        [reportName]: Math.min(
            metadataLimit,
            candidate.evidence.report.sizeBytes,
        ),
    }
    for (const pkg of candidate.release.packages) {
        const { archive, sbom, provenance } = assetNames(pkg.manifest)
        limits[archive] = Math.min(packageLimit, pkg.archive.sizeBytes)
        limits[sbom] = Math.min(evidenceLimit, pkg.sbom.sizeBytes)
        limits[provenance] = Math.min(metadataLimit, pkg.provenance.sizeBytes)
        for (const name of [archive, sbom, provenance])
            assets.set(name, join(extracted, name))
    }
    try {
        await mkdir(extracted, { mode: 0o700 })
        const downloadedArtifact = await downloadVerifiedZip(
            zip,
            artifact,
            token,
        )
        await extractCandidateZip(zip, extracted, limits)
        const sealed = await verifyCandidateHandoff(extracted, {
            source: candidate.source,
            build: candidate.build,
            artifact: {
                id: artifact.id,
                sha256: artifact.sha256,
                expiresAt: artifact.expiresAt,
                expired: artifact.expired,
            },
            downloadedArtifact,
            now: new Date(),
        })
        checkApprovalBinding(sealed, handoff.approval)
        return await publish(assets)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
