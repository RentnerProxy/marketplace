import { afterAll, beforeEach, expect, test, vi } from 'bun:test'
import {
    createServerFnStub,
    type Boundary,
} from '../Admin/UserManagement/management-middleware.test.helpers.ts'
import {
    fixtureClaim,
    fixtureRequest,
} from '@/tests/server/Marketplace/Submissions/submission.fixture.ts'

const previousOrigin = process.env.ORIGIN
const origin = 'https://marketplace.example.test'
const actor = 'test-account'
const claim = fixtureClaim()
const submission = fixtureRequest(claim.id)
const id = submission.requestId
const access = vi.fn(async (_action: string) => ({ userId: actor }))
const rateLimit = vi.fn(async (_input: object) => {})
const request = vi.fn<() => Request>()
const service = vi.fn(async (..._parameters: unknown[]) => ({ id }))
const decide = vi.fn(
    async (
        _input: unknown,
        _actor: string,
        checkActor: () => Promise<void>,
    ) => {
        await checkActor()
        return { id }
    },
)

vi.mock('@tanstack/react-start', () => ({ createServerFn: createServerFnStub }))
vi.mock('@tanstack/react-start/server', () => ({ getRequest: request }))
vi.mock('@/server/Marketplace/account-access.service.ts', () => ({
    requireMarketplaceAccountAccessService: access,
}))
vi.mock('@/server/Marketplace/Submissions/decision.service.ts', () => ({
    decideCandidateService: decide,
    stopSubmissionService: service,
}))
vi.mock('@/server/Marketplace/Submissions/namespace.service.ts', () => ({
    listOfficialAppsService: service,
    changeOfficialAppService: service,
}))
vi.mock('@/server/Marketplace/Submissions/submit.service.ts', () => ({
    createRepositoryClaimService: service,
    listRepositoryClaimsService: service,
    submitCandidateService: service,
}))
vi.mock('@/server/Marketplace/Submissions/submission-store.service.ts', () => ({
    listSubmissionsService: service,
    submissionDetailService: service,
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: rateLimit,
}))

const api = await import('@/features/Marketplace/middleware.ts')

beforeEach(() => {
    vi.clearAllMocks()
    process.env.ORIGIN = origin
    request.mockReturnValue(
        new Request(origin, {
            method: 'POST',
            headers: { origin, 'sec-fetch-site': 'same-origin' },
        }),
    )
})

afterAll(() => {
    if (previousOrigin === undefined) delete process.env.ORIGIN
    else process.env.ORIGIN = previousOrigin
})

function call(handler: object, data?: unknown) {
    return (handler as Boundary)({ data })
}

test('blocks cross-origin writes before any account lookup or action', async () => {
    request.mockReturnValue(
        new Request(origin, {
            method: 'POST',
            headers: {
                origin: 'https://another.example.test',
                'sec-fetch-site': 'cross-site',
            },
        }),
    )
    await expect(
        call(api.createSubmissionHandler, submission),
    ).rejects.toThrow()
    expect(access).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
    expect(service).not.toHaveBeenCalled()
})

test('scopes contributor reads and edits to the authenticated actor', async () => {
    await call(api.getRepositoryClaimsHandler)
    await call(api.requestRepositoryClaimHandler, {
        repository: claim.repository,
    })
    await call(api.createSubmissionHandler, submission)
    await call(api.getDeveloperSubmissionsHandler, { page: 0 })
    await call(api.getDeveloperSubmissionHandler, { id })
    await call(api.withdrawSubmissionHandler, {
        id,
        revision: 3,
        reason: 'Superseded',
    })

    expect(access.mock.calls.map(([action]) => action)).toEqual(
        Array(6).fill('submit'),
    )
    expect(service).toHaveBeenCalledWith(submission, actor)
    expect(service).toHaveBeenCalledWith(0, actor)
    expect(service).toHaveBeenCalledWith(id, actor)
    expect(service).toHaveBeenCalledWith(
        { id, revision: 3, reason: 'Superseded' },
        actor,
        'withdrawn',
    )
    expect(rateLimit.mock.calls.map(([options]) => options)).toContainEqual(
        expect.objectContaining({
            scope: 'marketplace-submit',
            identifiers: [actor],
            limit: 5,
        }),
    )
})

test('separates review and namespace access and rechecks the approving actor', async () => {
    const decision = {
        id,
        revision: 3,
        reason: 'Reviewed',
        candidateId: '1'.repeat(64),
        action: 'approve',
    }
    await call(api.getReviewSubmissionsHandler, { page: 0 })
    await call(api.getReviewSubmissionHandler, { id })
    await call(api.reviewSubmissionHandler, decision)
    await call(api.revokeSubmissionHandler, {
        id,
        revision: 4,
        reason: 'Security issue',
    })
    await call(api.getOfficialAppsHandler)
    await call(api.setOfficialAppHandler, {
        appId: 'rentnerproxy.fixture',
        claimId: claim.id,
        revision: 0,
    })
    expect(access.mock.calls.map(([action]) => action)).toEqual([
        'review',
        'review',
        'review',
        'review',
        'review',
        'assignNamespace',
        'assignNamespace',
    ])
    expect(decide).toHaveBeenCalledWith(decision, actor, expect.any(Function))
    access
        .mockResolvedValueOnce({ userId: actor })
        .mockResolvedValueOnce({ userId: 'changed' })
    await expect(call(api.reviewSubmissionHandler, decision)).rejects.toThrow(
        'submissionConflict',
    )
})
