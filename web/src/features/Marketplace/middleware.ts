import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { requireMarketplaceAccountAccessService } from '@/server/Marketplace/account-access.service.ts'
import {
    decideCandidateService,
    stopSubmissionService,
} from '@/server/Marketplace/Submissions/decision.service.ts'
import {
    changeOfficialAppService,
    listOfficialAppsService,
} from '@/server/Marketplace/Submissions/namespace.service.ts'
import {
    createRepositoryClaimService,
    listRepositoryClaimsService,
    submitCandidateService,
} from '@/server/Marketplace/Submissions/submit.service.ts'
import {
    listSubmissionsService,
    submissionDetailService,
} from '@/server/Marketplace/Submissions/submission-store.service.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { assertSameOriginRequest } from '@/server/Request/sameOrigin.service.ts'
import {
    claimInput,
    decisionInput,
    detailInput,
    listInput,
    officialAppInput,
    stopInput,
    submitInput,
} from './validation.ts'

async function mutationAccess(
    action: 'submit' | 'review' | 'assignNamespace',
    scope: string,
) {
    assertSameOriginRequest(getRequest())
    const actor = await requireMarketplaceAccountAccessService(action)
    await enforceRateLimit({
        ...(scope === 'submit'
            ? RATE_LIMITS.marketplaceSubmission
            : RATE_LIMITS.marketplaceMutation),
        scope: 'marketplace-' + scope,
        identifiers: [actor.userId],
        includeClientIp: false,
    })
    return actor.userId
}

export const getRepositoryClaimsHandler = createServerFn({
    method: 'GET',
}).handler(async () => {
    const { userId } = await requireMarketplaceAccountAccessService('submit')
    return listRepositoryClaimsService(userId)
})

export const requestRepositoryClaimHandler = createServerFn({ method: 'POST' })
    .validator((value: unknown) => claimInput.parse(value))
    .handler(async ({ data }) => {
        const actor = await mutationAccess('submit', 'claim')
        return createRepositoryClaimService(data.repository, actor)
    })

export const createSubmissionHandler = createServerFn({ method: 'POST' })
    .validator((value: unknown) => submitInput.parse(value))
    .handler(async ({ data }) => {
        const actor = await mutationAccess('submit', 'submit')
        return submitCandidateService(data, actor)
    })

export const getDeveloperSubmissionsHandler = createServerFn({ method: 'GET' })
    .validator((value: unknown) => listInput.parse(value))
    .handler(async ({ data }) => {
        const { userId } =
            await requireMarketplaceAccountAccessService('submit')
        return listSubmissionsService(data.page, userId)
    })

export const getDeveloperSubmissionHandler = createServerFn({ method: 'GET' })
    .validator((value: unknown) => detailInput.parse(value))
    .handler(async ({ data }) => {
        const { userId } =
            await requireMarketplaceAccountAccessService('submit')
        return submissionDetailService(data.id, userId)
    })

export const withdrawSubmissionHandler = createServerFn({ method: 'POST' })
    .validator((value: unknown) => stopInput.parse(value))
    .handler(async ({ data }) => {
        const actor = await mutationAccess('submit', 'withdraw')
        return stopSubmissionService(data, actor, 'withdrawn')
    })

export const getReviewSubmissionsHandler = createServerFn({ method: 'GET' })
    .validator((value: unknown) => listInput.parse(value))
    .handler(async ({ data }) => {
        await requireMarketplaceAccountAccessService('review')
        return listSubmissionsService(data.page)
    })

export const getReviewSubmissionHandler = createServerFn({ method: 'GET' })
    .validator((value: unknown) => detailInput.parse(value))
    .handler(async ({ data }) => {
        await requireMarketplaceAccountAccessService('review')
        return submissionDetailService(data.id)
    })

export const reviewSubmissionHandler = createServerFn({ method: 'POST' })
    .validator((value: unknown) => decisionInput.parse(value))
    .handler(async ({ data }) => {
        const actor = await mutationAccess('review', 'review')
        return decideCandidateService(data, actor, async () => {
            const current =
                await requireMarketplaceAccountAccessService('review')
            if (current.userId !== actor) throw new Error('submissionConflict')
        })
    })

export const revokeSubmissionHandler = createServerFn({ method: 'POST' })
    .validator((value: unknown) => stopInput.parse(value))
    .handler(async ({ data }) => {
        const actor = await mutationAccess('review', 'revoke')
        return stopSubmissionService(data, actor, 'revoked')
    })

export const getOfficialAppsHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        await requireMarketplaceAccountAccessService('assignNamespace')
        return listOfficialAppsService()
    },
)

export const setOfficialAppHandler = createServerFn({ method: 'POST' })
    .validator((value: unknown) => officialAppInput.parse(value))
    .handler(async ({ data }) => {
        const actor = await mutationAccess('assignNamespace', 'namespace')
        return changeOfficialAppService(data, actor)
    })
