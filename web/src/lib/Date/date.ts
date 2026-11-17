import type { MaintenanceDateValue } from './Types/date.types.ts'

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
})
const maintenanceDateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
})

export function formatDate(value: string | Date) {
    return dateFormatter.format(new Date(value))
}

export function formatNullableDate(
    value: string | Date | null | undefined,
    fallback = 'Unbekannt',
) {
    if (!value) {
        return fallback
    }

    return formatDate(value)
}

export function formatRemainingTime(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatCountdown(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
    const days = Math.floor(totalSeconds / 86_400)
    const hours = Math.floor((totalSeconds % 86_400) / 3_600)
    const minutes = Math.floor((totalSeconds % 3_600) / 60)
    const seconds = totalSeconds % 60

    return [
        days > 0 ? `${days}d` : null,
        `${String(hours).padStart(2, '0')}h`,
        `${String(minutes).padStart(2, '0')}m`,
        `${String(seconds).padStart(2, '0')}s`,
    ]
        .filter(Boolean)
        .join(' ')
}

export function formatMaintenanceDate(value: MaintenanceDateValue) {
    const dateValue = Array.isArray(value) ? value[0] : value

    if (!dateValue) {
        return '-'
    }

    const date = dateValue instanceof Date ? dateValue : new Date(dateValue)

    if (Number.isNaN(date.getTime())) {
        return '-'
    }

    return maintenanceDateFormatter.format(date)
}
