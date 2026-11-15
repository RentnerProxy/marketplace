import { createFileRoute } from '@tanstack/react-router'
import { getPublicRestoreStateService } from '@/server/Admin/Backups/restore-state.service.ts'
import { isStorageMutationBarrierHealthyService } from '@/server/Storage/storage-mutation-barrier-health.service.ts'

export async function handleRestoreStatusRequest(request: Request) {
    const state = await getPublicRestoreStateService()
    const barrierIsHealthy = isStorageMutationBarrierHealthyService()
    const now = new Date().toISOString()
    const payload = !barrierIsHealthy
        ? {
              version: 1 as const,
              status: 'recovery-required' as const,
              phase: 'rolling-back' as const,
              percent: null,
              processedBytes: state?.processedBytes ?? 0,
              totalBytes: state?.totalBytes ?? 0,
              startedAt: state?.startedAt ?? now,
              updatedAt: now,
          }
        : (state ?? {
              version: 1 as const,
              status: 'idle' as const,
              phase: null,
              percent: null,
              processedBytes: 0,
              totalBytes: 0,
              startedAt: null,
              updatedAt: null,
          })
    const responseStatus =
        request.method === 'HEAD' && !barrierIsHealthy ? 503 : 200

    return new Response(
        request.method === 'HEAD' ? null : JSON.stringify(payload),
        {
            status: responseStatus,
            headers: {
                'cache-control': 'no-store',
                'content-type': 'application/json; charset=utf-8',
                ...(barrierIsHealthy ? {} : { 'retry-after': '3' }),
            },
        },
    )
}

export const Route = createFileRoute('/api/system/restore-status')({
    server: {
        handlers: {
            GET: function ({ request }) {
                return handleRestoreStatusRequest(request)
            },
            HEAD: function ({ request }) {
                return handleRestoreStatusRequest(request)
            },
        },
    },
})
