import { expect, test } from 'bun:test'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { submitInput } from '@/features/Marketplace/validation.ts'
import {
    assertSubmissionRun,
    parseRunArtifact,
} from '@/server/Marketplace/Submissions/candidate-run.service.ts'
import { verifySubmissionReceipt } from '@/server/Marketplace/Submissions/candidate-review.service.ts'
import { candidateNamespace } from '@/server/Marketplace/Submissions/ownership.service.ts'
import { appId } from '../../../../../../contracts/v1/primitives.ts'
import {
    fixtureCandidate,
    fixtureClaim,
    fixtureSubmission,
} from './submission.fixture.ts'

test('accepts full commits and both native targets with verified manifest metadata', () => {
    const submission = fixtureSubmission()
    const input = submission.request
    expect(submitInput.safeParse(input).success).toBe(true)
    for (const invalid of [
        { commit: 'main' },
        { targets: ['linux-amd64'] },
        { path: 'app/../other' },
        { configSchema: 'https://example.test/config.json' },
    ]) {
        expect(submitInput.safeParse({ ...input, ...invalid }).success).toBe(
            false,
        )
    }
})

test('derives a stable namespace from both the GitHub owner and repository IDs', () => {
    const largeId = '18446744073709551615'
    expect(
        appId.safeParse(candidateNamespace(largeId, largeId) + '.app').success,
    ).toBe(true)
    expect(candidateNamespace('123', '456')).not.toBe(
        candidateNamespace('123', '457'),
    )
    expect(candidateNamespace('123', '456')).not.toBe(
        candidateNamespace('124', '456'),
    )
})

test('rejects substituted workflow runs, reruns and mismatched correlation', async () => {
    const claim = fixtureClaim()
    const submission = fixtureSubmission(claim)
    const { run } = await fixtureCandidate(submission, claim)
    expect(() => assertSubmissionRun(run, submission)).not.toThrow()
    for (const spoof of [
        { workflow_id: '9999' },
        { path: '.github/workflows/other.yml' },
        { path: pipeline.workflow + '@feature' },
        { run_attempt: 2 },
        { event: 'pull_request' },
        { head_repository: { id: claim.repositoryId } },
        { display_title: 'Marketplace submission ' + submission.id },
    ]) {
        expect(() =>
            assertSubmissionRun({ ...run, ...spoof }, submission),
        ).toThrow('invalidEvidence')
    }
})

test('rejects wrong-owner and expired Actions artifacts before review', async () => {
    const claim = fixtureClaim()
    const submission = fixtureSubmission(claim)
    const { run, bundle } = await fixtureCandidate(submission, claim)
    const artifact = {
        id: Number(bundle.id),
        name: 'fixture',
        size_in_bytes: bundle.sizeBytes,
        digest: 'sha256:' + bundle.sha256,
        expires_at: bundle.expiresAt,
        expired: false,
        workflow_run: {
            id: Number(run.id),
            repository_id: Number(pipeline.repositoryId),
            head_repository_id: Number(pipeline.repositoryId),
            head_branch: pipeline.branch,
            head_sha: run.head_sha,
        },
    }
    expect(parseRunArtifact(artifact, run).sha256).toBe(bundle.sha256)
    expect(() => parseRunArtifact({ ...artifact, expired: true }, run)).toThrow(
        'expiredEvidence',
    )
    expect(() =>
        parseRunArtifact(
            {
                ...artifact,
                workflow_run: { ...artifact.workflow_run, id: 1 },
            },
            run,
        ),
    ).toThrow('invalidEvidence')
})

test('binds the review receipt to exact bytes, source, evidence, permissions and build outcome', async () => {
    const claim = fixtureClaim()
    const submission = fixtureSubmission(claim)
    const { run, bundle, receipt, evidence } = await fixtureCandidate(
        submission,
        claim,
    )
    const verify = (value: unknown, build = run) =>
        verifySubmissionReceipt(
            value,
            submission,
            claim,
            build,
            bundle,
            evidence,
        )
    expect((await verify(receipt)).candidate).toEqual(receipt.candidate)
    const tampered = structuredClone(receipt)
    tampered.report.targets[0].package.manifest.permissions.push(
        'new-permission',
    )
    await expect(verify(tampered)).rejects.toThrow('invalidEvidence')
    const leaking = structuredClone(receipt)
    Object.assign(leaking.report.targets[0].checks, {
        rawLog: 'arbitrary text',
    })
    await expect(verify(leaking)).rejects.toThrow('invalidEvidence')

    const changedReceipts = [
        { bundleSha256: '0'.repeat(64) },
        { sourcePath: 'another-app' },
        { submissionId: submission.id },
        {
            candidate: {
                ...receipt.candidate,
                evidence: { ...receipt.candidate.evidence, revision: 2 },
            },
        },
        {
            candidate: {
                ...receipt.candidate,
                source: { ...receipt.candidate.source, commit: '2'.repeat(40) },
            },
        },
    ]
    await Promise.all(
        changedReceipts.map((change) =>
            expect(verify({ ...receipt, ...change })).rejects.toThrow(
                'invalidEvidence',
            ),
        ),
    )
    await expect(
        verify(receipt, { ...run, conclusion: 'failure' }),
    ).rejects.toThrow('invalidEvidence')
})
