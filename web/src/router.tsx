import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { getContext } from '@/integrations/TanstackQuery/root-provider.ts'
import {
    captureResetToken,
    discardPasswordResetToken,
} from '@/lib/Auth/PasswordReset/passwordResetTokenHandoff.ts'
import { isPasswordResetPath } from '@/lib/Auth/passwordResetPath.ts'
import { getRouterCspNonce } from '@/lib/Security/cspNonce.ts'
import {
    captureFirstSetupToken,
    discardFirstSetupToken,
} from '@/lib/Auth/FirstSuperUser/firstSetupTokenHandoff.ts'
import { isFirstSuperUserSetupPath } from '@/features/Auth/FirstSuperUser/setupAccess.ts'

export function getRouter() {
    if (!import.meta.env.SSR && typeof window !== 'undefined') {
        captureResetToken(window)
        captureFirstSetupToken(window)
    }
    const context = getContext()

    const router = createTanStackRouter({
        routeTree,
        context,
        origin: import.meta.env.SSR ? process.env.ORIGIN?.trim() : undefined,
        ssr: { nonce: getRouterCspNonce() },
        scrollRestoration: true,
        defaultPreload: 'intent',
        defaultPreloadStaleTime: 0,
    })

    if (!import.meta.env.SSR && typeof window !== 'undefined') {
        router.subscribe('onBeforeNavigate', function ({ toLocation }) {
            if (!isPasswordResetPath(toLocation.pathname))
                discardPasswordResetToken(window)
            if (!isFirstSuperUserSetupPath(toLocation.pathname))
                discardFirstSetupToken(window)
        })
    }

    setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

    return router
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof getRouter>
    }
}
