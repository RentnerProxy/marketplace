import { definePlugin } from 'nitro'
import {
    BACKUP_REQUEST_IDLE_TIMEOUT_SECONDS,
    usesBackupStreamingPolicyService,
} from '@/server/Production/proxy.service.ts'

export default definePlugin(function backupRequestTimeoutService(nitroApp) {
    nitroApp.hooks.hook('request', function ({ req }) {
        if (
            !usesBackupStreamingPolicyService(
                req.method,
                new URL(req.url).pathname,
            )
        )
            return
        req.runtime?.bun?.server.timeout(
            req,
            BACKUP_REQUEST_IDLE_TIMEOUT_SECONDS,
        )
    })
})
