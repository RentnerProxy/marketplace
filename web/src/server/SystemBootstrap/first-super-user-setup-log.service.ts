import { FIRST_SUPERUSER_SETUP_ACCESS_TTL_SECONDS } from '@/config/security.config.ts'
import { logError } from '@/server/Logging/logger.ts'
import { writeLogLineService } from '@/server/Logging/log-transport.ts'
import { getFirstSuperUserSetupStatusService } from './first-super-user.service.ts'
import {
    clearFirstSuperUserSetupAccessService,
    createFirstSuperUserSetupAccessIfMissingService,
    createFirstSuperUserSetupAccessService,
} from './first-super-user-setup-access.service.ts'

const SETUP_LOG_CHECK_INTERVAL_MS = 30_000

export async function startFirstSuperUserSetupLogService(
    origin: string,
    signal?: AbortSignal,
) {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    function stop() {
        stopped = true
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', stop)
    }

    async function refresh(replaceExisting = false) {
        try {
            const status = await getFirstSuperUserSetupStatusService()
            if (stopped) return
            if (!status.isRequired) {
                stop()
                return
            }

            const token = replaceExisting
                ? await createFirstSuperUserSetupAccessService()
                : await createFirstSuperUserSetupAccessIfMissingService()
            if (stopped || !token) return

            if (!(await getFirstSuperUserSetupStatusService()).isRequired) {
                await clearFirstSuperUserSetupAccessService()
                stop()
                return
            }
            if (stopped) return

            const url = new URL('/setup', origin)
            url.hash = `access=${token}`
            const minutes = FIRST_SUPERUSER_SETUP_ACCESS_TTL_SECONDS / 60

            // The bootstrap URL is intentionally handed to the operator through process stdout only.
            writeLogLineService(
                process.stdout,
                [
                    '',
                    '============================================================',
                    '# SETUP-LINK: ERSTEN SUPERUSER ANLEGEN',
                    '# Kopiere den vollständigen Link in deinen Browser.',
                    `# Link ${minutes} Minuten gültig`,
                    '',
                    url.href,
                    '============================================================',
                    '',
                    '',
                ].join('\n'),
            )
        } catch (error) {
            if (!stopped)
                logError('system.first-super-user.setup_link_failed', error)
        } finally {
            if (!stopped) {
                timer = setTimeout(function () {
                    void refresh()
                }, SETUP_LOG_CHECK_INTERVAL_MS)
                timer.unref()
            }
        }
    }

    if (signal?.aborted) return { stop }
    signal?.addEventListener('abort', stop, { once: true })
    await refresh(true)
    return { stop }
}
