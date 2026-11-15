export function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('de-DE', { timeZone }).format()
        return true
    } catch {
        return false
    }
}
