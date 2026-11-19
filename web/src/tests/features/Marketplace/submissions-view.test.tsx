import { expect, test, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import DeveloperSubmissions from '@/features/Marketplace/DeveloperSubmissions.tsx'
import OfficialApps from '@/features/Marketplace/OfficialApps.tsx'
import { SubmissionQueue } from '@/features/Marketplace/Components/SubmissionQueue.tsx'
import type { SubmissionStatus } from '@/lib/Marketplace/Types/submission.types.ts'
import {
    candidateNamespace,
    repositoryChallenge,
} from '@/server/Marketplace/Submissions/ownership.service.ts'
import {
    fixtureCandidate,
    fixtureClaim,
    fixtureSubmission,
} from '@/tests/server/Marketplace/Submissions/submission.fixture.ts'

vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ language: 'en', t: (key: string) => key }),
}))

const claim = fixtureClaim()
const row = fixtureSubmission(claim)
const { receipt, evidence, bundle } = await fixtureCandidate(row, claim)
const { candidate, report } = receipt

function render(client: QueryClient, component: ReactNode) {
    return renderToStaticMarkup(
        <QueryClientProvider client={client}>{component}</QueryClientProvider>,
    )
}

function queueFixture(mode: 'review' | 'developer', status: SubmissionStatus) {
    const client = new QueryClient()
    const userId = mode === 'review' ? 'reviewer' : claim.submitterId
    const root = ['marketplace-submissions', userId, mode]
    client.setQueryData([...root, 'list', 0], {
        submissions: [
            { id: row.id, appId: row.appId, version: row.version, status },
        ],
        hasMore: true,
    })
    client.setQueryData([...root, 'detail', row.id], {
        id: row.id,
        repository: claim.repository,
        request: row.request,
        status,
        revision: 3,
        validation: { candidate, report, evidence, bundle },
        buildRunId: candidate.build.runId,
        history: [
            {
                revision: 1,
                status,
                at: '2026-01-01T12:00:00.000Z',
                actorId: mode === 'review' ? 'reviewer' : undefined,
                reason: 'Reviewed the exact commit',
                failure: status === 'revoked' ? 'ownershipChanged' : undefined,
            },
        ],
        publication: null,
        revocationPending: status === 'revoked',
    })
    return { client, userId }
}

test('lets a reviewer identify and decide on the exact candidate', () => {
    const { client, userId } = queueFixture('review', 'awaitingReview')
    const html = render(
        client,
        <SubmissionQueue mode="review" userId={userId} />,
    )
    expect(html).toContain(row.request.commit)
    expect(html).toContain(candidate.id)
    expect(html).toContain(candidate.evidence.report.sha256)
    expect(html).toContain('linux-amd64')
    expect(html).toContain('linux-arm64')
    expect(html).toContain('submissions.check.applianceSmoke')
    expect(html).toContain(candidate.release.packages[0].archive.sha256)
    expect(html).toContain('value="approve"')
    expect(html).toContain('value="reject"')
    expect(html).toContain('Reviewed the exact commit')
})

test('shows the ownership challenge, version fields and withdrawal for a developer', () => {
    const { client, userId } = queueFixture('developer', 'awaitingReview')
    client.setQueryData(['marketplace-claims', userId], {
        buildsEnabled: true,
        claims: [
            {
                id: claim.id,
                repository: claim.repository,
                namespace: candidateNamespace(
                    claim.ownerId,
                    claim.repositoryId,
                ),
                challenge: repositoryChallenge(claim.id),
                path: '.github/marketplace-publisher.txt',
                official: true,
            },
        ],
    })
    const html = render(client, <DeveloperSubmissions userId={userId} />)
    expect(html).toContain(repositoryChallenge(claim.id))
    expect(html).toContain('submissions.commit')
    expect(html).toContain('submissions.configSchema')
    expect(html).toContain('submissions.submit')
    expect(html).toContain('value="withdraw"')
    expect(html).not.toContain('value="approve"')
})

test('distinguishes approvals and signed revocations in the history', () => {
    const approved = queueFixture('review', 'approved')
    const approval = render(
        approved.client,
        <SubmissionQueue mode="review" userId={approved.userId} />,
    )
    expect(approval).toContain('submissions.approvedPending')
    expect(approval).toContain('value="revoke"')
    const revoked = queueFixture('review', 'revoked')
    const revocation = render(
        revoked.client,
        <SubmissionQueue mode="review" userId={revoked.userId} />,
    )
    expect(revocation).toContain('submissions.revocationPending')
    expect(revocation).toContain('submissions.failure.ownershipChanged')
    expect(revocation).not.toContain('value="approve"')
})

test('shows official app assignments and their own controls', () => {
    const client = new QueryClient()
    client.setQueryData(
        ['marketplace-official-apps', 'namespace-staff'],
        [
            { appId: 'rentnerproxy.fixture', claimId: claim.id, revision: 2 },
            { appId: 'rentnerproxy.former', claimId: null, revision: 2 },
        ],
    )
    const html = render(client, <OfficialApps userId="namespace-staff" />)
    expect(html).toContain('rentnerproxy.fixture')
    expect(html).toContain(claim.id)
    expect(html).toContain('submissions.noAssignment')
    expect(html).toContain('submissions.removeAssignment')
})
