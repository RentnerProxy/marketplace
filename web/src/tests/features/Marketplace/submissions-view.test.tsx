import { expect, test, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import DeveloperSubmissions from '@/features/Marketplace/DeveloperSubmissions.tsx'
import OfficialApps from '@/features/Marketplace/OfficialApps.tsx'
import { SubmissionQueue } from '@/features/Marketplace/Components/SubmissionQueue/index.tsx'
import { SubmissionDetails } from '@/features/Marketplace/Components/SubmissionQueue/Components/SubmissionDetails.tsx'
import type { SubmissionMode } from '@/features/Marketplace/Types/components.types.ts'
import type { RowDetailsDialogProps } from '@/shared/Table/Types/row-details-dialog.types.ts'
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

vi.mock('@/shared/Table/RowDetailsDialog.tsx', () => ({
    default: ({ title, children, footer }: RowDetailsDialogProps) => (
        <dialog aria-label={title}>
            {children}
            {footer && <footer>{footer}</footer>}
        </dialog>
    ),
}))

const claim = fixtureClaim()
const row = fixtureSubmission(claim)
const { receipt, evidence, bundle } = fixtureCandidate(row, claim)
const { candidate, report } = receipt

function render(client: QueryClient, component: ReactNode) {
    return renderToStaticMarkup(
        <QueryClientProvider client={client}>{component}</QueryClientProvider>,
    )
}

function queueFixture(mode: SubmissionMode, status: SubmissionStatus) {
    const client = new QueryClient()
    const userId = mode === 'review' ? 'reviewer' : claim.submitterId
    const root = ['marketplace-submissions', userId, mode]
    const submission = {
        id: row.id,
        appId: row.appId,
        version: row.version,
        status,
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
    }
    client.setQueryData([...root, 'list', 0], {
        submissions: [submission],
        hasMore: true,
    })
    const detail = {
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
    }
    return { client, userId, mode, submission, root, detail }
}

function renderDetails(fixture: ReturnType<typeof queueFixture>) {
    const { client, userId, mode, submission, root, detail } = fixture
    client.setQueryData([...root, 'detail', row.id], detail)
    return render(
        client,
        <SubmissionDetails
            mode={mode}
            userId={userId}
            submission={submission}
            onClose={() => {}}
        />,
    )
}

test('shows the row actions and server page controls without starting a detail query', () => {
    for (const mode of ['review', 'developer'] as const) {
        const { client, root, userId } = queueFixture(mode, 'awaitingReview')
        const html = render(
            client,
            <SubmissionQueue mode={mode} userId={userId} />,
        )

        expect(html).toContain('<table')
        expect(html).toContain('submissions.status.awaitingReview')
        expect(html).toContain('2026-01-01')
        expect(html).toContain('common.actions')
        expect(html).toContain(
            `common.openActions (${row.appId} ${row.version})`,
        )
        expect(html).toContain('disabled="">submissions.previous')
        expect(html).toContain('>submissions.next')
        expect(html).not.toContain('disabled="">submissions.next')
        expect(html).not.toContain('<dialog')
        expect(
            client.getQueryState([...root, 'detail', row.id]),
        ).toBeUndefined()
    }
})

test('lets a reviewer identify and decide on the exact candidate in the dialog', () => {
    const html = renderDetails(queueFixture('review', 'awaitingReview'))
    expect(html).toContain('<dialog')
    expect(html).toContain(`${row.appId} ${row.version}`)
    expect(html).toContain(row.request.commit)
    expect(html).toContain(candidate.id)
    expect(html).toContain(candidate.evidence.report.sha256)
    expect(html).toContain('linux-amd64')
    expect(html).toContain('linux-arm64')
    expect(html).toContain('submissions.check.applianceSmoke')
    expect(html).toContain(candidate.release.packages[0].archive.sha256)
    expect(html).toContain('value="approve"')
    expect(html).toContain('value="reject"')
    const formId = /<form id="([^"]+)"/.exec(html)?.[1]
    if (!formId) throw new Error('Missing reason form')
    const footer = html.match(/<footer>.*?<\/footer>/s)?.[0]
    expect(footer).toContain(`form="${formId}" value="approve"`)
    expect(footer).toContain(`form="${formId}" value="reject"`)
    expect(html).toContain('Reviewed the exact commit')
})

test('shows the ownership challenge, version fields and withdrawal for a developer', () => {
    const fixture = queueFixture('developer', 'awaitingReview')
    const { client, userId } = fixture
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
    expect(html).not.toContain('value="withdraw"')
    const details = renderDetails(fixture)
    expect(details).toContain('value="withdraw"')
    expect(details).not.toContain('value="approve"')
})

test('distinguishes approvals and signed revocations in the history', () => {
    const approval = renderDetails(queueFixture('review', 'approved'))
    expect(approval).toContain('submissions.approvedPending')
    expect(approval).toContain('value="revoke"')
    const revocation = renderDetails(queueFixture('review', 'revoked'))
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
