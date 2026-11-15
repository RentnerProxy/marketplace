import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { deleteBackupHandler, restoreBackupHandler } from '../middleware.ts'
import { ADMIN_BACKUPS_QUERY_KEY } from '@/lib/Backups/backupCache.ts'
import type { UseBackupRunActionsParams } from '../Types/backup-logic.types.ts'

export default function useBackupRunActions({
    onError,
}: UseBackupRunActionsParams) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [restoreBackupId, setRestoreBackupId] = useState<string | null>(null)
    const [deleteBackupId, setDeleteBackupId] = useState<string | null>(null)
    const [restoreConfirmation, setRestoreConfirmation] = useState('')
    const [activeActionId, setActiveActionId] = useState<string | null>(null)
    const clearRestoreSelection = useCallback(function () {
        setRestoreBackupId(null)
        setRestoreConfirmation('')
    }, [])

    const deleteMutation = useMutation({
        mutationFn: async function (backupId: string) {
            setActiveActionId(backupId)
            return deleteBackupHandler({ data: { backupId } })
        },
        onSettled: function () {
            setActiveActionId(null)
        },
        onSuccess: async function () {
            setDeleteBackupId(null)
            await queryClient.invalidateQueries({
                queryKey: ADMIN_BACKUPS_QUERY_KEY,
            })
        },
        onError,
    })
    const restoreMutation = useMutation({
        mutationFn: async function () {
            if (!restoreBackupId) {
                throw new Error(t('admin.backups.restoreMissing'))
            }

            if (restoreConfirmation !== 'WIEDERHERSTELLEN') {
                throw new Error(t('admin.backups.restoreConfirmationLabel'))
            }

            setActiveActionId(restoreBackupId)
            return restoreBackupHandler({
                data: {
                    backupId: restoreBackupId,
                    confirmation: restoreConfirmation,
                },
            })
        },
        onSettled: function () {
            setActiveActionId(null)
        },
        onSuccess: async function () {
            clearRestoreSelection()
            toast.success(t('admin.backups.restoreQueued'), {
                title: t('admin.backups.title'),
            })
            await queryClient.invalidateQueries({
                queryKey: ADMIN_BACKUPS_QUERY_KEY,
            })
        },
        onError,
    })

    const deleteBackup = deleteMutation.mutate
    const restoreBackup = restoreMutation.mutate

    const handleDeleteBackup = useCallback(function (backupId: string) {
        setDeleteBackupId(backupId)
    }, [])

    const handleCancelDeleteBackup = useCallback(
        function () {
            if (!deleteMutation.isPending) {
                setDeleteBackupId(null)
            }
        },
        [deleteMutation.isPending],
    )

    const handleConfirmDeleteBackup = useCallback(
        function () {
            if (deleteBackupId) {
                deleteBackup(deleteBackupId)
            }
        },
        [deleteBackup, deleteBackupId],
    )

    const handleOpenRestore = useCallback(function (backupId: string) {
        setRestoreBackupId(backupId)
        setRestoreConfirmation('')
    }, [])

    const handleCancelRestore = useCallback(
        function () {
            clearRestoreSelection()
        },
        [clearRestoreSelection],
    )

    const handleRestoreBackup = useCallback(
        function () {
            restoreBackup()
        },
        [restoreBackup],
    )

    return {
        state: {
            restoreBackupId,
            deleteBackupId,
            restoreConfirmation,
            activeActionId,
        },
        handler: {
            handleDeleteBackup,
            handleCancelDeleteBackup,
            handleConfirmDeleteBackup,
            handleOpenRestore,
            handleCancelRestore,
            handleRestoreConfirmationChange: setRestoreConfirmation,
            handleRestoreBackup,
        },
    }
}
