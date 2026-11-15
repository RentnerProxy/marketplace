import { assertWorkerHeartbeatHealthyService } from '@/server/Runtime/worker-health.service.ts'

try {
    await assertWorkerHeartbeatHealthyService()
} catch {
    console.error('Background-Worker-Healthcheck fehlgeschlagen.')
    process.exit(1)
}
