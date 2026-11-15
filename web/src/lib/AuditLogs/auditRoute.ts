export function sanitizeAuditRoute(route: string | null | undefined) {
    const normalizedRoute = route?.trim()

    if (!normalizedRoute) {
        return null
    }

    try {
        return new URL(normalizedRoute, 'http://audit.local').pathname || null
    } catch {
        return null
    }
}
