import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { submitInput } from '@/features/Marketplace/validation.ts'
import {
    assembleCandidate,
    targetRecord,
    validationReport,
} from '@/lib/Marketplace/candidateEvidence.ts'
import { byteIdentity, jsonBytes } from '@/lib/Marketplace/evidenceIdentity.ts'
import type { marketplaceRepositoryClaims } from '@/db/schema.ts'
import { candidateNamespace } from '@/server/Marketplace/Submissions/ownership.service.ts'
import type { CandidateRun } from '@/server/Marketplace/Submissions/candidate-run.service.ts'
import type { Submission } from '@/server/Marketplace/Submissions/submission-store.service.ts'
import fixtures from '../../../../../../contracts/v1/fixtures.json'

export const repository = {
    id: 701,
    full_name: 'developer/native-app',
    private: false,
    owner: { id: 700 },
}
const buildId = '9001'

export function fixtureRequest(claimId: string, version = '1.2.3') {
    const manifest = fixtures.manifest
    return submitInput.parse({
        requestId: crypto.randomUUID(),
        claimId,
        commit: 'c'.repeat(40),
        path: 'modules/app',
        appId:
            candidateNamespace(
                String(repository.owner.id),
                String(repository.id),
            ) + '.monitoring',
        version,
        publisherName: 'Fixture publisher',
        display: manifest.display,
        configSchema: manifest.configSchema,
        targets: pipeline.targets,
    })
}

export function fixtureClaim(
    id = crypto.randomUUID(),
    submitterId = crypto.randomUUID(),
) {
    return {
        id,
        submitterId,
        repository: repository.full_name,
        repositoryId: String(repository.id),
        ownerId: String(repository.owner.id),
        createdAt: new Date(),
    }
}

export function fixtureSubmission(
    claim: typeof marketplaceRepositoryClaims.$inferSelect = fixtureClaim(),
): Submission {
    const request = fixtureRequest(claim.id)
    return {
        id: request.requestId,
        submitterId: claim.submitterId,
        claimId: claim.id,
        namespaceRevision: null,
        version: request.version,
        appId: request.appId,
        request,
        status: 'validating',
        revision: 2,
        history: [],
        buildKey: crypto.randomUUID(),
        buildRunId: null,
        nextCheckAt: new Date(),
        createdAt: new Date(),
        dispatchRequestedAt: new Date(),
        validation: null,
        approval: null,
        publication: null,
        publicationRun: null,
        publicationRetryAt: null,
    }
}

export async function fixtureCandidate(
    row: Submission,
    claim: typeof marketplaceRepositoryClaims.$inferSelect,
) {
    const request = row.request
    const run: CandidateRun = {
        id: buildId,
        workflow_id: pipeline.workflowId,
        run_attempt: 1,
        event: 'workflow_dispatch',
        display_title: 'Marketplace submission ' + row.buildKey,
        path: pipeline.workflow,
        head_branch: pipeline.branch,
        head_sha: 'b'.repeat(40),
        repository: { id: pipeline.repositoryId },
        head_repository: { id: pipeline.repositoryId },
        status: 'completed',
        conclusion: 'success',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }
    const source = { repositoryId: claim.repositoryId, commit: request.commit }
    const build = {
        repositoryId: pipeline.repositoryId,
        workflowCommit: run.head_sha,
        workflowPath: pipeline.builder,
        runId: run.id,
        attempt: run.run_attempt,
    }
    const targetRecords = pipeline.targets.map((target) =>
        targetRecord.parse({
            formatVersion: 1,
            build,
            purpose: 'candidate',
            applianceImage:
                'ghcr.io/rentnerproxy/marketplace@sha256:' + 'e'.repeat(64),
            checks: {
                package: 'passed',
                securityScan: 'passed',
                applianceSmoke: 'passed',
            },
            package: {
                manifest: {
                    ...fixtures.manifest,
                    id: request.appId,
                    version: request.version,
                    target,
                    source,
                    display: request.display,
                    configSchema: request.configSchema,
                },
                manifestSha256: 'a'.repeat(64),
                archive: { sha256: 'f'.repeat(64), sizeBytes: 444 },
                sbom: { sha256: 'a'.repeat(64), sizeBytes: 132 },
                provenance: { sha256: 'b'.repeat(64), sizeBytes: 121 },
            },
        }),
    )
    const report = validationReport.parse({
        formatVersion: 1,
        result: 'passed',
        targets: targetRecords,
    })
    const { sealed } = await assembleCandidate(
        report.targets,
        { source, build, purpose: 'candidate' },
        request.publisherName,
    )
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
    const bundle = {
        id: '8012',
        sha256: '9'.repeat(64),
        sizeBytes: 600,
        expiresAt,
    }
    const receipt = {
        submissionId: row.buildKey,
        sourcePath: row.request.path,
        bundleId: bundle.id,
        bundleSha256: bundle.sha256,
        candidate: sealed,
        report,
    }
    const contents = jsonBytes(receipt)
    const evidence = { id: '8013', ...byteIdentity(contents), expiresAt }
    return { run, bundle, receipt, evidence, contents }
}
