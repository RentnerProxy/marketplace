import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { getCurrentBrowserPath } from '@/lib/Browser/browser.ts'
import { isRestoreAccessBlocked } from '@/lib/Restore/restoreStatus.ts'
import {
    clearRestoreReturnPath,
    rememberRestoreReturnPath,
} from '@/lib/Restore/restoreReturnPath.ts'
import type { RestoreNavigationBridgeOptions } from '@/lib/Restore/Types/restore.types.ts'
import { clearPreRestoreQueryCache } from '@/lib/Restore/restoreQueryCache.ts'
import useRestoreStatus from './useRestoreStatus.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

export default function useRestoreNavigationBridge(
    options: RestoreNavigationBridgeOptions = {},
) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { state } = useRestoreStatus()
    const hasObservedRunningRestore = useRef(false)

    useEffect(() => {
        const status = state.restoreStatus?.status

        if (!status) {
            return
        }

        if (isRestoreAccessBlocked(status)) {
            if (
                options.isPreRestoreIdentityResolved === false ||
                hasObservedRunningRestore.current
            ) {
                return
            }

            hasObservedRunningRestore.current = true
            const returnPath = rememberRestoreReturnPath(
                options.returnPath ?? getCurrentBrowserPath(),
                options.preRestoreUserId,
            )
            clearPreRestoreQueryCache(queryClient)
            void navigate({
                to: '/update-in-progress',
                hash: returnPath
                    ? `return=${encodeURIComponent(returnPath)}`
                    : undefined,
                replace: true,
            }).catch(toastAppError)
            return
        }

        if (
            options.clearStaleReturnPath &&
            !hasObservedRunningRestore.current
        ) {
            clearRestoreReturnPath()
        }
    }, [
        navigate,
        queryClient,
        options.clearStaleReturnPath,
        options.isPreRestoreIdentityResolved,
        options.preRestoreUserId,
        options.returnPath,
        state.restoreStatus?.status,
    ])
}
