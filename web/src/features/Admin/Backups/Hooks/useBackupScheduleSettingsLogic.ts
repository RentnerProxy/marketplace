import type {
    BackupScheduleSettingsLogicReturn,
    UseBackupScheduleSettingsParams,
} from '../Types/backup-logic.types.ts'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const

export default function useBackupScheduleSettingsLogic({
    settings,
    onSettingsChange,
}: UseBackupScheduleSettingsParams): BackupScheduleSettingsLogicReturn {
    const selectedWeekdays = settings.scheduleWeekdays.split(',').map(Number)

    function handleToggleWeekday(day: number) {
        const nextDays = selectedWeekdays.includes(day)
            ? selectedWeekdays.filter((value) => value !== day)
            : [...selectedWeekdays, day]

        if (nextDays.length === 0) return

        onSettingsChange(
            'scheduleWeekdays',
            WEEKDAYS.filter((value) => nextDays.includes(value)).join(','),
        )
    }

    function handleTimeChange(value: string) {
        const [hour, minute] = value.split(':').map(Number)
        onSettingsChange('scheduleHour', hour)
        onSettingsChange('scheduleMinute', minute)
    }

    return {
        state: {
            weekdays: WEEKDAYS,
            selectedWeekdays,
            timeValue: `${String(settings.scheduleHour).padStart(2, '0')}:${String(settings.scheduleMinute).padStart(2, '0')}`,
            intervalWeekday: settings.scheduleWeekdays.split(',')[0] ?? '1',
            showsTime: settings.scheduleType !== 'interval-hours',
            showsWeekdays: settings.scheduleType === 'weekdays',
            showsInterval: ['interval-hours', 'interval-weeks'].includes(
                settings.scheduleType,
            ),
        },
        handler: {
            handleToggleWeekday,
            handleTimeChange,
        },
    }
}
