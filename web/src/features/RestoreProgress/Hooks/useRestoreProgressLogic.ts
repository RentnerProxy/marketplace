import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { isRestoreAccessBlocked } from '@/lib/Restore/restoreStatus.ts'
import { getRestoreReturnPath } from '@/lib/Restore/restoreReturnPath.ts'
import { captureRestoreReturnPathFromFragment } from '@/lib/Restore/restoreReturnFragment.ts'
import { clearPreRestoreQueryCache } from '@/lib/Restore/restoreQueryCache.ts'
import type { RestoreProgressLogicReturn } from '../Types/restore-progress.types.ts'
import useRestoreStatus from '@/shared/Restore/Hooks/useRestoreStatus.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

const IDLE_REDIRECT_DELAY_MS = 500
const COMPLETED_REDIRECT_DELAY_MS = 2_000
const FAILED_REDIRECT_DELAY_MS = 3_500

export default function useRestoreProgressLogic(): RestoreProgressLogicReturn {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const restoreStatusResult = useRestoreStatus()
    const restoreStatus = restoreStatusResult.state.restoreStatus

    useEffect(() => {
        captureRestoreReturnPathFromFragment()
    }, [])

    useEffect(() => {
        const status = restoreStatus?.status

        if (!status || isRestoreAccessBlocked(status)) {
            return undefined
        }

        const delay =
            status === 'completed'
                ? COMPLETED_REDIRECT_DELAY_MS
                : status === 'failed'
                  ? FAILED_REDIRECT_DELAY_MS
                  : IDLE_REDIRECT_DELAY_MS
        const redirectTimer = window.setTimeout(function () {
            const target = getRestoreReturnPath() ?? '/login'
            clearPreRestoreQueryCache(queryClient)
            void navigate({ href: target, replace: true }).catch(toastAppError)
        }, delay)

        return function () {
            window.clearTimeout(redirectTimer)
        }
    }, [navigate, queryClient, restoreStatus?.status])

    return {
        state: {
            restoreStatus,
            isLoading: restoreStatusResult.state.isLoading,
            isError: restoreStatusResult.state.isError,
        },
    }
}
