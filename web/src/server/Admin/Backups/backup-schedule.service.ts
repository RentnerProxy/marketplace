import type { BackupSettings } from '@/lib/Backups/Types/backup.types.ts'
import { isValidTimeZone } from '@/lib/Date/timeZone.ts'

export function assertValidBackupTimezoneService(timezone: string) {
    if (!isValidTimeZone(timezone)) {
        throw new Error('BACKUP_TIMEZONE enthält keine gültige Zeitzone.')
    }
}

export function getBackupRepeatOptionsService(
    settings: BackupSettings,
    timezone: string,
    now?: Date,
) {
    if (settings.scheduleType === 'interval-hours') {
        return { every: settings.scheduleInterval * 60 * 60 * 1_000 }
    }

    if (settings.scheduleType === 'interval-weeks') {
        return {
            every: settings.scheduleInterval * 7 * 24 * 60 * 60 * 1_000,
            startDate: getNextIntervalStart(
                settings,
                timezone,
                now ?? new Date(),
            ),
        }
    }

    const weekdays =
        settings.scheduleType === 'weekdays' ? settings.scheduleWeekdays : '*'

    return {
        pattern: `${settings.scheduleMinute} ${settings.scheduleHour} * * ${weekdays}`,
        tz: timezone,
    }
}

function getNextIntervalStart(
    settings: BackupSettings,
    timezone: string,
    now: Date,
) {
    const targetWeekday = Number(settings.scheduleWeekdays.split(',')[0] ?? 1)
    const localNow = getZonedDateTimeParts(now, timezone)
    const localDate = new Date(
        Date.UTC(localNow.year, localNow.month - 1, localNow.day),
    )
    const daysUntilTarget = (targetWeekday - localDate.getUTCDay() + 7) % 7
    localDate.setUTCDate(localDate.getUTCDate() + daysUntilTarget)
    let start = zonedTimeToUtc(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth() + 1,
        localDate.getUTCDate(),
        settings.scheduleHour,
        settings.scheduleMinute,
        timezone,
    )

    if (start.getTime() <= now.getTime()) {
        localDate.setUTCDate(localDate.getUTCDate() + 7)
        start = zonedTimeToUtc(
            localDate.getUTCFullYear(),
            localDate.getUTCMonth() + 1,
            localDate.getUTCDate(),
            settings.scheduleHour,
            settings.scheduleMinute,
            timezone,
        )
    }

    return start
}

function getZonedDateTimeParts(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date)
    const values = Object.fromEntries(
        parts.map((part) => [part.type, Number(part.value)]),
    )

    return {
        year: values.year,
        month: values.month,
        day: values.day,
        hour: values.hour,
        minute: values.minute,
    }
}

function zonedTimeToUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timezone: string,
) {
    const targetTimestamp = Date.UTC(year, month - 1, day, hour, minute)
    const firstGuess = new Date(targetTimestamp)
    const guessedValues = getZonedDateTimeParts(firstGuess, timezone)
    const representedTimestamp = Date.UTC(
        guessedValues.year,
        guessedValues.month - 1,
        guessedValues.day,
        guessedValues.hour,
        guessedValues.minute,
    )

    return new Date(targetTimestamp - (representedTimestamp - targetTimestamp))
}
