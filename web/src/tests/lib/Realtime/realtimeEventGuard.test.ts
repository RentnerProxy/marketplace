import { describe, expect, it } from 'bun:test'
import { parseRealtimeEvent } from '@/lib/Realtime/realtimeEventGuard.ts'

describe('Realtime event guard', function () {
    it('validiert Backup-Änderungshinweise und lehnt zusätzliche interne Daten ab', function () {
        const event = {
            type: 'admin-backups.changed' as const,
            payload: { updatedAt: '2026-10-06T12:48:17.000Z' },
        }
        expect(parseRealtimeEvent(JSON.stringify(event))).toEqual(event)
        expect(
            parseRealtimeEvent(
                JSON.stringify({
                    ...event,
                    payload: { ...event.payload, databaseUrl: 'private' },
                }),
            ),
        ).toBeNull()
    })

    it('validiert bekannte Events', function () {
        const event = parseRealtimeEvent(
            JSON.stringify({
                type: 'audit-log.created',
                payload: {
                    auditLogId: '01941f29-7c00-7000-8000-000000000001',
                    createdAt: '2026-07-01T08:00:00.000Z',
                },
            }),
        )

        expect(event?.type).toBe('audit-log.created')
    })

    it('validiert versionierte Branding-URLs für Live-Aktualisierungen', function () {
        const event = parseRealtimeEvent(
            JSON.stringify({
                type: 'system-settings.updated',
                payload: {
                    companyName: 'Neue Firma',
                    logoSrc: '/images/system/logo.webp?v=42',
                    logoSrc64: '/images/system/logo-64.webp?v=42',
                    faviconSrc: '/favicon.ico?v=42',
                    updatedAt: '2026-08-12T08:00:00.000Z',
                },
            }),
        )

        expect(event).toMatchObject({
            type: 'system-settings.updated',
            payload: {
                logoSrc64: '/images/system/logo-64.webp?v=42',
                faviconSrc: '/favicon.ico?v=42',
            },
        })
    })

    it('validiert neu erstellte Benachrichtigungen', function () {
        const event = parseRealtimeEvent(
            JSON.stringify({
                type: 'notification.created',
                payload: {
                    userId: '01941f29-7c00-7000-8000-000000000002',
                    notification: {
                        id: '01941f29-7c00-7000-8000-000000000003',
                        title: 'Neue Rechte',
                        message:
                            'Dir wurden neue Rechte zugewiesen: admin.dashboard',
                        type: 'permissions-added',
                        referenceId: null,
                        isRead: false,
                        readAt: null,
                        createdAt: '2026-07-01T08:00:00.000Z',
                    },
                },
            }),
        )

        expect(event?.type).toBe('notification.created')

        if (event?.type === 'notification.created') {
            expect(event.payload.notification.isRead).toBe(false)
        }
    })

    it('validiert bestätigte Wartungsverschiebungsanträge', function () {
        const event = parseRealtimeEvent(
            JSON.stringify({
                type: 'maintenance-extension.requested',
                payload: {
                    request: {
                        id: '01941f29-7c00-7000-8000-000000000004',
                        reason: 'Ich benötige noch etwas mehr Zeit.',
                        requestedAt: '2026-07-02T08:00:00.000Z',
                        user: {
                            id: '01941f29-7c00-7000-8000-000000000005',
                            username: 'demo-user',
                        },
                    },
                },
            }),
        )

        expect(event?.type).toBe('maintenance-extension.requested')
    })

    it('validiert Änderungen an Standardrechten und Presets', function () {
        const event = parseRealtimeEvent(
            JSON.stringify({
                type: 'admin-permissions.updated',
                payload: {
                    scope: 'defaults',
                    updatedAt: '2026-07-18T08:00:00.000Z',
                },
            }),
        )

        expect(event?.type).toBe('admin-permissions.updated')
        expect(
            parseRealtimeEvent(
                JSON.stringify({
                    type: 'admin-permissions.updated',
                    payload: {
                        scope: 'unknown',
                        updatedAt: '2026-07-18T08:00:00.000Z',
                    },
                }),
            ),
        ).toBeNull()
    })

    it('verwirft ungültiges JSON und unbekannte Events', function () {
        expect(parseRealtimeEvent('{')).toBeNull()
        expect(
            parseRealtimeEvent(
                JSON.stringify({ type: 'unknown', payload: {} }),
            ),
        ).toBeNull()
    })
})
