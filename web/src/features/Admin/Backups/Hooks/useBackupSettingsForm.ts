import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { DEFAULT_BACKUP_SETTINGS } from '@/config/backup.config.ts'
import { BACKUP_TARGET_KEY } from '@/config/backup.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type {
    BackupSettings,
    UpdateBackupSettingsInput,
} from '@/lib/Backups/Types/backup.types.ts'
import { updateBackupSettingsHandler } from '../middleware.ts'
import { ADMIN_BACKUPS_QUERY_KEY } from '@/lib/Backups/backupCache.ts'
import type { UseBackupSettingsFormParams } from '../Types/backup-logic.types.ts'

export default function useBackupSettingsForm({
    storedSettings,
    onError,
}: UseBackupSettingsFormParams) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [previousStoredSettings, setPreviousStoredSettings] =
        useState(storedSettings)
    const [settings, setSettings] = useState<BackupSettings>(() =>
        storedSettings
            ? storedSettings
            : {
                  ...DEFAULT_BACKUP_SETTINGS,
                  targetKey: BACKUP_TARGET_KEY,
              },
    )

    if (storedSettings !== previousStoredSettings) {
        setPreviousStoredSettings(storedSettings)

        if (storedSettings) {
            setSettings(storedSettings)
        }
    }

    const saveMutation = useMutation({
        mutationFn: async function () {
            const input: UpdateBackupSettingsInput = {
                isEnabled: settings.isEnabled,
                scheduleType: settings.scheduleType,
                scheduleInterval: settings.scheduleInterval,
                scheduleWeekdays: settings.scheduleWeekdays,
                scheduleHour: settings.scheduleHour,
                scheduleMinute: settings.scheduleMinute,
                retentionMode: settings.retentionMode,
                retentionDays: settings.retentionDays,
                retentionCount: settings.retentionCount,
                includeStorage: settings.includeStorage,
            }
            return updateBackupSettingsHandler({ data: input })
        },
        onSuccess: async function () {
            toast.success(t('admin.backups.settingsSaved'), {
                title: t('admin.backups.title'),
            })
            await queryClient.invalidateQueries({
                queryKey: ADMIN_BACKUPS_QUERY_KEY,
            })
        },
        onError,
    })

    function handleSettingsChange<TKey extends keyof BackupSettings>(
        key: TKey,
        value: BackupSettings[TKey],
    ) {
        setSettings((current) => ({ ...current, [key]: value }))
    }

    function handleSaveSettings() {
        saveMutation.mutate()
    }

    return {
        state: {
            settings,
            isSaving: saveMutation.isPending,
        },
        handler: {
            handleSettingsChange,
            handleSaveSettings,
        },
    }
}
