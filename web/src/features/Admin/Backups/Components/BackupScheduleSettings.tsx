import { CalendarClock } from 'lucide-react'
import { NumberInput, TimeInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { BackupSettings } from '@/lib/Backups/Types/backup.types.ts'
import useBackupScheduleSettingsLogic from '../Hooks/useBackupScheduleSettingsLogic.ts'
import type { BackupSettingsSectionProps } from '../Types/backup-component-props.types.ts'

const SCHEDULE_TYPES = [
    'daily',
    'weekdays',
    'interval-hours',
    'interval-weeks',
] as const satisfies readonly BackupSettings['scheduleType'][]

export default function BackupScheduleSettings({
    settings,
    onSettingsChange,
}: BackupSettingsSectionProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useBackupScheduleSettingsLogic({
        settings,
        onSettingsChange,
    })

    return (
        <div className="space-y-4 rounded-xl border border-border-dark bg-background-dark/35 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <CalendarClock size={17} className="text-primary" />
                {t('admin.backups.scheduleTitle')}
            </div>

            <CustomSelect<BackupSettings['scheduleType']>
                label={t('admin.backups.scheduleType')}
                value={settings.scheduleType}
                onValueChange={(value) =>
                    onSettingsChange('scheduleType', value)
                }
                options={SCHEDULE_TYPES.map((value) => ({
                    value,
                    label: t(`admin.backups.schedule.${value}`),
                }))}
                className="h-11 w-full rounded-md"
            />

            {state.showsWeekdays && (
                <div>
                    <span className="mb-2 block text-sm text-secondary-text">
                        {t('admin.backups.weekdays')}
                    </span>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                        {state.weekdays.map((day) => {
                            const selected =
                                state.selectedWeekdays.includes(day)
                            return (
                                <button
                                    key={day}
                                    type="button"
                                    onClick={() =>
                                        handler.handleToggleWeekday(day)
                                    }
                                    className={
                                        selected
                                            ? 'h-10 cursor-pointer rounded-md bg-primary text-sm font-bold text-white transition-colors hover:bg-primary-hover'
                                            : 'h-10 cursor-pointer rounded-md border border-border-dark bg-input-dark text-sm font-semibold text-secondary-text transition-colors hover:border-primary/50 hover:text-white'
                                    }
                                >
                                    {t(`admin.backups.weekday.${day}`)}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            {settings.scheduleType === 'interval-weeks' && (
                <div>
                    <CustomSelect
                        label={t('admin.backups.intervalWeekday')}
                        value={state.intervalWeekday}
                        onValueChange={(value) =>
                            onSettingsChange('scheduleWeekdays', value)
                        }
                        options={state.weekdays.map((day) => ({
                            value: String(day),
                            label: t(`admin.backups.weekdayLong.${day}`),
                        }))}
                        className="h-11 w-full rounded-md"
                    />
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                {state.showsInterval && (
                    <div>
                        <NumberInput
                            label={
                                settings.scheduleType === 'interval-hours'
                                    ? t('admin.backups.intervalHours')
                                    : t('admin.backups.intervalWeeks')
                            }
                            min={1}
                            max={
                                settings.scheduleType === 'interval-hours'
                                    ? 168
                                    : 52
                            }
                            value={String(settings.scheduleInterval)}
                            onChange={(event) =>
                                onSettingsChange(
                                    'scheduleInterval',
                                    Number(event.target.value),
                                )
                            }
                            className="h-11 w-full rounded-md"
                        />
                    </div>
                )}

                {state.showsTime && (
                    <div>
                        <TimeInput
                            label={t('admin.backups.scheduleTime')}
                            value={state.timeValue}
                            onChange={(event) =>
                                handler.handleTimeChange(event.target.value)
                            }
                            className="h-11 w-full rounded-md"
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
