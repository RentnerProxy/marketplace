import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    AUDIT_TEST_ACTOR,
    createAuditTransactionTestModel,
} from '@/tests/lib/AuditLogs/audit-transaction.test.helpers.ts'
import { installUserSettingsImageTestMocks } from './image-audit.test.helpers.ts'

const model = createAuditTransactionTestModel()
model.install()
installUserSettingsImageTestMocks(model)
const getSession = vi.fn(async function (): Promise<{ id: string } | null> {
    return { id: AUDIT_TEST_ACTOR }
})
vi.mock('@/server/Auth/currentSession.ts', () => ({
    getCurrentUserSettingsSession: getSession,
}))
const { updateCurrentUserBioService } =
    await import('@/server/UserSettings/profile.service.ts')

describe('profile bio mutation', function () {
    beforeEach(function () {
        model.reset()
        model.state.rows.set('user_profiles', {
            userId: AUDIT_TEST_ACTOR,
            bio: 'Old bio',
        })
        getSession.mockResolvedValue({ id: AUDIT_TEST_ACTOR })
    })

    it('stores a trimmed bio and audits the previous value', async function () {
        await expect(
            updateCurrentUserBioService({ bio: '  New bio  ' }),
        ).resolves.toEqual({ success: true, bio: 'New bio' })
        expect(model.state.audits[0]).toMatchObject({
            action: 'user.bio_updated',
            actorUserId: AUDIT_TEST_ACTOR,
            oldValues: { bio: 'Old bio' },
            newValues: { bio: 'New bio' },
        })
    })

    it('clears an empty bio and skips unchanged values', async function () {
        await expect(
            updateCurrentUserBioService({ bio: '   ' }),
        ).resolves.toEqual({ success: true, bio: null })
        model.reset()
        model.state.rows.set('user_profiles', {
            userId: AUDIT_TEST_ACTOR,
            bio: 'Same',
        })
        await expect(
            updateCurrentUserBioService({ bio: 'Same' }),
        ).resolves.toEqual({ success: true, bio: 'Same' })
        expect(model.state.audits).toHaveLength(0)
    })

    it('rejects unauthenticated bio writes', async function () {
        getSession.mockResolvedValue(null)
        await expect(
            updateCurrentUserBioService({ bio: 'x' }),
        ).resolves.toEqual({
            success: false,
            error: 'Du bist nicht angemeldet.',
        })
        expect(model.state.audits).toHaveLength(0)
    })
})
