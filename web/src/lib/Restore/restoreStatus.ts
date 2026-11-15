import { z } from 'zod'
import { queryOptions } from '@tanstack/react-query'
import type { RestoreStatus } from '@/lib/Restore/Types/restore.types.ts'

export const RESTORE_STATUS_QUERY_KEY = ['system-restore-status'] as const

const restoreProgressPhaseSchema = z.enum([
    'preparing',
    'validating',
    'creating-recovery',
    'replacing-storage',
    'restoring-database',
    'finalizing',
    'rolling-back',
])

const restoreStatusBase = {
    version: z.literal(1),
    percent: z.number().int().min(0).max(100).nullable(),
    processedBytes: z.number().int().nonnegative().safe(),
    totalBytes: z.number().int().nonnegative().safe(),
    startedAt: z.string().min(1).nullable(),
    updatedAt: z.string().min(1).nullable(),
}

const restoreStatusSchema = z
    .union([
        z
            .object({
                ...restoreStatusBase,
                status: z.literal('idle'),
                phase: z.null(),
            })
            .strict(),
        z
            .object({
                ...restoreStatusBase,
                status: z.enum([
                    'running',
                    'completed',
                    'failed',
                    'recovery-required',
                ]),
                phase: restoreProgressPhaseSchema,
            })
            .strict(),
    ])
    .superRefine(function (status, context) {
        if (status.processedBytes > status.totalBytes) {
            context.addIssue({
                code: 'custom',
                message: 'Die Restore-Fortschrittswerte sind inkonsistent.',
            })
        }
    })

export function parseRestoreStatus(value: unknown): RestoreStatus {
    return restoreStatusSchema.parse(value)
}

export function isRestoreAccessBlocked(status: RestoreStatus['status']) {
    return status === 'running' || status === 'recovery-required'
}

async function getRestoreStatus() {
    const response = await fetch('/api/system/restore-status', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
    })

    if (!response.ok) {
        throw new Error('Der Restore-Status konnte nicht geladen werden.')
    }

    return parseRestoreStatus(await response.json())
}

export function restoreStatusQueryOptions() {
    return queryOptions({
        queryKey: RESTORE_STATUS_QUERY_KEY,
        queryFn: getRestoreStatus,
        gcTime: 0,
        refetchInterval: function (query) {
            const status = query.state.data?.status
            return status && isRestoreAccessBlocked(status) ? 2_000 : false
        },
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 0,
        staleTime: 0,
    })
}
