import { describe, expect, it } from 'bun:test'
import { sanitizeAuditRoute } from '@/lib/AuditLogs/auditRoute.ts'

describe('sanitizeAuditRoute', function () {
    it.each([
        ['/password-reset?token=secret#fragment', '/password-reset'],
        ['https://app.example.test/admin/users?page=2', '/admin/users'],
        ['/api/admin/backups/:backupId', '/api/admin/backups/:backupId'],
    ])('entfernt Query und Fragment aus %s', function (route, expected) {
        expect(sanitizeAuditRoute(route)).toBe(expected)
    })

    it.each([null, undefined, '', '   ', 'http://['])(
        'verwirft eine ungültige oder leere Route',
        function (route) {
            expect(sanitizeAuditRoute(route)).toBeNull()
        },
    )
})
