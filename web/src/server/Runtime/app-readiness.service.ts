import { APP_READINESS } from '@/config/health.config.ts'
import { RESTORE_STATUS_PATH } from '@/server/Admin/Backups/restore-request-gate.service.ts'

export function createAppReadinessCheckService(internalPort: number) {
    let cache = { expiresAt: 0, value: false }
    let pendingCheck: Promise<boolean> | null = null

    return async function isInternalAppReady() {
        if (cache.expiresAt > Date.now()) return cache.value

        pendingCheck ??= (async function () {
            try {
                const response = await fetch(
                    `http://127.0.0.1:${internalPort}${RESTORE_STATUS_PATH}`,
                    {
                        method: 'HEAD',
                        signal: AbortSignal.timeout(
                            APP_READINESS.requestTimeoutMs,
                        ),
                    },
                )
                return response.status === 200
            } catch {
                return false
            }
        })()

        try {
            const value = await pendingCheck
            cache = { expiresAt: Date.now() + APP_READINESS.cacheMs, value }
            return value
        } finally {
            pendingCheck = null
        }
    }
}
