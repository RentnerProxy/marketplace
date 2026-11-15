import {
    createServerEntry,
    createStartHandler,
    handleStartError,
    defaultStreamHandler,
} from '@tanstack/react-start/server'
import type { ServerEntry } from '@tanstack/react-start/server-entry'
import { isPasswordResetPath } from '@/lib/Auth/passwordResetPath.ts'
import {
    addPasswordResetPrivacyHeadersService,
    getPasswordResetLegacyRedirectService,
} from '@/server/Auth/PasswordReset/privacy.service.ts'
import { resolveRealtimeWebSocketOriginService } from '@/server/Runtime/realtime-environment.service.ts'
import { withRequestCspContextService } from '@/server/Security/csp.service.ts'
import { addCspResponseHeadersService } from '@/server/Security/csp-response.service.ts'

let startHandler: ServerEntry['fetch'] | undefined

export default createServerEntry({
    async fetch(request, options) {
        const legacyRedirect = getPasswordResetLegacyRedirectService(request)
        if (legacyRedirect) {
            return addCspResponseHeadersService(legacyRedirect)
        }

        const websocketOrigin = resolveRealtimeWebSocketOriginService({
            origin:
                process.env.ORIGIN?.trim() ||
                (import.meta.env.DEV ? new URL(request.url).origin : ''),

            configuredUrl: import.meta.env.VITE_REALTIME_WS_URL,
            developmentPort: import.meta.env.DEV
                ? (import.meta.env.VITE_REALTIME_WS_DEV_PORT ?? '3001')
                : undefined,
        })
        return withRequestCspContextService(
            websocketOrigin,
            async (context) => {
                let response: Response
                try {
                    startHandler ??= createStartHandler(defaultStreamHandler)
                    response = await startHandler(request, options)
                } catch (error) {
                    response = handleStartError(error)
                }
                const privateResponse = isPasswordResetPath(
                    new URL(request.url).pathname,
                )
                    ? addPasswordResetPrivacyHeadersService(response)
                    : response
                return addCspResponseHeadersService(privateResponse, context)
            },
        )
    },
} satisfies ServerEntry)
