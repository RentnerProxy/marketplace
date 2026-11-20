import { DatabaseBackup, Save } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { BackupSettingsCardProps } from '../Types/backup-component-props.types.ts'
import BackupRetentionSettings from './BackupRetentionSettings.tsx'
import BackupScheduleSettings from './BackupScheduleSettings.tsx'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function BackupSettingsCard({
    state,
    handler,
}: BackupSettingsCardProps) {
    const { t } = useTranslationStore()

    return (
        <section className="marketplace-content-panel w-full rounded-2xl border border-border-dark bg-surface-dark p-5 sm:p-6">
            <div className="flex flex-col gap-4 border-b border-border-dark pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                    <HeadingIcon icon={DatabaseBackup} />
                    <div>
                        <h2 className="text-lg font-bold text-white">
                            {t('admin.backups.settingsTitle')}
                        </h2>
                        <p className="mt-1 text-sm text-secondary-text">
                            {t('admin.backups.settingsDescription')}
                        </p>
                    </div>
                </div>

                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border-dark bg-input-dark px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-primary/50">
                    <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={state.settings.isEnabled}
                        onChange={(event) =>
                            handler.handleSettingsChange(
                                'isEnabled',
                                event.target.checked,
                            )
                        }
                    />
                    {t('admin.backups.automaticEnabled')}
                </label>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <BackupScheduleSettings
                    settings={state.settings}
                    onSettingsChange={handler.handleSettingsChange}
                />
                <BackupRetentionSettings
                    settings={state.settings}
                    onSettingsChange={handler.handleSettingsChange}
                />
            </div>

            <div className="mt-5 flex justify-end">
                <button
                    type="button"
                    onClick={handler.handleSaveSettings}
                    disabled={state.isSaving}
                    className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md bg-primary px-5 font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <Save size={17} />
                    {t('common.save')}
                </button>
            </div>
        </section>
    )
}
