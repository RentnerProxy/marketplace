import { describe, expect, it } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { getRealtimeConnectionTopics } from '@/websockets/Server/realtimeTopics.ts'

describe('Backup-Realtime-Berechtigung', function () {
    it('abonniert Backup-Hinweise nur mit der Backup-Berechtigung', function () {
        const connection = {
            userId: '019f5b07-80e2-7000-8000-000000000001',
            username: 'test-user',
            permissions: [] as Array<string>,
            sessionHash: 'a'.repeat(64),
            expiresAt: '2026-10-07T12:00:00.000Z',
            absoluteExpiresAt: '2026-10-08T12:00:00.000Z',
            revocationEpoch: Symbol('test-epoch'),
        }
        expect(getRealtimeConnectionTopics(connection)).not.toContain(
            'admin-backups',
        )
        expect(
            getRealtimeConnectionTopics({
                ...connection,
                permissions: [PERMISSIONS.ADMIN_BACKUPS],
            }),
        ).toContain('admin-backups')
        expect(
            getRealtimeConnectionTopics({
                ...connection,
                permissions: [PERMISSIONS.ADMIN_AUDIT_LOGS],
            }),
        ).not.toContain('admin-backups')
    })
})
