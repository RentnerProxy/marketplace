import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BACKUP_UPLOAD_CONTENT_TYPE } from '@/config/backup.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { startTransferTask } from '@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts'
import { failBackupTransfer } from '@/lib/Backups/backupTransfer.ts'
import { ADMIN_BACKUPS_QUERY_KEY } from '@/lib/Backups/backupCache.ts'
import { backupImportResponseSchema } from '../validation.ts'
import type { UseBackupImportParams } from '../Types/backup-logic.types.ts'

export default function useBackupImport({ onError }: UseBackupImportParams) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [isImporting, setIsImporting] = useState(false)

    async function executeBackupImport(file: File) {
        const response = await fetch('/api/admin/backups/import', {
            method: 'POST',
            headers: { 'content-type': BACKUP_UPLOAD_CONTENT_TYPE },
            body: file,
        })
        const parsed = backupImportResponseSchema.safeParse(
            await response.json(),
        )
        if (!parsed.success) throw new Error(t('admin.backups.importFailed'))
        const result = parsed.data

        if (!response.ok || !result.success) {
            throw new Error(result.error ?? t('admin.backups.importFailed'))
        }

        await queryClient.invalidateQueries({
            queryKey: ADMIN_BACKUPS_QUERY_KEY,
        })
    }

    async function importBackup(file: File) {
        setIsImporting(true)
        const transfer = startTransferTask({
            direction: 'upload',
            title: t('admin.backups.progress.backupImport'),
            totalBytes: file.size,
        })

        try {
            await executeBackupImport(file)
            transfer.complete()
        } catch (error: unknown) {
            onError(failBackupTransfer(transfer, error, t('common.error')))
        } finally {
            setIsImporting(false)
        }
    }

    function handleImportBackup(file: File | null) {
        if (file) {
            void importBackup(file)
        }
    }

    return {
        state: {
            isImporting,
        },
        handler: {
            handleImportBackup,
        },
    }
}
