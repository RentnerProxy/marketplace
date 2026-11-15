import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    AUDIT_TEST_ACTOR,
    createAuditTransactionTestModel,
} from '@/tests/lib/AuditLogs/audit-transaction.test.helpers.ts'
import { installUserSettingsImageTestMocks } from './image-audit.test.helpers.ts'

const model = createAuditTransactionTestModel()
model.install()
const image = installUserSettingsImageTestMocks(model)
const getSession = vi.fn(async function (): Promise<{ id: string } | null> {
    return { id: AUDIT_TEST_ACTOR }
})
vi.mock('@/server/Auth/currentSession.ts', () => ({
    getCurrentUserSettingsSession: getSession,
}))
const {
    updateCurrentUserProfileImageService,
    updateCurrentUserPersonalInfoService,
} = await import('@/server/UserSettings/profile.service.ts')
const imageInput = {
    imageDataUrl: 'data:image/png;base64,AAAA',
    crop: { x: 0, y: 0, width: 100, height: 100 },
}
const personalInput = {
    firstName: ' New ',
    lastName: ' Name ',
    street: ' ',
    houseNumber: ' ',
    postalCode: ' ',
    city: ' Town ',
}
const previous = {
    userId: AUDIT_TEST_ACTOR,
    firstName: 'Old',
    lastName: 'Name',
    street: null,
    houseNumber: null,
    postalCode: null,
    city: 'Here',
}
const normalized = {
    firstName: 'New',
    lastName: 'Name',
    street: null,
    houseNumber: null,
    postalCode: null,
    city: 'Town',
}

describe('profile mutations and mandatory audits', function () {
    beforeEach(function () {
        model.reset()
        model.state.rows.set('user_profiles', { ...previous })
        getSession.mockResolvedValue({ id: AUDIT_TEST_ACTOR })
    })

    it('commits normalized personal information with its actual previous values', async function () {
        await expect(
            updateCurrentUserPersonalInfoService(personalInput),
        ).resolves.toEqual({
            success: true,
            personalInfo: normalized,
        })
        expect(model.state.audits[0]).toMatchObject({
            action: 'user.personal_info_updated',
            actorUserId: AUDIT_TEST_ACTOR,
            oldValues: {
                firstName: 'Old',
                lastName: 'Name',
                street: null,
                houseNumber: null,
                postalCode: null,
                city: 'Here',
            },
            newValues: normalized,
        })
        expect(model.state.events.indexOf('commit')).toBeLessThan(
            model.state.events.indexOf('publish-audit'),
        )
    })

    for (const failure of ['audit', 'commit', 'returning']) {
        it(
            'rolls personal information back on ' + failure + ' failure',
            async function () {
                model.state.failAction =
                    failure === 'audit' ? 'user.personal_info_updated' : null
                model.state.failCommit = failure === 'commit'
                model.state.emptyReturning = failure === 'returning'
                await expect(
                    updateCurrentUserPersonalInfoService(personalInput),
                ).rejects.toThrow()
                expect(model.state.rows.get('user_profiles')).toEqual(previous)
                expect(model.state.audits).toEqual([])
                expect(model.publish).not.toHaveBeenCalled()
            },
        )
    }

    it('blocks profile file writes when the initial durable audit fails', async function () {
        model.state.failAction = 'user.profile_image_update_started'
        await expect(
            updateCurrentUserProfileImageService(imageInput),
        ).rejects.toThrow('synthetic audit failure')
        expect(image.mkdir).not.toHaveBeenCalled()
        expect(image.toFile).not.toHaveBeenCalled()
        expect(model.state.rows.get('user_profiles')).toEqual(previous)
    })

    it('preserves the intent and rolls metadata back if the result audit fails after writing images', async function () {
        model.state.failAction = 'user.profile_image_updated'
        await expect(
            updateCurrentUserProfileImageService(imageInput),
        ).rejects.toThrow('synthetic audit failure')
        expect(image.toFile).toHaveBeenCalledTimes(2)
        expect(model.state.rows.get('user_profiles')).toEqual(previous)
        expect(model.state.audits).toEqual([
            expect.objectContaining({
                action: 'user.profile_image_update_started',
                newValues: { operationId: expect.any(String) },
            }),
        ])
        expect(model.state.events.indexOf('commit')).toBeLessThan(
            model.state.events.indexOf('fs:write'),
        )
    })

    it('returns existing profile URL fields and correlates both durable image events despite realtime failure', async function () {
        model.state.failPublish = true
        const result = await updateCurrentUserProfileImageService(imageInput)
        expect(result).toEqual({
            success: true,
            profileImageVersion: expect.any(Number),
            profileImageSrc: expect.stringMatching(
                /^\/images\/profile.webp\?v=\d+$/,
            ),
            profileImageSrc64: expect.stringMatching(
                /^\/images\/profile-small.webp\?v=\d+$/,
            ),
        })
        expect(model.state.audits).toHaveLength(2)
        expect(model.state.audits[1]?.newValues?.operationId).toBe(
            model.state.audits[0]?.newValues?.operationId,
        )
        expect(
            model.state.rows.get('user_profiles')?.profileImageUpdatedAt,
        ).toBeInstanceOf(Date)
    })

    it('rejects unauthenticated profile writes before transactions or image parsing', async function () {
        getSession.mockResolvedValue(null)
        expect(
            await updateCurrentUserPersonalInfoService(personalInput),
        ).toMatchObject({ success: false })
        expect(
            await updateCurrentUserProfileImageService(imageInput),
        ).toMatchObject({ success: false })
        expect(model.database.transaction).not.toHaveBeenCalled()
        expect(image.getBuffer).not.toHaveBeenCalled()
    })
    it('returns identical normalized personal information without writes, audit or realtime after the user lock', async function () {
        const matching = { userId: AUDIT_TEST_ACTOR, ...normalized }
        model.state.rows.set('user_profiles', matching)
        model.state.failAction = 'user.personal_info_updated'
        model.state.emptyReturning = true

        await expect(
            updateCurrentUserPersonalInfoService(personalInput),
        ).resolves.toEqual({ success: true, personalInfo: normalized })

        expect(model.state.rows.get('user_profiles')).toEqual(matching)
        expect(model.state.events).toContain('read:user_profiles')
        expect(model.state.events).not.toContain('insert:user_profiles')
        expect(model.state.events).not.toContain('insert:auditLogs')
        expect(model.state.audits).toEqual([])
        expect(model.publish).not.toHaveBeenCalled()
        expect(image.toFile).not.toHaveBeenCalled()
        expect(
            model.state.events.indexOf(
                'lock:users:' + AUDIT_TEST_ACTOR + ':update',
            ),
        ).toBeLessThan(model.state.events.indexOf('read:user_profiles'))
    })

    it('materializes an absent profile even when every submitted field normalizes to null', async function () {
        const emptyInput = {
            firstName: ' ',
            lastName: '',
            street: '',
            houseNumber: '',
            postalCode: '',
            city: '',
        }
        const emptyProfile = {
            firstName: null,
            lastName: null,
            street: null,
            houseNumber: null,
            postalCode: null,
            city: null,
        }
        model.state.rows.delete('user_profiles')

        await expect(
            updateCurrentUserPersonalInfoService(emptyInput),
        ).resolves.toEqual({ success: true, personalInfo: emptyProfile })

        expect(model.state.rows.get('user_profiles')).toEqual({
            userId: AUDIT_TEST_ACTOR,
            ...emptyProfile,
        })
        expect(model.state.events).toContain('insert:user_profiles')
        expect(model.state.audits).toHaveLength(1)
        expect(model.state.audits[0]).toMatchObject({
            action: 'user.personal_info_updated',
            oldValues: null,
            newValues: emptyProfile,
        })
    })

    for (const field of [
        'firstName',
        'lastName',
        'street',
        'houseNumber',
        'postalCode',
        'city',
    ] as const) {
        it('persists and audits a change to only ' + field, async function () {
            model.state.rows.set('user_profiles', {
                userId: AUDIT_TEST_ACTOR,
                ...normalized,
                [field]: 'previous value',
            })

            await expect(
                updateCurrentUserPersonalInfoService(personalInput),
            ).resolves.toEqual({ success: true, personalInfo: normalized })

            expect(model.state.rows.get('user_profiles')).toEqual({
                userId: AUDIT_TEST_ACTOR,
                ...normalized,
            })
            expect(model.state.audits).toHaveLength(1)
            expect(model.state.audits[0]?.oldValues?.[field]).toBe(
                'previous value',
            )
            expect(model.state.audits[0]?.newValues).toEqual(normalized)
        })
    }

    it.each([undefined, ' New '])(
        'repairs incomplete or unnormalized persisted profile data (%s)',
        async function (firstName) {
            model.state.rows.set('user_profiles', {
                userId: AUDIT_TEST_ACTOR,
                ...normalized,
                firstName,
            })

            await expect(
                updateCurrentUserPersonalInfoService(personalInput),
            ).resolves.toEqual({ success: true, personalInfo: normalized })

            expect(model.state.rows.get('user_profiles')?.firstName).toBe('New')
            expect(model.state.events).toContain('insert:user_profiles')
            expect(model.state.audits).toHaveLength(1)
            expect(model.state.audits[0]?.action).toBe(
                'user.personal_info_updated',
            )
        },
    )

    it('continues to write and audit both intents and completions when the same profile image is submitted again', async function () {
        await updateCurrentUserProfileImageService(imageInput)
        await updateCurrentUserProfileImageService(imageInput)

        expect(image.toFile).toHaveBeenCalledTimes(4)
        expect(model.state.audits.map((entry) => entry.action)).toEqual([
            'user.profile_image_update_started',
            'user.profile_image_updated',
            'user.profile_image_update_started',
            'user.profile_image_updated',
        ])
    })
})
