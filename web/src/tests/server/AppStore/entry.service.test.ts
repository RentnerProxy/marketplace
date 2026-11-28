import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { APP_STORE_CONFIG } from '@/config/app-store.config.ts'
import {
    restoreBunProperties,
    stubBunProperties,
} from '@/tests/shared/bunTestStubs.ts'
import { createQueuedDatabase } from '../Social/social-db.test.helpers.ts'

const DENIED = 'Diesen Store-Eintrag darfst du nicht bearbeiten.'
const IMAGE_ERROR = 'Bildfehler'
const appId = 'rentner.weather-widget'
const actorId = '019f72d1-dc60-7040-bdac-9e201573f001'
const generatedId = '019f72d1-dc60-7040-bdac-9e201573f0ff'
const previousId = '019f72d1-dc60-7040-bdac-9e201573f0aa'
const shotA = '019f72d1-dc60-7040-bdac-9e201573f0a1'
const shotB = '019f72d1-dc60-7040-bdac-9e201573f0a2'
const shotC = '019f72d1-dc60-7040-bdac-9e201573f0a3'
const crop = { x: 0, y: 0, width: 10, height: 10 }
const imageInput = { appId, imageDataUrl: 'data:image/png;base64,AA', crop }
const database = createQueuedDatabase()
const audits: Array<{ actorId: string | null; audit: unknown }> = []
let writeFailure: Error | null = null

function editorResult() {
    return {
        actorId,
        latestOwnOrAnySubmission: {
            status: 'published',
            request: { display: { name: 'Wetter' } },
        },
    }
}

const mocks = {
    resolveEditor: vi.fn(
        async (
            _appId: string,
        ): Promise<ReturnType<typeof editorResult> | null> => editorResult(),
    ),
    isPublished: vi.fn(async (_appId: string) => true),
    encode: vi.fn(async (..._args: Array<unknown>): Promise<Buffer | null> =>
        Buffer.from('webp'),
    ),
    write: vi.fn(async (..._args: Array<unknown>) => ''),
    remove: vi.fn(async (..._args: Array<unknown>) => {}),
    barrier: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}

vi.mock('@/db', () => ({ db: database.db }))
vi.mock('@/server/AppStore/access.service.ts', () => ({
    STORE_ACCESS_DENIED_MESSAGE: DENIED,
    resolveStoreEditorService: mocks.resolveEditor,
    isPublishedAppService: mocks.isPublished,
}))
vi.mock('@/server/AppStore/images.service.ts', () => ({
    STORE_IMAGE_ERROR_MESSAGE: IMAGE_ERROR,
    encodeStoreImageService: mocks.encode,
    writeStoreImageFileService: mocks.write,
    removeStoreImageFilesService: mocks.remove,
    getStoreImageSrc: (id: string, fileId: string | null) =>
        fileId ? `/images/apps/${id}/${fileId}.webp` : null,
}))
vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', () => ({
    withSharedStorageMutationBarrier: mocks.barrier,
}))
vi.mock('@/server/Marketplace/Submissions/submission-store.service.ts', () => ({
    auditedSubmissionWrite: async (
        id: string | null,
        operation: (tx: unknown) => Promise<{
            result: unknown
            audit?: unknown
        }>,
    ) => {
        if (writeFailure) throw writeFailure
        const outcome = await operation(database.db)
        audits.push({ actorId: id, audit: outcome.audit })
        return outcome.result
    },
}))

const service = await import('@/server/AppStore/entry.service.ts')

function setValues() {
    return database.calls
        .filter((call) => call.method === 'set')
        .map((call) => call.args[0])
}

function insertedValues() {
    return database.calls
        .filter((call) => call.method === 'values')
        .map((call) => call.args[0])
}

beforeEach(() => {
    database.reset()
    audits.length = 0
    writeFailure = null
    vi.clearAllMocks()
    mocks.resolveEditor.mockResolvedValue(editorResult())
    mocks.encode.mockResolvedValue(Buffer.from('webp'))
    stubBunProperties({ randomUUIDv7: () => generatedId })
})

afterEach(restoreBunProperties)

describe('store listing reads', () => {
    it('maps the entry and ordered screenshots to public paths', async () => {
        database.queue(
            [{ description: 'Text', logoFileId: previousId }],
            [{ id: shotA }, { id: shotB }],
        )
        await expect(service.readStoreListingService(appId)).resolves.toEqual({
            description: 'Text',
            logoSrc: `/images/apps/${appId}/${previousId}.webp`,
            screenshots: [
                { id: shotA, src: `/images/apps/${appId}/${shotA}.webp` },
                { id: shotB, src: `/images/apps/${appId}/${shotB}.webp` },
            ],
        })
    })

    it('returns an empty listing for apps without an entry', async () => {
        database.queue([], [])
        await expect(service.readStoreListingService(appId)).resolves.toEqual({
            description: null,
            logoSrc: null,
            screenshots: [],
        })
    })

    it('builds the editor view with status and published state', async () => {
        database.queue([{ description: null, logoFileId: null }], [])
        await expect(
            service.getStoreEntryEditorService({ appId }),
        ).resolves.toEqual({
            appId,
            name: 'Wetter',
            status: 'published',
            isPublished: true,
            description: '',
            logoSrc: null,
            screenshots: [],
        })
    })

    it('hides the editor from accounts that may not edit', async () => {
        mocks.resolveEditor.mockResolvedValue(null)
        await expect(
            service.getStoreEntryEditorService({ appId }),
        ).resolves.toBeNull()
        expect(database.calls).toHaveLength(0)
        expect(mocks.isPublished).not.toHaveBeenCalled()
    })

    it('lists own apps with their latest status and logo', async () => {
        database.queue([
            {
                appId,
                status: 'awaitingReview',
                request: { display: { name: 'Wetter' } },
                logoFileId: previousId,
            },
            {
                appId: 'rentner.other',
                status: 'submitted',
                request: { display: { name: 'Anderes' } },
                logoFileId: null,
            },
        ])
        await expect(
            service.listEditableStoreAppsService(actorId),
        ).resolves.toEqual([
            {
                appId,
                name: 'Wetter',
                status: 'awaitingReview',
                logoSrc: `/images/apps/${appId}/${previousId}.webp`,
            },
            {
                appId: 'rentner.other',
                name: 'Anderes',
                status: 'submitted',
                logoSrc: null,
            },
        ])
        expect(database.methods()).toContain('selectDistinctOn')
        expect(
            database.calls.find((call) => call.method === 'limit')?.args,
        ).toEqual([APP_STORE_CONFIG.catalogLimit])
    })
})

describe('store description', () => {
    it('stores the description and audits its length', async () => {
        database.queue([{ logoFileId: null }], [])
        await expect(
            service.updateStoreDescriptionService({
                appId,
                description: 'Hallo',
            }),
        ).resolves.toEqual({ success: true })
        expect(setValues()).toContainEqual({ description: 'Hallo' })
        expect(audits).toEqual([
            {
                actorId,
                audit: {
                    action: 'marketplace.store.description_updated',
                    newValues: { appId, length: 5 },
                },
            },
        ])
    })

    it('stores an empty description as null', async () => {
        database.queue([{ logoFileId: null }], [])
        await service.updateStoreDescriptionService({ appId, description: '' })
        expect(setValues()).toContainEqual({ description: null })
        expect(audits[0]?.audit).toMatchObject({
            newValues: { appId, length: 0 },
        })
    })

    it('denies non-editors without writing anything', async () => {
        mocks.resolveEditor.mockResolvedValue(null)
        await expect(
            service.updateStoreDescriptionService({ appId, description: 'x' }),
        ).resolves.toEqual({ success: false, error: DENIED })
        expect(database.calls).toHaveLength(0)
        expect(audits).toHaveLength(0)
    })
})

describe('store logo', () => {
    it('writes the file, saves it and removes the previous logo', async () => {
        database.queue([{ logoFileId: previousId }], [])
        await expect(
            service.uploadStoreLogoService(imageInput),
        ).resolves.toEqual({ success: true })
        expect(mocks.encode).toHaveBeenCalledWith(
            imageInput.imageDataUrl,
            crop,
            'logo',
        )
        expect(mocks.write).toHaveBeenCalledWith(
            appId,
            generatedId,
            Buffer.from('webp'),
        )
        expect(setValues()).toContainEqual({ logoFileId: generatedId })
        expect(mocks.remove).toHaveBeenCalledTimes(1)
        expect(mocks.remove).toHaveBeenCalledWith(appId, [previousId])
        expect(audits[0]?.audit).toEqual({
            action: 'marketplace.store.logo_updated',
            newValues: { appId, fileId: generatedId },
        })
    })

    it('keeps all files when there was no previous logo', async () => {
        database.queue([{ logoFileId: null }], [])
        await service.uploadStoreLogoService(imageInput)
        expect(mocks.remove).not.toHaveBeenCalled()
    })

    it('reports image encoding failures without any write', async () => {
        mocks.encode.mockResolvedValue(null)
        await expect(
            service.uploadStoreLogoService(imageInput),
        ).resolves.toEqual({ success: false, error: IMAGE_ERROR })
        expect(mocks.write).not.toHaveBeenCalled()
        expect(mocks.remove).not.toHaveBeenCalled()
        expect(database.calls).toHaveLength(0)
        expect(audits).toHaveLength(0)
    })

    it('removes the new file when the database write fails', async () => {
        const failure = new Error('db down')
        writeFailure = failure
        await expect(service.uploadStoreLogoService(imageInput)).rejects.toBe(
            failure,
        )
        expect(mocks.write).toHaveBeenCalledTimes(1)
        expect(mocks.remove).toHaveBeenCalledTimes(1)
        expect(mocks.remove).toHaveBeenCalledWith(appId, [generatedId])
    })

    it('denies non-editors before encoding or writing', async () => {
        mocks.resolveEditor.mockResolvedValue(null)
        await expect(
            service.uploadStoreLogoService(imageInput),
        ).resolves.toEqual({ success: false, error: DENIED })
        expect(mocks.encode).not.toHaveBeenCalled()
        expect(mocks.write).not.toHaveBeenCalled()
        expect(database.calls).toHaveLength(0)
    })

    it('clears the logo and deletes its file', async () => {
        database.queue([{ logoFileId: previousId }], [])
        await expect(
            service.removeStoreLogoService({ appId }),
        ).resolves.toEqual({ success: true })
        expect(setValues()).toContainEqual({ logoFileId: null })
        expect(mocks.remove).toHaveBeenCalledWith(appId, [previousId])
        expect(audits[0]?.audit).toEqual({
            action: 'marketplace.store.logo_removed',
            newValues: { appId, fileId: previousId },
        })
    })

    it('does not audit or delete anything without a logo', async () => {
        database.queue([{ logoFileId: null }], [])
        await expect(
            service.removeStoreLogoService({ appId }),
        ).resolves.toEqual({ success: true })
        expect(mocks.remove).not.toHaveBeenCalled()
        expect(audits[0]?.audit).toBeUndefined()
    })

    it('denies logo removal for non-editors', async () => {
        mocks.resolveEditor.mockResolvedValue(null)
        await expect(
            service.removeStoreLogoService({ appId }),
        ).resolves.toEqual({ success: false, error: DENIED })
        expect(database.calls).toHaveLength(0)
        expect(mocks.remove).not.toHaveBeenCalled()
    })
})

describe('store screenshots', () => {
    it('appends a screenshot at the next position', async () => {
        database.queue([{ logoFileId: null }], [{ value: 3 }], [])
        await expect(
            service.addStoreScreenshotService(imageInput),
        ).resolves.toEqual({ success: true })
        expect(mocks.encode).toHaveBeenCalledWith(
            imageInput.imageDataUrl,
            crop,
            'screenshot',
        )
        expect(mocks.write).toHaveBeenCalledWith(
            appId,
            generatedId,
            Buffer.from('webp'),
        )
        expect(insertedValues()).toContainEqual({
            id: generatedId,
            appId,
            position: 3,
        })
        expect(mocks.remove).not.toHaveBeenCalled()
        expect(audits[0]?.audit).toEqual({
            action: 'marketplace.store.screenshot_added',
            newValues: { appId, screenshotId: generatedId },
        })
    })

    it('rejects the ninth screenshot and removes the new file again', async () => {
        database.queue([{ logoFileId: null }], [{ value: 8 }])
        await expect(
            service.addStoreScreenshotService(imageInput),
        ).resolves.toEqual({
            success: false,
            error: 'Es sind höchstens 8 Screenshots erlaubt.',
        })
        expect(insertedValues()).not.toContainEqual(
            expect.objectContaining({ id: generatedId }),
        )
        expect(mocks.remove).toHaveBeenCalledWith(appId, [generatedId])
        expect(audits).toHaveLength(0)
    })

    it('removes the new file and rethrows other write errors', async () => {
        const failure = new Error('db down')
        writeFailure = failure
        await expect(
            service.addStoreScreenshotService(imageInput),
        ).rejects.toBe(failure)
        expect(mocks.remove).toHaveBeenCalledWith(appId, [generatedId])
    })

    it('reports image encoding failures without any write', async () => {
        mocks.encode.mockResolvedValue(null)
        await expect(
            service.addStoreScreenshotService(imageInput),
        ).resolves.toEqual({ success: false, error: IMAGE_ERROR })
        expect(mocks.write).not.toHaveBeenCalled()
        expect(database.calls).toHaveLength(0)
    })

    it('denies non-editors before encoding or writing', async () => {
        mocks.resolveEditor.mockResolvedValue(null)
        await expect(
            service.addStoreScreenshotService(imageInput),
        ).resolves.toEqual({ success: false, error: DENIED })
        expect(mocks.encode).not.toHaveBeenCalled()
        expect(mocks.write).not.toHaveBeenCalled()
    })

    it('removes a screenshot, renumbers the rest and deletes its file', async () => {
        database.queue(
            [{ logoFileId: null }],
            [{ id: shotB }],
            [{ id: shotA }, { id: shotC }],
            [],
        )
        await expect(
            service.removeStoreScreenshotService({
                appId,
                screenshotId: shotB,
            }),
        ).resolves.toEqual({ success: true })
        expect(database.methods()).toContain('delete')
        expect(database.methods()).toContain('update')
        expect(mocks.remove).toHaveBeenCalledWith(appId, [shotB])
        expect(audits[0]?.audit).toEqual({
            action: 'marketplace.store.screenshot_removed',
            newValues: { appId, screenshotId: shotB },
        })
    })

    it('skips renumbering when the last screenshot is removed', async () => {
        database.queue([{ logoFileId: null }], [{ id: shotA }], [])
        await service.removeStoreScreenshotService({
            appId,
            screenshotId: shotA,
        })
        expect(database.methods()).not.toContain('update')
        expect(mocks.remove).toHaveBeenCalledWith(appId, [shotA])
    })

    it('ignores screenshots that do not belong to the app', async () => {
        database.queue([{ logoFileId: null }], [])
        await expect(
            service.removeStoreScreenshotService({
                appId,
                screenshotId: shotA,
            }),
        ).resolves.toEqual({ success: true })
        expect(mocks.remove).not.toHaveBeenCalled()
        expect(audits[0]?.audit).toBeUndefined()
    })

    it('denies screenshot removal for non-editors', async () => {
        mocks.resolveEditor.mockResolvedValue(null)
        await expect(
            service.removeStoreScreenshotService({
                appId,
                screenshotId: shotA,
            }),
        ).resolves.toEqual({ success: false, error: DENIED })
        expect(database.calls).toHaveLength(0)
        expect(mocks.remove).not.toHaveBeenCalled()
    })
})

describe('store screenshot order', () => {
    it('applies a permutation of the stored screenshots', async () => {
        database.queue(
            [{ logoFileId: null }],
            [{ id: shotA }, { id: shotB }, { id: shotC }],
            [],
        )
        await expect(
            service.reorderStoreScreenshotsService({
                appId,
                screenshotIds: [shotC, shotA, shotB],
            }),
        ).resolves.toEqual({ success: true })
        expect(database.methods()).toContain('update')
        expect(audits[0]?.audit).toEqual({
            action: 'marketplace.store.screenshots_reordered',
            newValues: { appId, screenshotIds: [shotC, shotA, shotB] },
        })
    })

    it.each([
        [
            'an unknown id',
            [shotA, shotB, '019f72d1-dc60-7040-bdac-9e201573f0a9'],
        ],
        ['a missing id', [shotA, shotB]],
        ['an additional id', [shotA, shotB, shotC, previousId]],
    ])('rejects a request with %s', async (_name, screenshotIds) => {
        database.queue(
            [{ logoFileId: null }],
            [{ id: shotA }, { id: shotB }, { id: shotC }],
        )
        await expect(
            service.reorderStoreScreenshotsService({ appId, screenshotIds }),
        ).resolves.toEqual({
            success: false,
            error: 'Die Screenshots haben sich zwischenzeitlich geändert. Bitte lade die Seite neu.',
        })
        expect(database.methods()).not.toContain('update')
        expect(audits[0]?.audit).toBeUndefined()
    })

    it('denies reordering for non-editors', async () => {
        mocks.resolveEditor.mockResolvedValue(null)
        await expect(
            service.reorderStoreScreenshotsService({
                appId,
                screenshotIds: [shotA],
            }),
        ).resolves.toEqual({ success: false, error: DENIED })
        expect(database.calls).toHaveLength(0)
    })
})
