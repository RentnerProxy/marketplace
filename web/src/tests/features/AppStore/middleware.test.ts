import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { RATE_LIMITS } from '@/config/security.config.ts'

const sessionUser = { id: '019f72d1-dc60-7040-bdac-9e201573f001' }
const appId = 'rentner.weather-widget'
const shotA = '019f72d1-dc60-7040-bdac-9e201573f0a1'
const shotB = '019f72d1-dc60-7040-bdac-9e201573f0a2'
const crop = { x: 0, y: 0, width: 10, height: 10 }
const imageData = { appId, imageDataUrl: 'data:image/png;base64,AAAA', crop }

const calls: Array<string> = []
const mocks = {
    requireAccess: vi.fn(async () => {
        calls.push('auth')
        return { sessionUser, permissionKeys: [] }
    }),
    viewerId: vi.fn(async (): Promise<string | null> => null),
    rateLimit: vi.fn(async (_options: unknown) => {
        calls.push('rate-limit')
    }),
    detail: vi.fn(async (..._args: Array<unknown>) => null),
    published: vi.fn(async (..._args: Array<unknown>) => []),
    editor: vi.fn(async (..._args: Array<unknown>) => null),
    editable: vi.fn(async (..._args: Array<unknown>) => []),
    description: vi.fn(async (..._args: Array<unknown>) => ({
        success: true,
    })),
    uploadLogo: vi.fn(async (..._args: Array<unknown>) => ({ success: true })),
    removeLogo: vi.fn(async (..._args: Array<unknown>) => ({ success: true })),
    addShot: vi.fn(async (..._args: Array<unknown>) => ({ success: true })),
    removeShot: vi.fn(async (..._args: Array<unknown>) => ({ success: true })),
    reorder: vi.fn(async (..._args: Array<unknown>) => ({ success: true })),
}

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => ({
        validator: (validate: (input: unknown) => unknown) => ({
            handler:
                (operation: (context: { data: unknown }) => Promise<unknown>) =>
                async (input: { data: unknown }) =>
                    operation({ data: validate(input.data) }),
        }),
        handler: (operation: () => Promise<unknown>) => async () => operation(),
    }),
}))
vi.mock('@/server/Auth/authorization.service.ts', () => ({
    requireAuthenticatedFeatureAccessService: mocks.requireAccess,
}))
vi.mock('@/server/Auth/currentSession.ts', () => ({
    getCurrentSessionUserId: mocks.viewerId,
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: mocks.rateLimit,
}))
vi.mock('@/server/AppStore/catalog.service.ts', () => ({
    getAppDetailService: mocks.detail,
    listPublishedAppsService: mocks.published,
}))
vi.mock('@/server/AppStore/entry.service.ts', () => ({
    getStoreEntryEditorService: mocks.editor,
    listEditableStoreAppsService: mocks.editable,
    updateStoreDescriptionService: mocks.description,
    uploadStoreLogoService: mocks.uploadLogo,
    removeStoreLogoService: mocks.removeLogo,
    addStoreScreenshotService: mocks.addShot,
    removeStoreScreenshotService: mocks.removeShot,
    reorderStoreScreenshotsService: mocks.reorder,
}))

const handlers = await import('@/features/AppStore/middleware.ts')

const editLimit = {
    ...RATE_LIMITS.appStoreEdit,
    scope: 'app-store-edit',
    identifiers: [sessionUser.id],
    includeClientIp: false,
}

beforeEach(() => {
    vi.clearAllMocks()
    calls.length = 0
    mocks.viewerId.mockResolvedValue(null)
})

describe('public store reads', () => {
    it('serves app details anonymously behind the read rate limit', async () => {
        mocks.viewerId.mockResolvedValue(sessionUser.id)
        await handlers.getAppDetailHandler({ data: { appId } })
        expect(mocks.requireAccess).not.toHaveBeenCalled()
        expect(mocks.rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.appStoreRead,
            scope: 'app-store-read',
        })
        expect(mocks.detail).toHaveBeenCalledWith({ appId }, sessionUser.id)
    })

    it('lists published apps anonymously behind the read rate limit', async () => {
        await handlers.listPublishedAppsHandler()
        expect(mocks.requireAccess).not.toHaveBeenCalled()
        expect(mocks.rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.appStoreRead,
            scope: 'app-store-read',
        })
        expect(mocks.published).toHaveBeenCalledWith(null)
    })

    it('rejects invalid app ids before the rate limit and service', async () => {
        await expect(
            handlers.getAppDetailHandler({ data: { appId: '../x' } }),
        ).rejects.toThrow()
        expect(mocks.rateLimit).not.toHaveBeenCalled()
        expect(mocks.detail).not.toHaveBeenCalled()
    })
})

describe('authenticated store reads', () => {
    it('requires a session for the own app overview', async () => {
        await handlers.listEditableStoreAppsHandler()
        expect(mocks.requireAccess).toHaveBeenCalledTimes(1)
        expect(mocks.editable).toHaveBeenCalledWith(sessionUser.id)
    })

    it('passes the app id to the editor read, whose service checks access', async () => {
        await handlers.getStoreEntryEditorHandler({ data: { appId } })
        expect(mocks.editor).toHaveBeenCalledWith({ appId })
    })

    it('stops the app overview when authentication fails', async () => {
        const error = new Error('Authentication required')
        mocks.requireAccess.mockRejectedValueOnce(error)
        await expect(handlers.listEditableStoreAppsHandler()).rejects.toBe(
            error,
        )
        expect(mocks.editable).not.toHaveBeenCalled()
    })
})

describe('store edits', () => {
    it.each([
        [
            'description',
            () =>
                handlers.updateStoreDescriptionHandler({
                    data: { appId, description: ' Text ' },
                }),
            mocks.description,
            { appId, description: 'Text' },
        ],
        [
            'logo upload',
            () => handlers.uploadStoreLogoHandler({ data: imageData }),
            mocks.uploadLogo,
            imageData,
        ],
        [
            'logo removal',
            () => handlers.removeStoreLogoHandler({ data: { appId } }),
            mocks.removeLogo,
            { appId },
        ],
        [
            'screenshot upload',
            () => handlers.addStoreScreenshotHandler({ data: imageData }),
            mocks.addShot,
            imageData,
        ],
        [
            'screenshot removal',
            () =>
                handlers.removeStoreScreenshotHandler({
                    data: { appId, screenshotId: shotA },
                }),
            mocks.removeShot,
            { appId, screenshotId: shotA },
        ],
        [
            'screenshot reorder',
            () =>
                handlers.reorderStoreScreenshotsHandler({
                    data: { appId, screenshotIds: [shotB, shotA] },
                }),
            mocks.reorder,
            { appId, screenshotIds: [shotB, shotA] },
        ],
    ])(
        'authenticates and rate limits %s per account before the service',
        async (_name, run, service, expected) => {
            await run()
            expect(mocks.rateLimit).toHaveBeenCalledWith(editLimit)
            expect(service).toHaveBeenCalledWith(expected)
            expect(calls).toEqual(['auth', 'rate-limit'])
        },
    )

    it.each([
        ['an unauthenticated session', 'auth'],
        ['an exhausted rate limit', 'rate-limit'],
    ])('stops before the service on %s', async (_name, failing) => {
        const error = new Error('blocked')
        if (failing === 'auth') mocks.requireAccess.mockRejectedValueOnce(error)
        else mocks.rateLimit.mockRejectedValueOnce(error)
        await expect(
            handlers.updateStoreDescriptionHandler({
                data: { appId, description: 'x' },
            }),
        ).rejects.toBe(error)
        expect(mocks.description).not.toHaveBeenCalled()
    })

    it('rejects invalid input before authentication and services', async () => {
        const ids = Array.from(
            { length: 9 },
            (_, index) => `019f72d1-dc60-7040-bdac-9e201573f0b${index}`,
        )
        const invalid = [
            handlers.removeStoreLogoHandler({ data: { appId: 'Not An App' } }),
            handlers.updateStoreDescriptionHandler({
                data: { appId, description: 'a'.repeat(5001) },
            }),
            handlers.reorderStoreScreenshotsHandler({
                data: { appId, screenshotIds: ids },
            }),
            handlers.reorderStoreScreenshotsHandler({
                data: { appId, screenshotIds: [shotA, shotA] },
            }),
            handlers.removeStoreScreenshotHandler({
                data: { appId, screenshotId: 'nope' },
            }),
            handlers.uploadStoreLogoHandler({
                data: {
                    ...imageData,
                    imageDataUrl: 'data:text/html;base64,AA',
                },
            }),
        ]
        await Promise.all(invalid.map((call) => expect(call).rejects.toThrow()))
        expect(mocks.requireAccess).not.toHaveBeenCalled()
        expect(mocks.rateLimit).not.toHaveBeenCalled()
        expect(mocks.description).not.toHaveBeenCalled()
        expect(mocks.reorder).not.toHaveBeenCalled()
        expect(mocks.removeLogo).not.toHaveBeenCalled()
    })
})
