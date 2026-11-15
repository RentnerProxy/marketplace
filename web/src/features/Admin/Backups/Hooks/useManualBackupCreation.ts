import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { ADMIN_BACKUPS_QUERY_KEY } from '@/lib/Backups/backupCache.ts'
import {
    backupApiErrorResponseSchema,
    queuedBackupCreationResponseSchema,
} from '../validation.ts'
import type { UseManualBackupCreationParams } from '../Types/backup-logic.types.ts'
import usePendingManualBackupIntent from './usePendingManualBackupIntent.ts'

export default function useManualBackupCreation({
    onError,
}: UseManualBackupCreationParams) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())
    const pendingManualBackup = usePendingManualBackupIntent(
        sessionData?.user?.id ?? null,
    )

    const createMutation = useMutation({
        mutationFn: async function () {
            const response = await fetch('/api/admin/backups/download', {
                method: 'POST',
            })

            if (!response.ok) {
                const result = backupApiErrorResponseSchema.safeParse(
                    await response.json().catch(() => null),
                )
                throw new Error(
                    (result.success && result.data.error) || t('common.error'),
                )
            }

            if (response.status !== 202) {
                throw new Error(t('common.error'))
            }

            const result = queuedBackupCreationResponseSchema.safeParse(
                await response.json().catch(() => null),
            )

            if (
                !result.success ||
                !pendingManualBackup.handler.handleSetPendingManualBackup(
                    result.data.backupId,
                )
            ) {
                throw new Error(t('common.error'))
            }
        },
        onSuccess: async function () {
            await queryClient.invalidateQueries({
                queryKey: ADMIN_BACKUPS_QUERY_KEY,
            })
        },
        onError,
    })

    function handleCreateBackup() {
        createMutation.mutate()
    }

    return {
        state: {
            isCreating:
                createMutation.isPending ||
                pendingManualBackup.state.pendingManualBackupId !== null,
        },
        handler: {
            handleCreateBackup,
        },
    }
}
