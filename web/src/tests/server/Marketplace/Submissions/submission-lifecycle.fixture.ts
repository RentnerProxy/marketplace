import { expect, vi } from 'bun:test'
import { eq, inArray, or, sql } from 'drizzle-orm'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { db } from '@/db'
import {
    auditLogs,
    marketplaceOfficialApps,
    marketplaceRepositoryClaims,
    marketplaceSubmissions,
    publicAccounts,
    staffAccounts,
    users,
} from '@/db/schema.ts'
import type { SubmissionArtifact } from '@/lib/Marketplace/Types/submission.types.ts'
import {
    decideCandidateService,
    stopSubmissionService,
} from '@/server/Marketplace/Submissions/decision.service.ts'
import {
    changeOfficialAppService,
    listOfficialAppsService,
} from '@/server/Marketplace/Submissions/namespace.service.ts'
import {
    authorizePublicationAttemptService,
    getApprovedPublicationService,
    listPendingPublicationsService,
    reconcilePublicationService,
} from '@/server/Marketplace/Submissions/publication.service.ts'
import {
    createRepositoryClaimService,
    listRepositoryClaimsService,
    submitCandidateService,
} from '@/server/Marketplace/Submissions/submit.service.ts'
import {
    readClaim,
    readSubmission,
    listSubmissionsService,
    submissionDetailService,
} from '@/server/Marketplace/Submissions/submission-store.service.ts'
import { reconcileNextSubmissionService } from '@/server/Marketplace/Submissions/validation.worker.ts'
import {
    fixtureCandidate,
    fixtureRequest,
    repository,
} from './submission.fixture.ts'

vi.mock('@/server/Realtime/publish.service.ts', () => ({
    publishAuditLogCreatedService: vi.fn(async () => {}),
}))

async function user(accountType: 'public' | 'staff') {
    const suffix = crypto.randomUUID()
    const [row] = await db
        .insert(users)
        .values({
            accountType,
            username: 'submissions-' + suffix,
            email: suffix + '@example.test',
            passwordHash: 'fixture',
            emailVerifiedAt: new Date(),
            isActive: true,
        })
        .returning({ id: users.id })
    await db
        .insert(accountType === 'staff' ? staffAccounts : publicAccounts)
        .values({ userId: row.id })
    return row.id
}

export async function exerciseSubmissionLifecycle() {
    const owner = await user('public')
    const staff = await user('staff')
    const oldToken = process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN
    const token = 'fixture-actions-token'
    process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN = token
    let challenge: string | undefined
    let dispatches = 0
    let proofRemoved = false
    let fixture: ReturnType<typeof fixtureCandidate> | undefined
    let repositoryIdentity = repository
    const officialAppId = 'rentnerproxy.fixture-' + crypto.randomUUID()
    const submissionsCreated: string[] = []

    const mockGitHub = async (
        input: Parameters<typeof fetch>[0],
        init: Parameters<typeof fetch>[1],
    ) => {
        const url = new URL(String(input))
        if (
            url.hostname === 'submission-fixture.blob.core.windows.net' &&
            fixture
        ) {
            expect(new Headers(init?.headers).has('authorization')).toBe(false)
            return new Response(fixture.contents)
        }
        expect(url.hostname).toBe('api.github.com')
        const source = '/repos/' + repositoryIdentity.full_name
        if (url.pathname.startsWith(source)) {
            expect(new Headers(init?.headers).get('authorization')).toBe(
                'Bearer ' + token,
            )
            if (url.pathname === source)
                return Response.json(repositoryIdentity)
            if (url.pathname === source + '/contents/' + pipeline.proofPath) {
                expect(url.search).toBe('')
                if (proofRemoved) return new Response(null, { status: 404 })
                return Response.json({
                    type: 'file',
                    encoding: 'base64',
                    content: Buffer.from(challenge ?? '').toString('base64'),
                })
            }
            if (url.pathname.startsWith(source + '/git/commits/')) {
                return Response.json({
                    sha: url.pathname.split('/').at(-1),
                })
            }
        }
        expect(new Headers(init?.headers).get('authorization')).toBe(
            'Bearer ' + token,
        )
        const actions = '/repos/' + pipeline.repository + '/actions/'
        if (
            url.pathname ===
            actions + 'workflows/' + pipeline.workflowId + '/dispatches'
        ) {
            dispatches++
            expect(init?.method).toBe('POST')
            throw new Error('Synthetic lost dispatch response')
        }
        if (!fixture) throw new Error('Candidate fixture has not been set')
        const { run, evidence, bundle, receipt } = fixture
        const githubRun = {
            ...run,
            id: Number(run.id),
            workflow_id: Number(run.workflow_id),
            repository: { id: Number(run.repository.id) },
            head_repository: { id: Number(run.head_repository.id) },
        }
        const runPath = actions + 'runs/' + run.id
        const bundleArtifact = artifact(
            bundle,
            receipt.submissionId + '-' + run.id + '-1-bundle',
        )
        const evidenceArtifact = artifact(evidence, 'submission-1.json')

        if (
            url.pathname ===
            actions + 'workflows/' + pipeline.workflowId + '/runs'
        ) {
            return Response.json({ workflow_runs: [githubRun] })
        }
        if (url.pathname === runPath) return Response.json(githubRun)
        if (url.pathname === runPath + '/artifacts') {
            return Response.json({
                artifacts: [bundleArtifact, evidenceArtifact],
            })
        }
        if (url.pathname === actions + 'artifacts/' + bundle.id)
            return Response.json(bundleArtifact)
        if (url.pathname === actions + 'artifacts/' + evidence.id)
            return Response.json(evidenceArtifact)
        if (url.pathname === actions + 'artifacts/' + evidence.id + '/zip') {
            return Response.redirect(
                'https://submission-fixture.blob.core.windows.net/receipt',
                302,
            )
        }
        throw new Error('Unexpected GitHub request')

        function artifact(value: SubmissionArtifact, name: string) {
            return {
                id: Number(value.id),
                name,
                size_in_bytes: value.sizeBytes,
                digest: 'sha256:' + value.sha256,
                expired: false,
                expires_at: value.expiresAt,
                workflow_run: {
                    id: Number(run.id),
                    repository_id: Number(pipeline.repositoryId),
                    head_repository_id: Number(pipeline.repositoryId),
                    head_branch: pipeline.branch,
                    head_sha: run.head_sha,
                },
            }
        }
    }
    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
            Object.assign(mockGitHub, { preconnect: fetch.preconnect }),
        )
    try {
        const created = await createRepositoryClaimService(
            repository.full_name,
            owner,
        )
        expect(
            await createRepositoryClaimService(repository.full_name, owner),
        ).toEqual(created)
        expect(await listRepositoryClaimsService(owner)).toEqual({
            claims: [created],
            buildsEnabled: true,
        })
        const claim = await readClaim(created.id, owner)
        const request = fixtureRequest(claim.id)
        submissionsCreated.push(request.requestId)
        await expect(submitCandidateService(request, staff)).rejects.toThrow(
            'submissionConflict',
        )
        await expect(submitCandidateService(request, owner)).rejects.toThrow(
            'ownershipChanged',
        )
        challenge = created.challenge
        await expect(
            submitCandidateService(
                { ...request, appId: 'rentnerproxy.monitoring' },
                owner,
            ),
        ).rejects.toThrow('ownershipChanged')
        const [first, duplicate] = await Promise.all([
            submitCandidateService(request, owner),
            submitCandidateService(request, owner),
        ])
        expect(first).toEqual(duplicate)
        expect(
            (await listSubmissionsService(0, owner)).submissions.map(
                ({ id }) => id,
            ),
        ).toEqual([first.id])
        expect((await listSubmissionsService(0, staff)).submissions).toEqual([])
        await expect(
            submitCandidateService(
                { ...request, requestId: crypto.randomUUID() },
                owner,
            ),
        ).rejects.toThrow('submissionConflict')
        await expect(submissionDetailService(first.id, staff)).rejects.toThrow(
            'submissionConflict',
        )
        await Promise.all([
            reconcileNextSubmissionService(token),
            reconcileNextSubmissionService(token),
        ])
        const lost = await readSubmission(first.id)
        expect(lost).toMatchObject({ status: 'validating', buildRunId: null })
        fixture = fixtureCandidate(lost, claim)

        await db
            .update(marketplaceSubmissions)
            .set({ nextCheckAt: new Date(0) })
            .where(eq(marketplaceSubmissions.id, first.id))
        await reconcileNextSubmissionService(token)
        const validated = await readSubmission(first.id)
        expect(dispatches).toBe(1)
        expect(validated.status).toBe('awaitingReview')
        const candidate = fixture.receipt.candidate
        expect(validated.validation?.candidate).toEqual(candidate)
        const input = {
            id: first.id,
            revision: validated.revision,
            candidateId: candidate.id,
            action: 'approve' as const,
            reason: 'Reviewed both package digests and requested capabilities.',
        }
        await expect(
            decideCandidateService(
                { ...input, candidateId: '0'.repeat(64) },
                staff,
                async () => {},
            ),
        ).rejects.toThrow('submissionConflict')
        const decisions = await Promise.allSettled([
            decideCandidateService(input, staff, async () => {}),
            decideCandidateService(
                { ...input, reason: 'Concurrent review.' },
                staff,
                async () => {},
            ),
        ])
        expect(
            decisions.filter(({ status }) => status === 'fulfilled'),
        ).toHaveLength(1)
        const approved = await readSubmission(first.id)
        const approval = approved.approval
        if (!approval) throw new Error('Expected an approval')
        expect(approval.actorId).toBe(staff)
        expect(approval.candidate).toEqual(candidate)
        expect(approved.publication).toBeNull()
        const decisionReason = approved.history.at(-1)?.reason
        if (!decisionReason) throw new Error('Expected a review reason')
        await expect(
            decideCandidateService(
                { ...input, reason: decisionReason },
                staff,
                async () => {},
            ),
        ).resolves.toEqual({ id: first.id })
        expect(await listPendingPublicationsService()).toContainEqual({
            submissionId: first.id,
            approvalRevision: approval.revision,
        })
        expect(approved.history.map(({ status }) => status)).toEqual([
            'submitted',
            'validating',
            'awaitingReview',
            'approved',
        ])

        const publication = {
            submissionId: approved.id,
            approvalRevision: approval.revision,
        }
        expect(
            (await getApprovedPublicationService(publication)).bundle,
        ).toEqual(fixture.bundle)
        const firstAttempt = {
            ...publication,
            run: { ...candidate.build, runId: '7777' },
        }
        await authorizePublicationAttemptService(firstAttempt)
        await expect(
            reconcilePublicationService(firstAttempt, { neverPromoted: true }),
        ).resolves.toBe('approved')
        await expect(
            reconcilePublicationService(firstAttempt, { neverPromoted: true }),
        ).resolves.toBe('approved')
        await expect(
            authorizePublicationAttemptService(firstAttempt),
        ).rejects.toThrow('submissionConflict')

        const promoted = {
            ...publication,
            run: { ...firstAttempt.run, runId: '8888' },
        }
        await authorizePublicationAttemptService(promoted)
        const receipt = {
            formatVersion: 1 as const,
            id: approved.id,
            approvalId: approval.id,
            approvalRevision: approval.revision,
            publishedAt: new Date().toISOString(),
            catalogRevision: 19,
            run: promoted.run,
            release: candidate.release,
        }
        const signedCatalog = {
            formatVersion: 1 as const,
            revision: 19,
            releases: [receipt.release],
            revocations: [],
        }
        await expect(
            reconcilePublicationService(firstAttempt, {
                receipt,
                signedCatalog,
            }),
        ).rejects.toThrow('submissionConflict')
        await expect(
            reconcilePublicationService(promoted, {
                receipt,
                signedCatalog: { ...signedCatalog, revision: 20 },
            }),
        ).rejects.toThrow()
        await expect(
            reconcilePublicationService(promoted, { receipt, signedCatalog }),
        ).resolves.toBe('published')
        await expect(
            reconcilePublicationService(promoted, { receipt, signedCatalog }),
        ).resolves.toBe('published')
        const published = await readSubmission(first.id)
        await stopSubmissionService(
            {
                id: first.id,
                revision: published.revision,
                reason: 'Security issue',
            },
            staff,
            'revoked',
        )
        expect(await submissionDetailService(first.id, owner)).toMatchObject({
            status: 'revoked',
            revocationPending: true,
            publication: receipt,
        })
        const audience = await submissionDetailService(first.id, owner)
        expect(
            audience.history.every(({ actorId }) => actorId === undefined),
        ).toBe(true)

        const laterRequest = fixtureRequest(claim.id, '1.2.4')
        submissionsCreated.push(laterRequest.requestId)
        const later = await submitCandidateService(laterRequest, owner)
        expect(await readSubmission(later.id)).toMatchObject({
            status: 'submitted',
            approval: null,
            publication: null,
        })
        proofRemoved = true
        await reconcileNextSubmissionService(token)
        expect((await readSubmission(later.id)).history.at(-1)).toMatchObject({
            status: 'failed',
            failure: 'ownershipChanged',
        })

        proofRemoved = false
        const withdrawnRequest = fixtureRequest(claim.id, '1.2.5')
        submissionsCreated.push(withdrawnRequest.requestId)
        const submittedForWithdrawal = await submitCandidateService(
            withdrawnRequest,
            owner,
        )
        await stopSubmissionService(
            {
                id: submittedForWithdrawal.id,
                revision: 1,
                reason: 'Superseded',
            },
            owner,
            'withdrawn',
        )
        expect(await readSubmission(submittedForWithdrawal.id)).toMatchObject({
            status: 'withdrawn',
            nextCheckAt: null,
        })

        repositoryIdentity = {
            ...repository,
            full_name: 'RentnerProxy/submission-fixture',
            owner: { id: Number(pipeline.officialOwnerId) },
        }
        const official = await createRepositoryClaimService(
            repositoryIdentity.full_name,
            owner,
        )
        challenge = official.challenge
        const officialRequest = {
            ...fixtureRequest(official.id),
            appId: officialAppId,
        }
        submissionsCreated.push(officialRequest.requestId)
        await expect(
            submitCandidateService(officialRequest, owner),
        ).rejects.toThrow('ownershipChanged')
        const assign = {
            appId: officialAppId,
            claimId: official.id,
            revision: 0,
        }
        const assignment = await changeOfficialAppService(assign, staff)
        expect(await changeOfficialAppService(assign, staff)).toEqual(
            assignment,
        )
        expect(await listOfficialAppsService()).toContainEqual(assignment)
        const officialSubmission = await submitCandidateService(
            officialRequest,
            owner,
        )
        await expect(
            changeOfficialAppService({ ...assign, claimId: null }, staff),
        ).rejects.toThrow('submissionConflict')
        await changeOfficialAppService(
            { ...assign, claimId: null, revision: assignment.revision },
            staff,
        )
        await reconcileNextSubmissionService(token)
        expect(
            (await readSubmission(officialSubmission.id)).history.at(-1),
        ).toMatchObject({
            status: 'failed',
            failure: 'ownershipChanged',
        })
        expect(dispatches).toBe(1)
    } finally {
        fetchMock.mockRestore()
        if (oldToken === undefined)
            delete process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN
        else process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN = oldToken
        await db
            .delete(marketplaceSubmissions)
            .where(eq(marketplaceSubmissions.submitterId, owner))
        await db
            .delete(marketplaceOfficialApps)
            .where(eq(marketplaceOfficialApps.appId, officialAppId))
        await db
            .delete(marketplaceRepositoryClaims)
            .where(eq(marketplaceRepositoryClaims.submitterId, owner))
        await db
            .delete(auditLogs)
            .where(
                or(
                    inArray(auditLogs.actorUserId, [owner, staff]),
                    inArray(
                        sql<string>`${auditLogs.newValues}->>'submissionId'`,
                        submissionsCreated,
                    ),
                ),
            )
        await db.delete(users).where(inArray(users.id, [owner, staff]))
    }
}
