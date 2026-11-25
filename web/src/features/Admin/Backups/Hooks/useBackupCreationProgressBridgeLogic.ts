import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { TranslationKey } from '@/language/translation.ts'
import {
    clearTransferTasks,
    finishExternalTransferTask,
    syncExternalTransferTask,
} from '@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts'
import { triggerBackupDownload } from '@/lib/Backups/backupTransfer.ts'
import type { BackupCreationProgressPhase } from '@/lib/Backups/Types/backup.types.ts'
import type { BackupRunCreationProgress } from '../Types/backup-domain.types.ts'
import {
    ADMIN_BACKUPS_QUERY_KEY,
    backupCreationProgressQueryOptions,
} from '@/lib/Backups/backupCache.ts'
import { subscribeToRealtimeEvents } from '@/websockets/Client/realtimeEventsClient.ts'
import usePendingManualBackupIntent, {
    clearPendingManualBackupIntent,
} from './usePendingManualBackupIntent.ts'

const PHASE_TRANSLATION_KEYS: Record<
    BackupCreationProgressPhase,
    TranslationKey
> = {
    queued: 'admin.backups.progress.phaseQueued',
    preparing: 'admin.backups.progress.phasePreparing',
    collecting: 'admin.backups.progress.phaseCollecting',
    archiving: 'admin.backups.progress.phaseArchiving',
    verifying: 'admin.backups.progress.phaseVerifying',
    finalizing: 'admin.backups.progress.phaseFinalizing',
}

function getProgressValues(progress: BackupRunCreationProgress) {
    const totalBytes = Math.max(progress.totalBytes, 0)
    const processedBytes = Math.max(
        0,
        totalBytes > 0
            ? Math.min(progress.processedBytes, totalBytes)
            : progress.processedBytes,
    )

    return {
        indeterminate: totalBytes <= 0,
        processedBytes,
        totalBytes,
    }
}

export default function useBackupCreationProgressBridgeLogic(
    userId: string,
): void {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const pendingManualBackup = usePendingManualBackupIntent(userId)
    const pendingManualBackupId =
        pendingManualBackup.state.pendingManualBackupId
    const [trackedRunId, setTrackedRunId] = useState<string | null>(null)
    const scheduleTrackedRunId = useCallback(function (
        nextTrackedRunId: string | null,
    ) {
        window.setTimeout(() => setTrackedRunId(nextTrackedRunId), 0)
    }, [])
    const queryRunId = pendingManualBackupId ?? trackedRunId
    const handledTerminalRunIds = useRef(new Set<string>())
    const lastProgress = useRef<{
        phase: BackupCreationProgressPhase
        processedBytes: number
        runId: string
        measuredAt: number
    } | null>(null)
    const progressQuery = useQuery(
        backupCreationProgressQueryOptions(queryRunId),
    )

    useEffect(() => {
        const progress = progressQuery.data

        if (!progress) {
            if (pendingManualBackupId) {
                syncExternalTransferTask({
                    id: `backup-creation:${pendingManualBackupId}`,
                    direction: 'download',
                    kind: 'backup',
                    title: t('admin.backups.progress.manualTitle'),
                    totalBytes: 0,
                    transferredBytes: 0,
                    indeterminate: true,
                    message: t('admin.backups.progress.phaseQueued'),
                })
            }
            return
        }

        const taskId = `backup-creation:${progress.runId}`
        const title = t(
            progress.trigger === 'manual'
                ? 'admin.backups.progress.manualTitle'
                : 'admin.backups.progress.scheduledTitle',
        )
        const values = getProgressValues(progress)
        const now = performance.now()
        const previousProgress = lastProgress.current
        const elapsedSeconds = previousProgress
            ? Math.max((now - previousProgress.measuredAt) / 1_000, 0.001)
            : 0
        const speedBytesPerSecond =
            previousProgress?.runId === progress.runId &&
            previousProgress.phase === 'archiving' &&
            progress.phase === 'archiving' &&
            progress.processedBytes >= previousProgress.processedBytes
                ? (progress.processedBytes - previousProgress.processedBytes) /
                  elapsedSeconds
                : 0

        lastProgress.current = {
            phase: progress.phase,
            processedBytes: progress.processedBytes,
            runId: progress.runId,
            measuredAt: now,
        }

        if (progress.status === 'queued' || progress.status === 'running') {
            if (!pendingManualBackupId && trackedRunId !== progress.runId) {
                scheduleTrackedRunId(progress.runId)
            }

            syncExternalTransferTask({
                id: taskId,
                direction: 'download',
                kind: 'backup',
                title,
                totalBytes: values.totalBytes,
                transferredBytes: values.processedBytes,
                speedBytesPerSecond,
                indeterminate: values.indeterminate,
                message: t(PHASE_TRANSLATION_KEYS[progress.phase]),
            })
            return
        }

        if (handledTerminalRunIds.current.has(progress.runId)) {
            if (trackedRunId === progress.runId) {
                scheduleTrackedRunId(null)
            }
            return
        }

        handledTerminalRunIds.current.add(progress.runId)
        const isPendingManualBackup =
            pendingManualBackupId === progress.runId &&
            progress.trigger === 'manual'

        if (progress.status === 'completed') {
            finishExternalTransferTask({
                id: taskId,
                direction: 'download',
                kind: 'backup',
                title,
                totalBytes: values.totalBytes,
                transferredBytes: values.processedBytes,
                status: 'success',
                message: t('admin.backups.progress.completed'),
            })

            if (isPendingManualBackup) {
                clearPendingManualBackupIntent(progress.runId, userId)

                if (progress.fileName) {
                    triggerBackupDownload(
                        `/api/admin/backups/${encodeURIComponent(progress.runId)}`,
                        progress.fileName,
                    )
                } else {
                    toast.error(
                        t('admin.backups.progress.downloadUnavailable'),
                        { title: t('admin.backups.title') },
                    )
                }
            }
        } else {
            finishExternalTransferTask({
                id: taskId,
                direction: 'download',
                kind: 'backup',
                title,
                totalBytes: values.totalBytes,
                transferredBytes: values.processedBytes,
                status: 'error',
                indeterminate: values.indeterminate,
                message:
                    progress.errorMessage ??
                    t('admin.backups.backupCreationFailed'),
            })

            if (isPendingManualBackup) {
                clearPendingManualBackupIntent(progress.runId, userId)
            }
        }

        if (trackedRunId === progress.runId) {
            scheduleTrackedRunId(null)
        }
    }, [
        pendingManualBackupId,
        progressQuery.data,
        scheduleTrackedRunId,
        t,
        trackedRunId,
        userId,
    ])

    const refetchProgress = progressQuery.refetch
    const refreshProgress = useCallback(
        function () {
            void refetchProgress().catch(toastAppError)
        },
        [refetchProgress],
    )

    useEffect(() => {
        return subscribeToRealtimeEvents(async function (event) {
            if (
                event.type === 'admin-backups.changed' ||
                event.type === 'connection.ready'
            ) {
                refreshProgress()
                await queryClient.invalidateQueries({
                    queryKey: ADMIN_BACKUPS_QUERY_KEY,
                })
            }
        })
    }, [queryClient, refreshProgress])

    useEffect(() => {
        function handleVisibilityChange() {
            if (document.visibilityState === 'visible') {
                refreshProgress()
            }
        }

        window.addEventListener('focus', refreshProgress)
        window.addEventListener('pageshow', refreshProgress)
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return function () {
            window.removeEventListener('focus', refreshProgress)
            window.removeEventListener('pageshow', refreshProgress)
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange,
            )
            clearTransferTasks('backup')
        }
    }, [refreshProgress])
}
