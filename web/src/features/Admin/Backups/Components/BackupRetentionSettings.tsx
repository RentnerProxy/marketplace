import { TimerReset } from 'lucide-react'
import { NumberInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { BackupSettings } from '@/lib/Backups/Types/backup.types.ts'
import type { BackupSettingsSectionProps } from '../Types/backup-component-props.types.ts'

const RETENTION_MODES = [
    'count',
    'days',
    'both',
] as const satisfies readonly BackupSettings['retentionMode'][]

export default function BackupRetentionSettings({
    settings,
    onSettingsChange,
}: BackupSettingsSectionProps) {
    const { t } = useTranslationStore()

    return (
        <div className="space-y-4 rounded-xl border border-border-dark bg-background-dark/35 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <TimerReset size={17} className="text-primary" />
                {t('admin.backups.retentionTitle')}
            </div>

            <CustomSelect<BackupSettings['retentionMode']>
                label={t('admin.backups.retentionMode')}
                value={settings.retentionMode}
                onValueChange={(value) =>
                    onSettingsChange('retentionMode', value)
                }
                options={RETENTION_MODES.map((value) => ({
                    value,
                    label: t(`admin.backups.retention.${value}`),
                }))}
                className="h-11 w-full rounded-md"
            />

            <div className="grid gap-4 sm:grid-cols-2">
                {settings.retentionMode !== 'count' && (
                    <div>
                        <NumberInput
                            label={t('admin.backups.retentionDays')}
                            min={1}
                            max={3650}
                            value={String(settings.retentionDays)}
                            onChange={(event) =>
                                onSettingsChange(
                                    'retentionDays',
                                    Number(event.target.value),
                                )
                            }
                            className="h-11 w-full rounded-md"
                        />
                    </div>
                )}

                {settings.retentionMode !== 'days' && (
                    <div>
                        <NumberInput
                            label={t('admin.backups.retentionCount')}
                            min={1}
                            max={1000}
                            value={String(settings.retentionCount)}
                            onChange={(event) =>
                                onSettingsChange(
                                    'retentionCount',
                                    Number(event.target.value),
                                )
                            }
                            className="h-11 w-full rounded-md"
                        />
                    </div>
                )}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-dark bg-input-dark p-4 text-sm text-white transition-colors hover:border-primary/50">
                <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
                    checked={settings.includeStorage}
                    onChange={(event) =>
                        onSettingsChange('includeStorage', event.target.checked)
                    }
                />
                <span>
                    <span className="block font-semibold">
                        {t('admin.backups.includeStorage')}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-secondary-text">
                        {t('admin.backups.includeStorageDescription')}
                    </span>
                </span>
            </label>
        </div>
    )
}
