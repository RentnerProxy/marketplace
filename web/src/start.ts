import { setResponseHeader } from '@tanstack/react-start/server'
import { isPasswordResetPath } from '@/lib/Auth/passwordResetPath.ts'
import { isFirstSuperUserSetupPath } from '@/features/Auth/FirstSuperUser/setupAccess.ts'
import { marketplaceRobotsDirectives } from '@/config/seo.config.ts'
import {
    addMarketplaceIndexingHeadersService,
    getMarketplaceRobotsDirectiveService,
} from '@/server/Seo/indexing.service.ts'
import {
    addPasswordResetPrivacyHeadersService,
    applyPasswordResetPrivacyHeadersService,
    getPasswordResetLegacyRedirectService,
} from '@/server/Auth/PasswordReset/privacy.service.ts'
import {
    createCsrfMiddleware,
    createMiddleware,
    createStart,
} from '@tanstack/react-start'
import {
    getRestoreRequestGateResponse,
    isRestoreGateBypassPath,
} from '@/server/Admin/Backups/restore-request-gate.service.ts'
import {
    RestoreInProgressError,
    StorageMutationBarrierUnavailableError,
} from '@/server/Storage/storage-mutation-barrier.service.ts'
import { installStorageMutationBarrierFatalExitHandlerService } from '@/server/Storage/storage-mutation-barrier-health.service.ts'
import { withSharedStorageMutationBarrierResponseService } from '@/server/Storage/storage-mutation-barrier-response.service.ts'

installStorageMutationBarrierFatalExitHandlerService()

const searchVisibilityMiddleware = createMiddleware({ type: 'request' }).server(
    async function ({ pathname, handlerType, next }) {
        setResponseHeader(
            'x-robots-tag',
            getMarketplaceRobotsDirectiveService(pathname, handlerType),
        )
        try {
            const result = await next()
            setResponseHeader(
                'x-robots-tag',
                getMarketplaceRobotsDirectiveService(
                    pathname,
                    handlerType,
                    result.response.status,
                ),
            )
            return {
                ...result,
                response: addMarketplaceIndexingHeadersService(
                    result.response,
                    pathname,
                    handlerType,
                ),
            }
        } catch (error) {
            setResponseHeader(
                'x-robots-tag',
                marketplaceRobotsDirectives.private,
            )
            if (error instanceof Response) {
                throw addMarketplaceIndexingHeadersService(
                    error,
                    pathname,
                    handlerType,
                )
            }
            throw error
        }
    },
)

const passwordResetPrivacyMiddleware = createMiddleware({
    type: 'request',
}).server(async function ({ request, pathname, handlerType, next }) {
    const legacyRedirect = getPasswordResetLegacyRedirectService(request)
    if (legacyRedirect) {
        return legacyRedirect
    }
    if (
        !isPasswordResetPath(pathname) &&
        !isFirstSuperUserSetupPath(pathname) &&
        handlerType !== 'serverFn'
    ) {
        return next()
    }

    applyPasswordResetPrivacyHeadersService({ set: setResponseHeader })

    try {
        const result = await next()
        return {
            ...result,
            response: addPasswordResetPrivacyHeadersService(result.response),
        }
    } catch (error) {
        if (error instanceof Response) {
            throw addPasswordResetPrivacyHeadersService(error)
        }
        throw error
    }
})

const restoreGateMiddleware = createMiddleware({ type: 'request' }).server(
    async function ({ request, pathname, next }) {
        if (isRestoreGateBypassPath(pathname)) {
            return next()
        }

        try {
            return await withSharedStorageMutationBarrierResponseService(next, {
                signal: request.signal,
            })
        } catch (error) {
            if (
                !(error instanceof RestoreInProgressError) &&
                !(error instanceof StorageMutationBarrierUnavailableError)
            ) {
                throw error
            }

            return (
                (await getRestoreRequestGateResponse(request, pathname)) ??
                new Response('Restore in progress', {
                    status: 503,
                    headers: {
                        'cache-control': 'no-store',
                        'retry-after': '3',
                    },
                })
            )
        }
    },
)

const serverFunctionCsrfMiddleware = createCsrfMiddleware({
    filter: (context) => context.handlerType === 'serverFn',
    origin: (origin, { request }) =>
        origin ===
        (process.env.ORIGIN?.trim() ||
            (import.meta.env.DEV ? new URL(request.url).origin : undefined)),
    secFetchSite: 'same-origin',
    allowRequestsWithoutOriginCheck: false,
})

export const startInstance = createStart(function () {
    return {
        requestMiddleware: [
            searchVisibilityMiddleware,
            passwordResetPrivacyMiddleware,
            restoreGateMiddleware,
            serverFunctionCsrfMiddleware,
        ],
    }
})
