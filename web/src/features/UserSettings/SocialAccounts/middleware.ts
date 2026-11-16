import { createServerFn } from '@tanstack/react-start'
import { beginSocialLinkInputSchema } from './validation.ts'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'
import { reauthenticateCurrentUserService } from '@/server/Auth/reauthentication.service.ts'
import { beginSocialAuthorizationService } from '@/server/Auth/Social/flow.service.ts'
import { getCurrentUserSocialAccountsService, unlinkCurrentUserSocialAccountService } from '@/server/Auth/Social/management.service.ts'

export const getSocialAccountsHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    await requireAuthenticatedFeatureAccessService()
    return getCurrentUserSocialAccountsService()
})

export const beginSocialLinkHandler = createServerFn({ method: 'POST' })
    .validator((data: unknown) => beginSocialLinkInputSchema.parse(data))
    .handler(async function ({ data }) {
        await requireAuthenticatedFeatureAccessService()
        const reauthentication = await reauthenticateCurrentUserService(
            data.reauthentication,
        )
        if (!reauthentication.success) return reauthentication
        const authorization = await beginSocialAuthorizationService(
            data.provider,
            reauthentication.proof,
        )
        return { success: true as const, url: authorization.url }
    })

export const unlinkSocialAccountHandler = createServerFn({ method: 'POST' })
    .validator((data: unknown) => beginSocialLinkInputSchema.parse(data))
    .handler(async function ({ data }) {
        await requireAuthenticatedFeatureAccessService()
        return unlinkCurrentUserSocialAccountService(data)
    })
