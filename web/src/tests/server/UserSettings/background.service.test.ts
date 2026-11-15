import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
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
    updateCurrentUserBackgroundAppearanceService,
    updateCurrentUserBackgroundService,
    deleteCurrentUserBackgroundService,
} = await import('@/server/UserSettings/background.service.ts')
const imageInput = {
    imageDataUrl: 'data:image/png;base64,AAAA',
    crop: { x: 0, y: 0, width: 100, height: 100 },
}
const previous = {
    userId: AUDIT_TEST_ACTOR,
    customBackgroundDarkness: 42,
    customBackgroundUpdatedAt: new Date('2026-01-01T00:00:00Z'),
}
const operations = [
    {
        start: 'user.background_update_started',
        result: 'user.background_updated',
        run: () => updateCurrentUserBackgroundService(imageInput),
    },
    {
        start: 'user.background_delete_started',
        result: 'user.background_deleted',
        run: deleteCurrentUserBackgroundService,
    },
]

describe('background mutations and mandatory audits', function () {
    beforeEach(function () {
        model.reset()
        image.lstat.mockResolvedValue({})
        model.state.rows.set('user_settings', structuredClone(previous))
        getSession.mockResolvedValue({ id: AUDIT_TEST_ACTOR })
    })

    it('does not write or publish an identical locked darkness value', async () => {
        model.state.failAction = 'user.background_appearance_updated'
        await expect(
            updateCurrentUserBackgroundAppearanceService({
                customBackgroundDarkness: 42,
            }),
        ).resolves.toEqual({ success: true, customBackgroundDarkness: 42 })
        expect(model.state.rows.get('user_settings')).toEqual(previous)
        expect(model.state.audits).toEqual([])
        expect(model.publish).not.toHaveBeenCalled()
        expect(model.state.events).not.toContain('insert:user_settings')
        expect(
            model.state.events.some((event) => event.startsWith('lock:users:')),
        ).toBe(true)
    })

    it('materializes a missing settings row and audits the first saved darkness', async () => {
        model.state.rows.delete('user_settings')
        await updateCurrentUserBackgroundAppearanceService({
            customBackgroundDarkness: 42,
        })
        expect(
            model.state.rows.get('user_settings')?.customBackgroundDarkness,
        ).toBe(42)
        expect(model.state.audits).toHaveLength(1)
    })

    it('does not audit or remove an already empty background with no current or legacy file', async () => {
        model.state.rows.set('user_settings', {
            userId: AUDIT_TEST_ACTOR,
            customBackgroundDarkness: null,
            customBackgroundUpdatedAt: null,
        })
        image.lstat.mockRejectedValue(
            Object.assign(new Error('missing'), { code: 'ENOENT' }),
        )
        await expect(deleteCurrentUserBackgroundService()).resolves.toEqual({
            success: true,
        })
        expect(image.lstat).toHaveBeenCalledTimes(2)
        expect(image.rm).not.toHaveBeenCalled()
        expect(model.state.audits).toEqual([])
        expect(model.state.events).not.toContain('insert:user_settings')
        expect(model.publish).not.toHaveBeenCalled()
    })

    it.each([
        image.paths.absoluteBackground,
        image.paths.absoluteLegacyBackground,
    ])(
        'still audits and removes an orphan file at %s despite empty metadata',
        async (existingPath) => {
            model.state.rows.set('user_settings', {
                userId: AUDIT_TEST_ACTOR,
                customBackgroundDarkness: null,
                customBackgroundUpdatedAt: null,
            })
            image.lstat.mockImplementation(async (path) => {
                if (path === existingPath) return {}
                throw Object.assign(new Error('missing'), { code: 'ENOENT' })
            })
            await deleteCurrentUserBackgroundService()
            expect(image.rm).toHaveBeenCalledTimes(2)
            expect(model.state.audits).toHaveLength(2)
        },
    )

    it('fails closed when file absence cannot be established', async () => {
        model.state.rows.set('user_settings', {
            userId: AUDIT_TEST_ACTOR,
            customBackgroundDarkness: null,
            customBackgroundUpdatedAt: null,
        })
        image.lstat.mockRejectedValue(
            Object.assign(new Error('unavailable'), { code: 'EACCES' }),
        )
        await expect(deleteCurrentUserBackgroundService()).rejects.toThrow(
            'unavailable',
        )
        expect(image.rm).not.toHaveBeenCalled()
        expect(model.state.audits).toEqual([])
        expect(model.publish).not.toHaveBeenCalled()
    })

    it('commits darkness with its locked previous value', async function () {
        await expect(
            updateCurrentUserBackgroundAppearanceService({
                customBackgroundDarkness: 60,
            }),
        ).resolves.toEqual({ success: true, customBackgroundDarkness: 60 })
        expect(model.state.audits[0]).toMatchObject({
            actorUserId: AUDIT_TEST_ACTOR,
            action: 'user.background_appearance_updated',
            oldValues: { customBackgroundDarkness: 42 },
            newValues: { customBackgroundDarkness: 60 },
        })
    })

    for (const failure of ['audit', 'commit', 'returning']) {
        it('rolls darkness back on ' + failure + ' failure', async function () {
            model.state.failAction =
                failure === 'audit'
                    ? 'user.background_appearance_updated'
                    : null
            model.state.failCommit = failure === 'commit'
            model.state.emptyReturning = failure === 'returning'
            await expect(
                updateCurrentUserBackgroundAppearanceService({
                    customBackgroundDarkness: 60,
                }),
            ).rejects.toThrow()
            expect(model.state.rows.get('user_settings')).toEqual(previous)
            expect(model.state.audits).toEqual([])
            expect(model.publish).not.toHaveBeenCalled()
        })
    }

    for (const operation of operations) {
        it(
            operation.start + ' is mandatory before filesystem changes',
            async function () {
                model.state.failAction = operation.start
                await expect(operation.run()).rejects.toThrow(
                    'synthetic audit failure',
                )
                expect(image.mkdir).not.toHaveBeenCalled()
                expect(image.toFile).not.toHaveBeenCalled()
                expect(image.toBuffer).not.toHaveBeenCalled()
                expect(image.writePrivateFile).not.toHaveBeenCalled()
                expect(image.rm).not.toHaveBeenCalled()
                expect(model.state.rows.get('user_settings')).toEqual(previous)
            },
        )

        it(
            operation.result +
                ' failure preserves the intent and rolls metadata back',
            async function () {
                model.state.failAction = operation.result
                await expect(operation.run()).rejects.toThrow(
                    'synthetic audit failure',
                )
                expect(model.state.rows.get('user_settings')).toEqual(previous)
                expect(model.state.audits).toEqual([
                    expect.objectContaining({ action: operation.start }),
                ])
                expect(image.rm).toHaveBeenCalled()
                const firstFileEvent = model.state.events.findIndex((value) =>
                    value.startsWith('fs:'),
                )
                expect(model.state.events.indexOf('commit')).toBeLessThan(
                    firstFileEvent,
                )
            },
        )
    }

    it('preserves darkness and the existing versioned response when replacing a background', async function () {
        model.state.failPublish = true
        const result = await updateCurrentUserBackgroundService(imageInput)
        expect(result).toEqual({
            success: true,
            customBackgroundDarkness: 42,
            customBackgroundUpdatedAt: expect.any(String),
            backgroundSrc: expect.stringMatching(
                /^\/api\/images\/background\?v=/,
            ),
        })
        expect(
            model.state.rows.get('user_settings')?.customBackgroundDarkness,
        ).toBe(42)
        expect(
            model.state.rows.get('user_settings')?.customBackgroundUpdatedAt,
        ).toBeInstanceOf(Date)
        expect(image.writePrivateFile).toHaveBeenCalledTimes(1)
        expect(image.writePrivateFile).toHaveBeenCalledWith({
            rootDirectory: image.paths.absolutePrivateStorageRoot,
            filePath: image.paths.absoluteBackground,
            data: image.encodedImage,
        })
        expect(image.toBuffer).toHaveBeenCalledTimes(1)
        expect(image.toFile).not.toHaveBeenCalled()
        expect(image.mkdir).not.toHaveBeenCalled()
        expect(image.getPaths).toHaveBeenCalledTimes(1)
        expect(image.getPaths).toHaveBeenCalledWith(AUDIT_TEST_ACTOR)
        expect(image.rm).toHaveBeenCalledTimes(1)
        expect(image.rm).toHaveBeenCalledWith(
            image.paths.absoluteLegacyBackground,
            { force: true },
        )
        expect(model.state.audits[1]?.newValues?.operationId).toBe(
            model.state.audits[0]?.newValues?.operationId,
        )
        expect(model.state.audits).toHaveLength(2)
    })

    it('speichert die gewählte Abdunklung gemeinsam mit dem Bild und auditiert sie', async function () {
        const result = await updateCurrentUserBackgroundService({
            ...imageInput,
            customBackgroundDarkness: 70,
        })

        expect(result).toMatchObject({
            success: true,
            customBackgroundDarkness: 70,
        })
        expect(
            model.state.rows.get('user_settings')?.customBackgroundDarkness,
        ).toBe(70)
        expect(model.state.audits[1]).toMatchObject({
            oldValues: { customBackgroundDarkness: 42 },
            newValues: { customBackgroundDarkness: 70 },
        })
    })

    it('erhält explizit gewählte 0 Prozent Abdunklung beim Speichern', async function () {
        const result = await updateCurrentUserBackgroundService({
            ...imageInput,
            customBackgroundDarkness: 0,
        })

        expect(result).toMatchObject({
            success: true,
            customBackgroundDarkness: 0,
        })
        expect(
            model.state.rows.get('user_settings')?.customBackgroundDarkness,
        ).toBe(0)
    })

    it('resizes the chosen crop without cropping again before the private write', async function () {
        await updateCurrentUserBackgroundService(imageInput)

        expect(image.sharp).toHaveBeenCalledTimes(1)
        expect(image.sharp).toHaveBeenCalledWith(Buffer.from('image'), {
            limitInputPixels: IMAGE_UPLOAD_CONFIG.maxInputPixels,
        })
        expect(image.extract).toHaveBeenCalledTimes(1)
        expect(image.extract).toHaveBeenCalledWith({
            left: 0,
            top: 0,
            width: 100,
            height: 100,
        })
        expect(image.resize).toHaveBeenCalledTimes(1)
        expect(image.resize).toHaveBeenCalledWith(
            IMAGE_UPLOAD_CONFIG.background.width,
            IMAGE_UPLOAD_CONFIG.background.height,
            { fit: 'inside' },
        )
        expect(image.webp).toHaveBeenCalledTimes(1)
        expect(image.webp).toHaveBeenCalledWith({
            quality: IMAGE_UPLOAD_CONFIG.background.quality,
        })
        expect(model.state.events.indexOf('commit')).toBeLessThan(
            model.state.events.indexOf('image:encode'),
        )
        expect(model.state.events.indexOf('image:encode')).toBeLessThan(
            model.state.events.indexOf('fs:write-private'),
        )
        expect(model.state.events.indexOf('fs:write-private')).toBeLessThan(
            model.state.events.indexOf('fs:rm'),
        )
        expect(model.state.events.indexOf('fs:rm')).toBeLessThan(
            model.state.events.indexOf('insert:user_settings'),
        )
    })

    it('does not convert or write an image when committing the durable intent fails', async function () {
        model.state.failCommit = true

        await expect(
            updateCurrentUserBackgroundService(imageInput),
        ).rejects.toThrow('synthetic commit failure')

        expect(image.toBuffer).not.toHaveBeenCalled()
        expect(image.writePrivateFile).not.toHaveBeenCalled()
        expect(image.rm).not.toHaveBeenCalled()
        expect(model.state.rows.get('user_settings')).toEqual(previous)
        expect(model.state.audits).toEqual([])
    })

    it.each(['encode', 'write'] as const)(
        'keeps metadata and legacy files untouched after a %s failure',
        async function (failure) {
            if (failure === 'encode')
                image.toBuffer.mockRejectedValueOnce(
                    new Error('synthetic encoding failure'),
                )
            if (failure === 'write')
                image.writePrivateFile.mockRejectedValueOnce(
                    new Error('synthetic private write failure'),
                )

            await expect(
                updateCurrentUserBackgroundService(imageInput),
            ).rejects.toThrow()

            expect(image.mkdir).not.toHaveBeenCalled()
            expect(image.toFile).not.toHaveBeenCalled()
            expect(image.rm).not.toHaveBeenCalled()
            expect(image.writePrivateFile).toHaveBeenCalledTimes(
                failure === 'encode' ? 0 : 1,
            )
            expect(model.state.rows.get('user_settings')).toEqual(previous)
            expect(model.state.events).not.toContain('insert:user_settings')
            expect(model.state.audits).toEqual([
                expect.objectContaining({
                    action: 'user.background_update_started',
                }),
            ])
        },
    )

    it('waits for confirmed publication before removing the legacy file or committing metadata', async function () {
        const entered = Promise.withResolvers<void>()
        const published = Promise.withResolvers<void>()
        image.writePrivateFile.mockImplementationOnce(async function () {
            entered.resolve()
            return published.promise
        })

        const result = updateCurrentUserBackgroundService(imageInput)
        await entered.promise

        expect(image.rm).not.toHaveBeenCalled()
        expect(model.state.rows.get('user_settings')).toEqual(previous)
        expect(model.state.events).not.toContain('insert:user_settings')
        expect(model.state.audits.map((entry) => entry.action)).toEqual([
            'user.background_update_started',
        ])

        published.resolve()
        await expect(result).resolves.toMatchObject({ success: true })
        expect(image.rm).toHaveBeenCalledTimes(1)
        expect(image.rm).toHaveBeenCalledWith(
            image.paths.absoluteLegacyBackground,
            { force: true },
        )
        expect(model.state.audits.map((entry) => entry.action)).toEqual([
            'user.background_update_started',
            'user.background_updated',
        ])
    })

    it('preserves the durable intent without metadata success when legacy cleanup fails', async function () {
        image.rm.mockRejectedValueOnce(
            new Error('synthetic legacy cleanup failure'),
        )

        await expect(
            updateCurrentUserBackgroundService(imageInput),
        ).rejects.toThrow('synthetic legacy cleanup failure')

        expect(image.writePrivateFile).toHaveBeenCalledTimes(1)
        expect(image.rm).toHaveBeenCalledTimes(1)
        expect(image.rm).toHaveBeenCalledWith(
            image.paths.absoluteLegacyBackground,
            { force: true },
        )
        expect(model.state.rows.get('user_settings')).toEqual(previous)
        expect(model.state.events).not.toContain('insert:user_settings')
        expect(model.state.audits.map((entry) => entry.action)).toEqual([
            'user.background_update_started',
        ])
    })

    it('uses only the authenticated user for background and legacy paths', async function () {
        const foreignInput = {
            ...imageInput,
            userId: 'another-user',
            filePath: 'C:/synthetic/another-user/background.webp',
        }
        await updateCurrentUserBackgroundService(foreignInput)

        expect(image.getPaths).toHaveBeenCalledTimes(1)
        expect(image.getPaths).toHaveBeenCalledWith(AUDIT_TEST_ACTOR)
        expect(image.writePrivateFile).toHaveBeenCalledTimes(1)
        expect(image.writePrivateFile).toHaveBeenCalledWith({
            rootDirectory: image.paths.absolutePrivateStorageRoot,
            filePath: image.paths.absoluteBackground,
            data: image.encodedImage,
        })
        expect(image.rm).toHaveBeenCalledTimes(1)
        expect(image.rm).toHaveBeenCalledWith(
            image.paths.absoluteLegacyBackground,
            { force: true },
        )
        expect(
            model.state.audits.every(
                (entry) => entry.actorUserId === AUDIT_TEST_ACTOR,
            ),
        ).toBe(true)
    })

    it('deletes both background files and clears metadata with a correlated audit', async function () {
        await expect(deleteCurrentUserBackgroundService()).resolves.toEqual({
            success: true,
        })
        expect(image.rm).toHaveBeenCalledWith(image.paths.absoluteBackground, {
            force: true,
        })
        expect(image.rm).toHaveBeenCalledWith(
            image.paths.absoluteLegacyBackground,
            { force: true },
        )
        expect(model.state.rows.get('user_settings')).toEqual({
            userId: AUDIT_TEST_ACTOR,
            customBackgroundDarkness: null,
            customBackgroundUpdatedAt: null,
        })
        expect(model.state.audits[1]?.newValues?.operationId).toBe(
            model.state.audits[0]?.newValues?.operationId,
        )
        expect(model.state.audits).toHaveLength(2)
    })

    it('removes the legacy migration source before the private target and metadata', async function () {
        const entered = Promise.withResolvers<void>()
        const deletedLegacy = Promise.withResolvers<void>()
        image.rm.mockImplementationOnce(async function () {
            entered.resolve()
            await deletedLegacy.promise
        })

        const result = deleteCurrentUserBackgroundService()
        await entered.promise

        try {
            expect(image.rm).toHaveBeenCalledTimes(1)
            expect(image.rm).toHaveBeenCalledWith(
                image.paths.absoluteLegacyBackground,
                { force: true },
            )
            expect(model.state.rows.get('user_settings')).toEqual(previous)
            expect(model.state.events).not.toContain('insert:user_settings')
            expect(model.state.audits.map((entry) => entry.action)).toEqual([
                'user.background_delete_started',
            ])
        } finally {
            deletedLegacy.resolve()
            await result
        }

        expect(image.rm.mock.calls).toEqual([
            [image.paths.absoluteLegacyBackground, { force: true }],
            [image.paths.absoluteBackground, { force: true }],
        ])
        expect(model.state.rows.get('user_settings')).toEqual({
            userId: AUDIT_TEST_ACTOR,
            customBackgroundDarkness: null,
            customBackgroundUpdatedAt: null,
        })
    })

    it('does not delete the private target or metadata when legacy deletion fails', async function () {
        image.rm.mockRejectedValueOnce(
            new Error('synthetic legacy deletion failure'),
        )

        await expect(deleteCurrentUserBackgroundService()).rejects.toThrow(
            'synthetic legacy deletion failure',
        )

        expect(image.rm.mock.calls).toEqual([
            [image.paths.absoluteLegacyBackground, { force: true }],
        ])
        expect(model.state.rows.get('user_settings')).toEqual(previous)
        expect(model.state.events).not.toContain('insert:user_settings')
        expect(model.state.audits.map((entry) => entry.action)).toEqual([
            'user.background_delete_started',
        ])
    })

    it('rejects unauthenticated mutations before file access or transactions', async function () {
        getSession.mockResolvedValue(null)
        const results = await Promise.all(
            operations.map((operation) => operation.run()),
        )
        for (const result of results)
            expect(result).toMatchObject({ success: false })
        expect(
            await updateCurrentUserBackgroundAppearanceService({
                customBackgroundDarkness: 60,
            }),
        ).toMatchObject({ success: false })
        expect(model.database.transaction).not.toHaveBeenCalled()
        expect(image.getBuffer).not.toHaveBeenCalled()
        expect(image.toBuffer).not.toHaveBeenCalled()
        expect(image.writePrivateFile).not.toHaveBeenCalled()
        expect(image.rm).not.toHaveBeenCalled()
    })
})
