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
const { updateCurrentUserProfileImageService } =
    await import('@/server/UserSettings/profile.service.ts')
const imageInput = {
    imageDataUrl: 'data:image/png;base64,AAAA',
    crop: { x: 0, y: 0, width: 100, height: 100 },
}
const previous = { userId: AUDIT_TEST_ACTOR }

describe('profile mutations and mandatory audits', function () {
    beforeEach(function () {
        model.reset()
        model.state.rows.set('user_profiles', { ...previous })
        getSession.mockResolvedValue({ id: AUDIT_TEST_ACTOR })
    })

    it('blocks profile file writes when the initial durable audit fails', async function () {
        model.state.failAction = 'user.profile_image_update_started'
        await expect(
            updateCurrentUserProfileImageService(imageInput),
        ).rejects.toThrow('synthetic audit failure')
        expect(image.mkdir).not.toHaveBeenCalled()
        expect(image.writeFile).not.toHaveBeenCalled()
        expect(model.state.rows.get('user_profiles')).toEqual(previous)
    })

    it('preserves the intent and rolls metadata back if the result audit fails after writing images', async function () {
        model.state.failAction = 'user.profile_image_updated'
        await expect(
            updateCurrentUserProfileImageService(imageInput),
        ).rejects.toThrow('synthetic audit failure')
        expect(image.writeFile).toHaveBeenCalledTimes(2)
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

    it('decodes and crops the upload once and encodes both variants before writing', async function () {
        await updateCurrentUserProfileImageService(imageInput)

        expect(image.extract).toHaveBeenCalledTimes(1)
        expect(image.toColorspace).toHaveBeenCalledWith('srgb')
        expect(image.decodePixels).toHaveBeenCalledTimes(1)
        expect(image.toBuffer).toHaveBeenCalledTimes(2)
        for (const callNumber of [2, 3]) {
            expect(image.sharp).toHaveBeenNthCalledWith(
                callNumber,
                image.rawPixels,
                { raw: { width: 512, height: 512, channels: 4 } },
            )
        }
        expect(image.writeFile.mock.calls).toEqual([
            [image.encodedImage],
            [image.encodedImage],
        ])
        expect(model.state.events.lastIndexOf('image:encode')).toBeLessThan(
            model.state.events.indexOf('fs:write'),
        )
    })

    it('publishes each complete variant by renaming a closed temporary file in the same directory', async function () {
        await updateCurrentUserProfileImageService(imageInput)

        const operationId = model.state.audits[0]?.newValues?.operationId
        if (typeof operationId !== 'string')
            throw new Error('Missing profile image operation ID.')
        const full = image.paths.absoluteProfile
        const small = image.paths.absoluteProfileSmall
        const fullTemporary = `${full}.${operationId}.tmp`
        const smallTemporary = `${small}.${operationId}.tmp`
        expect(image.open.mock.calls).toEqual([
            [fullTemporary, 'wx'],
            [smallTemporary, 'wx'],
        ])
        expect(image.rename.mock.calls).toEqual([
            [fullTemporary, full],
            [smallTemporary, small],
        ])
        expect(
            model.state.events.filter((event) => event.startsWith('fs:')),
        ).toEqual([
            'fs:mkdir',
            'fs:write',
            'fs:close',
            'fs:rename',
            'fs:write',
            'fs:close',
            'fs:rename',
        ])
    })

    it('removes the temporary variant and skips the result audit when publication fails', async function () {
        const failure = new Error('Synthetic profile rename failure')
        image.rename.mockRejectedValueOnce(failure)

        await expect(
            updateCurrentUserProfileImageService(imageInput),
        ).rejects.toBe(failure)

        expect(image.open).toHaveBeenCalledTimes(1)
        expect(image.rm).toHaveBeenCalledWith(image.open.mock.calls[0]?.[0], {
            force: true,
        })
        expect(model.state.audits.map((entry) => entry.action)).toEqual([
            'user.profile_image_update_started',
        ])
        expect(model.state.rows.get('user_profiles')).toEqual(previous)
    })

    it('leaves both profile files untouched when a variant cannot be encoded', async function () {
        const failure = new Error('Synthetic image encoding failure')
        image.toBuffer
            .mockResolvedValueOnce(image.encodedImage)
            .mockRejectedValueOnce(failure)

        await expect(
            updateCurrentUserProfileImageService(imageInput),
        ).rejects.toBe(failure)
        expect(image.writeFile).not.toHaveBeenCalled()
        expect(model.state.audits.map((entry) => entry.action)).toEqual([
            'user.profile_image_update_started',
        ])
    })

    it('rejects unauthenticated profile writes before transactions or image parsing', async function () {
        getSession.mockResolvedValue(null)
        expect(
            await updateCurrentUserProfileImageService(imageInput),
        ).toMatchObject({ success: false })
        expect(model.database.transaction).not.toHaveBeenCalled()
        expect(image.getBuffer).not.toHaveBeenCalled()
    })
    it('continues to write and audit both intents and completions when the same profile image is submitted again', async function () {
        await updateCurrentUserProfileImageService(imageInput)
        await updateCurrentUserProfileImageService(imageInput)

        expect(image.writeFile).toHaveBeenCalledTimes(4)
        expect(model.state.audits.map((entry) => entry.action)).toEqual([
            'user.profile_image_update_started',
            'user.profile_image_updated',
            'user.profile_image_update_started',
            'user.profile_image_updated',
        ])
    })
})
