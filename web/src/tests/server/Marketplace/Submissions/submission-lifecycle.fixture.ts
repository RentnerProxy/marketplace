import { expect, vi } from 'bun:test'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { db } from '@/db'
import {
    auditLogs,
    marketplaceOfficialApps,
    marketplaceRepositoryClaims,
    marketplaceSubmissions,
    permissions,
    publicAccounts,
    staffAccounts,
    staffUserPermissions,
    users,
} from '@/db/schema.ts'
import type { SubmissionArtifact } from '@/lib/Marketplace/Types/submission.types.ts'
import { catalogPublisherWorkflow } from '@/lib/Marketplace/catalogPublication.ts'
import {
    decideCandidateService,
    invalidateSubmission,
    stopSubmissionService,
} from '@/server/Marketplace/Submissions/decision.service.ts'
import { InvalidCandidateError } from '@/server/Marketplace/Submissions/candidate-run.service.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import {
    changeOfficialAppService,
    listOfficialAppsService,
} from '@/server/Marketplace/Submissions/namespace.service.ts'
import {
    authorizeDraftCleanupService,
    authorizePublicationAttemptService,
    confirmCatalogRevocationService,
    deferCatalogPublicationWorkService,
    getApprovedPublicationService,
    getCatalogPublicationWorkService,
    listCatalogPublicationWorkService,
    listPendingPublicationsService,
    reconcileCatalogPublisherService,
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
    fixtureSubmission,
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

async function makeDue(id: string) {
    await db
        .update(marketplaceSubmissions)
        .set({ nextCheckAt: new Date(0) })
        .where(eq(marketplaceSubmissions.id, id))
}

export async function exerciseSubmissionLifecycle() {
    const owner = await user('public')
    const staff = await user('staff')
    const oldToken = process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN
    const token = 'fixture-actions-token'
    process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN = token
    let challenge: string | undefined
    const dispatches: Array<{ method: string | undefined; body: unknown }> = []
    const discoveryPages: number[] = []
    const fixturePermissionIds: string[] = []
    let proofRemoved = false
    let publisherRunStatus = 'in_progress'
    let fixture: Awaited<ReturnType<typeof fixtureCandidate>> | undefined
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
            const body: unknown = JSON.parse(String(init?.body))
            dispatches.push({ method: init?.method, body })
            if (dispatches.length === 1) {
                return new Response(null, {
                    status: 429,
                    headers: { 'retry-after': '120' },
                })
            }
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
        const publisherAttempt = /^runs\/(7777|8888)\/attempts\/1$/.exec(
            url.pathname.slice(actions.length),
        )
        if (publisherAttempt) {
            return Response.json({
                ...githubRun,
                id: Number(publisherAttempt[1]),
                path: catalogPublisherWorkflow,
                event: 'schedule',
                status: publisherRunStatus,
            })
        }
        const bundleArtifact = artifact(
            bundle,
            receipt.submissionId + '-' + run.id + '-1-bundle',
        )
        const evidenceArtifact = artifact(evidence, 'submission-1.json')

        if (
            url.pathname ===
            actions + 'workflows/' + pipeline.workflowId + '/runs'
        ) {
            const page = Number(url.searchParams.get('page'))
            discoveryPages.push(page)
            return Response.json({
                total_count: 101,
                workflow_runs:
                    page === 1
                        ? [
                              ...Array.from({ length: 99 }, () => ({
                                  display_title: 'Unrelated workflow',
                              })),
                              githubRun,
                          ]
                        : [githubRun],
            })
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
        const reviewerPermission = await grant(
            PERMISSIONS.ADMIN_MARKETPLACE_REVIEW,
        )
        await grant(PERMISSIONS.ADMIN_MARKETPLACE_NAMESPACE)
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
            reconcileNextSubmissionService(),
            reconcileNextSubmissionService(),
        ])
        const rateLimited = await readSubmission(first.id)
        expect(rateLimited).toMatchObject({
            status: 'validating',
            dispatchRequestedAt: null,
            buildRunId: null,
        })
        expect(rateLimited.history.at(-1)).toMatchObject({
            failure: 'dispatchRateLimited',
        })
        expect(rateLimited.nextCheckAt!.getTime()).toBeGreaterThan(
            Date.now() + 100_000,
        )
        await makeDue(first.id)
        await reconcileNextSubmissionService()
        const lost = await readSubmission(first.id)
        expect(lost).toMatchObject({ status: 'validating', buildRunId: null })
        fixture = await fixtureCandidate(lost, claim)
        expect(dispatches).toEqual(
            Array.from({ length: 2 }, () => ({
                method: 'POST',
                body: {
                    ref: 'main',
                    inputs: {
                        source_repository: claim.repository,
                        source_commit: request.commit,
                        source_path: request.path,
                        publisher_name: request.publisherName,
                        submission_id: lost.buildKey,
                    },
                },
            })),
        )
        await makeDue(first.id)
        await reconcileNextSubmissionService()
        const validated = await readSubmission(first.id)
        expect(discoveryPages).toEqual([1, 2])
        expect(dispatches).toHaveLength(2)
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
        await expect(
            decideCandidateService(input, staff, async () => {
                await db
                    .delete(staffUserPermissions)
                    .where(
                        and(
                            eq(staffUserPermissions.userId, staff),
                            eq(
                                staffUserPermissions.permissionId,
                                reviewerPermission,
                            ),
                        ),
                    )
            }),
        ).rejects.toBeInstanceOf(PermissionDeniedError)
        await db
            .insert(staffUserPermissions)
            .values({ userId: staff, permissionId: reviewerPermission })
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
        const firstPublisher = {
            ...candidate.build,
            workflowPath: catalogPublisherWorkflow,
            runId: '7777',
        }
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
        expect(await listCatalogPublicationWorkService()).toContainEqual({
            submissionId: first.id,
            approvalRevision: approval.revision,
            revision: approved.revision,
            kind: 'publish',
            run: null,
        })
        const failedPrefix = Array.from({ length: 20 }, (_, index) => {
            const queuedRequest = fixtureRequest(claim.id, `1.4.${index}`)
            return {
                ...fixtureSubmission(claim),
                id: queuedRequest.requestId,
                version: queuedRequest.version,
                request: queuedRequest,
                status: 'approved' as const,
                revision: approval.revision,
                approval: { ...approval, id: queuedRequest.requestId },
                createdAt: new Date(
                    approved.createdAt.getTime() - 20_000 + index,
                ),
                nextCheckAt: null,
            }
        })
        const prefixIds = failedPrefix.map(({ id }) => id)
        await db.insert(marketplaceSubmissions).values(failedPrefix)
        const blockedQueue = await listCatalogPublicationWorkService()
        expect(blockedQueue.map(({ submissionId }) => submissionId)).toEqual(
            prefixIds,
        )
        await Promise.all(
            blockedQueue.map((item) =>
                deferCatalogPublicationWorkService(item, firstPublisher),
            ),
        )
        expect(
            (await listCatalogPublicationWorkService()).map(
                ({ submissionId }) => submissionId,
            ),
        ).toContain(first.id)
        const firstBlocked = blockedQueue[0]
        if (!firstBlocked) throw new Error('Expected a deferred queue item')
        const deferredRow = await readSubmission(firstBlocked.submissionId)
        expect(deferredRow.publicationRetryAt?.getTime() ?? 0).toBeGreaterThan(
            Date.now(),
        )
        await db
            .delete(marketplaceSubmissions)
            .where(inArray(marketplaceSubmissions.id, prefixIds))
        expect(approved.history.map(({ status }) => status)).toEqual([
            'submitted',
            'validating',
            'validating',
            'validating',
            'awaitingReview',
            'approved',
        ])
        await db
            .update(marketplaceSubmissions)
            .set({
                nextCheckAt: new Date(Date.now() + 500_000),
            })
            .where(eq(marketplaceSubmissions.id, first.id))
        await invalidateSubmission(
            approved,
            new InvalidCandidateError('expiredEvidence'),
            approved.nextCheckAt,
        )
        expect((await readSubmission(first.id)).status).toBe('approved')

        const publication = {
            submissionId: approved.id,
            approvalRevision: approval.revision,
        }
        expect(
            (await getApprovedPublicationService(publication)).bundle,
        ).toEqual(fixture.bundle)
        const firstAttempt = {
            ...publication,
            run: firstPublisher,
        }
        const interrupted = {
            ...publication,
            run: { ...firstAttempt.run, runId: '8888' },
        }
        const promoted = {
            ...publication,
            run: { ...firstAttempt.run, runId: '9999' },
        }
        await expect(
            authorizePublicationAttemptService({
                ...publication,
                run: candidate.build,
            }),
        ).rejects.toThrow('submissionConflict')
        const authorized =
            await authorizePublicationAttemptService(firstAttempt)
        expect(await authorizePublicationAttemptService(firstAttempt)).toEqual(
            authorized,
        )
        expect(await listCatalogPublicationWorkService()).toContainEqual({
            ...publication,
            revision: authorized.revision,
            kind: 'recover',
            run: firstAttempt.run,
        })
        const observedApproval = { ...publication, revision: approved.revision }
        expect(authorized.revision).toBe(observedApproval.revision + 1)
        await expect(
            deferCatalogPublicationWorkService(
                observedApproval,
                interrupted.run,
            ),
        ).rejects.toThrow('submissionConflict')
        await expect(
            deferCatalogPublicationWorkService(observedApproval, {
                ...firstPublisher,
                attempt: firstPublisher.attempt + 1,
            }),
        ).rejects.toThrow('submissionConflict')
        await expect(
            deferCatalogPublicationWorkService(
                {
                    ...observedApproval,
                    revision: observedApproval.revision - 1,
                },
                firstPublisher,
            ),
        ).rejects.toThrow('submissionConflict')
        await expect(
            deferCatalogPublicationWorkService(
                observedApproval,
                firstPublisher,
            ),
        ).resolves.toBe('publishing')
        expect(
            (await listCatalogPublicationWorkService()).some(
                ({ submissionId }) => submissionId === first.id,
            ),
        ).toBe(false)
        const abortAttempt = {
            neverPromoted: true as const,
            previousRun: { runId: '7777', attempt: 1 },
        }
        await expect(
            reconcileCatalogPublisherService(
                publication,
                firstAttempt.run,
                abortAttempt,
            ),
        ).rejects.toThrow('submissionConflict')
        await expect(
            reconcileCatalogPublisherService(
                publication,
                promoted.run,
                abortAttempt,
            ),
        ).rejects.toThrow('submissionConflict')
        publisherRunStatus = 'completed'
        await expect(
            reconcileCatalogPublisherService(
                publication,
                promoted.run,
                abortAttempt,
            ),
        ).resolves.toBe('approved')
        await expect(
            reconcileCatalogPublisherService(
                publication,
                promoted.run,
                abortAttempt,
            ),
        ).resolves.toBe('approved')
        await expect(
            authorizePublicationAttemptService(firstAttempt),
        ).rejects.toThrow('submissionConflict')

        await authorizePublicationAttemptService(interrupted)
        const takeover = {
            ...promoted,
            previousRun: {
                runId: interrupted.run.runId,
                attempt: interrupted.run.attempt,
            },
        }
        publisherRunStatus = 'in_progress'
        await expect(
            authorizePublicationAttemptService(takeover),
        ).rejects.toThrow('submissionConflict')
        expect((await readSubmission(first.id)).publicationRun).toEqual(
            interrupted.run,
        )
        publisherRunStatus = 'completed'
        await expect(
            authorizePublicationAttemptService({
                ...takeover,
                previousRun: abortAttempt.previousRun,
            }),
        ).rejects.toThrow('submissionConflict')
        await authorizePublicationAttemptService(takeover)
        await authorizePublicationAttemptService(takeover)
        expect(await readSubmission(first.id)).toMatchObject({
            status: 'publishing',
            publicationRun: promoted.run,
        })
        await expect(
            authorizePublicationAttemptService({
                ...takeover,
                previousRun: abortAttempt.previousRun,
            }),
        ).rejects.toThrow('submissionConflict')
        await expect(
            reconcileCatalogPublisherService(publication, promoted.run, {
                neverPromoted: true,
                previousRun: takeover.previousRun,
            }),
        ).rejects.toThrow('submissionConflict')
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
            reconcileCatalogPublisherService(
                publication,
                promoted.run,
                receipt,
            ),
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
        expect(await listCatalogPublicationWorkService()).toContainEqual({
            ...publication,
            revision: published.revision + 1,
            kind: 'revoke',
            run: promoted.run,
        })
        const { revocation } =
            await getCatalogPublicationWorkService(publication)
        const stopEvent = (await readSubmission(first.id)).history.at(-1)
        if (!stopEvent || !revocation)
            throw new Error('Expected a revocation intent')
        expect(revocation).toEqual({
            appId: candidate.release.appId,
            version: candidate.release.version,
            reason: 'security',
            revokedAt: stopEvent.at,
        })
        await expect(
            confirmCatalogRevocationService(publication, 19, revocation),
        ).rejects.toThrow('submissionConflict')
        await expect(
            confirmCatalogRevocationService(publication, 20, revocation),
        ).resolves.toBe('revoked')
        await expect(
            confirmCatalogRevocationService(publication, 20, revocation),
        ).resolves.toBe('revoked')
        expect(
            (await getCatalogPublicationWorkService(publication)).revocation,
        ).toEqual(revocation)
        expect(
            (await listCatalogPublicationWorkService()).some(
                ({ submissionId }) => submissionId === first.id,
            ),
        ).toBe(false)
        expect(
            (await submissionDetailService(first.id, owner)).revocationPending,
        ).toBe(false)
        const audience = await submissionDetailService(first.id, owner)
        expect(
            audience.history.every(({ actorId }) => actorId === undefined),
        ).toBe(true)

        const stagedRequest = fixtureRequest(claim.id, '1.2.6')
        submissionsCreated.push(stagedRequest.requestId)
        const staged = {
            ...fixtureSubmission(claim),
            id: stagedRequest.requestId,
            version: stagedRequest.version,
            request: stagedRequest,
        }
        const stagedBundle = await fixtureCandidate(staged, claim)
        const stagedApproval = {
            ...approval,
            id: staged.id,
            candidate: stagedBundle.receipt.candidate,
        }
        const stagedIdentity = {
            submissionId: staged.id,
            approvalRevision: stagedApproval.revision,
        }
        const stagedRevision = stagedApproval.revision + 1
        await db.insert(marketplaceSubmissions).values({
            ...staged,
            status: 'publishing',
            revision: stagedRevision,
            validation: {
                candidate: stagedBundle.receipt.candidate,
                report: stagedBundle.receipt.report,
                bundle: stagedBundle.bundle,
                evidence: stagedBundle.evidence,
            },
            approval: stagedApproval,
            publicationRun: firstAttempt.run,
            nextCheckAt: null,
        })
        const deferred = { ...stagedIdentity, revision: stagedRevision }
        await expect(
            deferCatalogPublicationWorkService(deferred, firstPublisher),
        ).resolves.toBe('publishing')
        expect(
            (await listCatalogPublicationWorkService()).some(
                ({ submissionId }) => submissionId === staged.id,
            ),
        ).toBe(false)
        await stopSubmissionService(
            { id: staged.id, revision: stagedRevision, reason: 'Cancelled' },
            owner,
            'withdrawn',
        )
        const stopped = await getCatalogPublicationWorkService(stagedIdentity)
        if (!stopped.revocation)
            throw new Error('Expected a staged-release revocation')
        const stagedRevocation = stopped.revocation
        expect(stagedRevocation.reason).toBe('withdrawn')
        await expect(
            deferCatalogPublicationWorkService(deferred, firstPublisher),
        ).rejects.toThrow('submissionConflict')
        expect(
            (await submissionDetailService(staged.id, owner)).revocationPending,
        ).toBe(true)
        expect(await listCatalogPublicationWorkService()).toContainEqual({
            ...stagedIdentity,
            revision: stagedRevision + 1,
            kind: 'recover',
            run: firstAttempt.run,
        })
        await expect(
            confirmCatalogRevocationService(
                stagedIdentity,
                21,
                stagedRevocation,
            ),
        ).rejects.toThrow('submissionConflict')
        publisherRunStatus = 'in_progress'
        const cleanup = {
            ...stagedIdentity,
            previousRun: abortAttempt.previousRun,
        }
        await expect(authorizeDraftCleanupService(cleanup)).rejects.toThrow(
            'submissionConflict',
        )
        await expect(
            confirmCatalogRevocationService(
                stagedIdentity,
                21,
                stagedRevocation,
                abortAttempt.previousRun,
            ),
        ).rejects.toThrow('submissionConflict')
        publisherRunStatus = 'completed'
        await expect(
            authorizeDraftCleanupService({
                ...cleanup,
                previousRun: takeover.previousRun,
            }),
        ).rejects.toThrow('submissionConflict')
        await expect(authorizeDraftCleanupService(cleanup)).resolves.toBe(
            'withdrawn',
        )
        expect((await readSubmission(staged.id)).revision).toBe(
            stagedRevision + 1,
        )
        await expect(
            confirmCatalogRevocationService(
                stagedIdentity,
                21,
                stagedRevocation,
                abortAttempt.previousRun,
            ),
        ).resolves.toBe('revoked')
        await expect(
            confirmCatalogRevocationService(
                stagedIdentity,
                21,
                stagedRevocation,
                abortAttempt.previousRun,
            ),
        ).resolves.toBe('revoked')
        await expect(
            reconcileCatalogPublisherService(
                stagedIdentity,
                promoted.run,
                abortAttempt,
            ),
        ).rejects.toThrow('submissionConflict')
        expect(await readSubmission(staged.id)).toMatchObject({
            status: 'revoked',
            publication: null,
            publicationRun: firstAttempt.run,
        })
        await expect(authorizeDraftCleanupService(cleanup)).rejects.toThrow(
            'submissionConflict',
        )
        expect(
            (await submissionDetailService(staged.id, owner)).revocationPending,
        ).toBe(false)
        expect(
            (await listCatalogPublicationWorkService()).some(
                ({ submissionId }) => submissionId === staged.id,
            ),
        ).toBe(false)

        const laterRequest = fixtureRequest(claim.id, '1.2.4')
        submissionsCreated.push(laterRequest.requestId)
        const later = await submitCandidateService(laterRequest, owner)
        expect(await readSubmission(later.id)).toMatchObject({
            status: 'submitted',
            approval: null,
            publication: null,
        })
        proofRemoved = true
        await reconcileNextSubmissionService()
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
        await reconcileNextSubmissionService()
        expect(
            (await readSubmission(officialSubmission.id)).history.at(-1),
        ).toMatchObject({
            status: 'failed',
            failure: 'ownershipChanged',
        })
        repositoryIdentity = repository
        challenge = created.challenge
        const waitingRequest = fixtureRequest(claim.id, '1.3.0')
        submissionsCreated.push(waitingRequest.requestId)
        const waiting = await submitCandidateService(waitingRequest, owner)
        const otherIntents = Array.from(
            { length: RATE_LIMITS.marketplaceBuildBudget.limit },
            () => ({
                ...fixtureSubmission(claim),
                status: 'failed' as const,
                nextCheckAt: null,
            }),
        )
        await db.insert(marketplaceSubmissions).values(otherIntents)
        await reconcileNextSubmissionService()
        expect(await readSubmission(waiting.id)).toMatchObject({
            status: 'submitted',
            dispatchRequestedAt: null,
            buildRunId: null,
        })
        expect(dispatches).toHaveLength(2)
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
        await db
            .delete(permissions)
            .where(inArray(permissions.id, fixturePermissionIds))
    }

    async function grant(key: string) {
        const [created] = await db
            .insert(permissions)
            .values({ key, name: key, description: 'Submission test fixture.' })
            .onConflictDoNothing()
            .returning({ id: permissions.id })
        if (created) fixturePermissionIds.push(created.id)
        const [permission] = await db
            .select({ id: permissions.id })
            .from(permissions)
            .where(eq(permissions.key, key))
        await db
            .insert(staffUserPermissions)
            .values({ userId: staff, permissionId: permission.id })
        return permission.id
    }
}
