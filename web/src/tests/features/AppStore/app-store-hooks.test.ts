import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '@/tests/layouts/hook-harness.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type { StoreMutationResult } from '@/features/AppStore/Types/app-store.types.ts'

const appId = 'rentner.weather-widget'
const shotA = '019f72d1-dc60-7040-bdac-9e201573f0a1'
const shotB = '019f72d1-dc60-7040-bdac-9e201573f0a2'
const shotC = '019f72d1-dc60-7040-bdac-9e201573f0a3'
const imageSrc = 'data:image/png;base64,AAAA'
const croppedAreaPixels = { x: 1, y: 2, width: 30, height: 40 }
const screenshots = [shotA, shotB, shotC].map((id) => ({
    id,
    src: `/images/apps/${appId}/${id}.webp`,
}))

const pending: Array<Promise<unknown>> = []
const queryResults = new Map<string, unknown>()
const invalidate = vi.fn(async (_filters: unknown) => {})
const success = vi.fn()
const failure = vi.fn()
const transfer = { complete: vi.fn(), fail: vi.fn() }
const startTransfer = vi.fn((_options: unknown) => transfer)
const ok = { success: true } as const satisfies StoreMutationResult

const handlers = {
    uploadLogo: vi.fn(async (_input: unknown) => ok as StoreMutationResult),
    removeLogo: vi.fn(async (_input: unknown) => ok as StoreMutationResult),
    description: vi.fn(async (_input: unknown) => ok as StoreMutationResult),
    addShot: vi.fn(async (_input: unknown) => ok as StoreMutationResult),
    removeShot: vi.fn(async (_input: unknown) => ok as StoreMutationResult),
    reorder: vi.fn(async (_input: unknown) => ok as StoreMutationResult),
}
const selection = {
    state: {
        imageSrc: null as string | null,
        croppedAreaPixels: null as typeof croppedAreaPixels | null,
        crop: { x: 0, y: 0 },
        zoom: 1,
    },
    handler: {
        handleSelectImage: vi.fn(),
        handleCropComplete: vi.fn(),
        handleResetSelection: vi.fn(),
    },
    setter: { setCrop: vi.fn(), setZoom: vi.fn() },
}

vi.mock('react', () => hookReact)
vi.mock('@tanstack/react-query', () => ({
    queryOptions: (options: unknown) => options,
    useQuery: (options: { queryKey: ReadonlyArray<unknown> }) => ({
        data: queryResults.get(String(options.queryKey[1])),
        isLoading: queryResults.get('loading') === true,
    }),
    useQueryClient: () => ({ invalidateQueries: invalidate }),
    useMutation: (options: {
        mutationFn: (variables?: unknown) => Promise<unknown>
        onSuccess?: (result: unknown) => unknown
        onError?: (error: unknown) => unknown
    }) => ({
        isPending: false,
        mutate(variables?: unknown) {
            pending.push(
                options
                    .mutationFn(variables)
                    .then((result) => options.onSuccess?.(result))
                    .catch((error) => options.onError?.(error)),
            )
        },
    }),
}))
vi.mock('@rentnerkev/toasts', () => ({ toast: { success } }))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({ toastAppError: failure }))
vi.mock('@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts', () => ({
    startTransferTask: startTransfer,
}))
vi.mock('@/shared/Images/Hooks/useImageCropSelection.ts', () => ({
    default: () => selection,
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        language: 'de',
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
vi.mock('@/lib/AppStore/appStoreQueries.ts', () => ({
    APP_STORE_QUERY_KEY: ['app-store'],
    appDetailQueryOptions: (id: string) => ({
        queryKey: ['app-store', 'detail', id],
    }),
    storeEntryEditorQueryOptions: (id: string) => ({
        queryKey: ['app-store', 'editor', id],
    }),
    editableStoreAppsQueryOptions: () => ({
        queryKey: ['app-store', 'editable'],
    }),
}))
vi.mock('@/lib/Social/socialQueries.ts', () => ({
    SOCIAL_QUERY_KEY: ['social'],
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({ queryKey: ['auth', 'session'] }),
}))
vi.mock('@/features/AppStore/middleware.ts', () => ({
    uploadStoreLogoHandler: handlers.uploadLogo,
    removeStoreLogoHandler: handlers.removeLogo,
    updateStoreDescriptionHandler: handlers.description,
    addStoreScreenshotHandler: handlers.addShot,
    removeStoreScreenshotHandler: handlers.removeShot,
    reorderStoreScreenshotsHandler: handlers.reorder,
}))

const { default: useStoreMutationFeedback } =
    await import('@/features/AppStore/Hooks/useStoreMutationFeedback.ts')
const { default: useStoreLogoLogic } =
    await import('@/features/AppStore/Hooks/useStoreLogoLogic.ts')
const { default: useStoreScreenshotsLogic } =
    await import('@/features/AppStore/Hooks/useStoreScreenshotsLogic.ts')
const { default: useStoreDescriptionLogic } =
    await import('@/features/AppStore/Hooks/useStoreDescriptionLogic.ts')
const { default: useScreenshotGalleryLogic } =
    await import('@/features/AppStore/Hooks/useScreenshotGalleryLogic.ts')
const { default: useAppDetailPageLogic } =
    await import('@/features/AppStore/Hooks/useAppDetailPageLogic.ts')
const { default: useEditableStoreAppsLogic } =
    await import('@/features/AppStore/Hooks/useEditableStoreAppsLogic.ts')
const { default: useStoreEditorPageLogic } =
    await import('@/features/AppStore/Hooks/useStoreEditorPageLogic.ts')

async function settle() {
    await Promise.all(pending.splice(0))
}

function selectCroppedImage() {
    selection.state.imageSrc = imageSrc
    selection.state.croppedAreaPixels = croppedAreaPixels
}

beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    queryResults.clear()
    selection.state.imageSrc = null
    selection.state.croppedAreaPixels = null
    for (const handler of Object.values(handlers)) {
        handler.mockResolvedValue(ok)
    }
})
afterEach(restoreTestGlobals)

describe('store mutation feedback', () => {
    it('confirms successes with a toast and refreshes store and social data', async () => {
        const feedback = renderHook(useStoreMutationFeedback)
        await expect(
            feedback.handleResult(ok, 'appStore.logo.saved'),
        ).resolves.toBe(true)
        expect(success).toHaveBeenCalledWith('appStore.logo.saved', {
            title: 'appStore.title',
        })
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['app-store'] })
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['social'] })
    })

    it('reports refused results as app errors without refreshing', async () => {
        const feedback = renderHook(useStoreMutationFeedback)
        await expect(
            feedback.handleResult(
                { success: false, error: 'Nicht erlaubt' },
                'appStore.logo.saved',
            ),
        ).resolves.toBe(false)
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Nicht erlaubt' }),
        )
        expect(success).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()
    })

    it('exposes the shared error toast', () => {
        expect(renderHook(useStoreMutationFeedback).onError).toBe(failure)
    })

    it('tracks a successful upload in the transfer overlay', async () => {
        const feedback = renderHook(useStoreMutationFeedback)
        const result = await feedback.runUpload(
            imageSrc,
            'Titel',
            async () => ok,
        )
        expect(result).toEqual(ok)
        expect(startTransfer).toHaveBeenCalledWith({
            direction: 'upload',
            title: 'Titel',
            totalBytes: 3,
        })
        expect(transfer.complete).toHaveBeenCalledWith('Titel')
        expect(transfer.fail).not.toHaveBeenCalled()
    })

    it('fails the transfer for refused and thrown uploads', async () => {
        const feedback = renderHook(useStoreMutationFeedback)
        await feedback.runUpload(imageSrc, 'Titel', async () => ({
            success: false,
            error: 'Zu groß',
        }))
        expect(transfer.fail).toHaveBeenCalledWith('Zu groß')

        const error = new Error('network')
        await expect(
            feedback.runUpload(imageSrc, 'Titel', async () => {
                throw error
            }),
        ).rejects.toBe(error)
        expect(transfer.fail).toHaveBeenCalledWith('appStore.uploadFailed')
        expect(transfer.complete).not.toHaveBeenCalled()
    })
})

describe('store logo logic', () => {
    it('uploads the cropped logo, confirms and resets the selection', async () => {
        selectCroppedImage()
        renderHook(() => useStoreLogoLogic(appId)).handler.handleSaveLogo()
        await settle()
        expect(handlers.uploadLogo).toHaveBeenCalledWith({
            data: { appId, imageDataUrl: imageSrc, crop: croppedAreaPixels },
        })
        expect(startTransfer).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'appStore.logo.save' }),
        )
        expect(success).toHaveBeenCalledWith('appStore.logo.saved', {
            title: 'appStore.title',
        })
        expect(selection.handler.handleResetSelection).toHaveBeenCalled()
    })

    it('keeps the selection when the upload is refused', async () => {
        selectCroppedImage()
        handlers.uploadLogo.mockResolvedValueOnce({
            success: false,
            error: 'Bild ungültig',
        })
        renderHook(() => useStoreLogoLogic(appId)).handler.handleSaveLogo()
        await settle()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Bild ungültig' }),
        )
        expect(selection.handler.handleResetSelection).not.toHaveBeenCalled()
    })

    it('does not upload without a selected image and crop', async () => {
        renderHook(() => useStoreLogoLogic(appId)).handler.handleSaveLogo()
        await settle()
        expect(handlers.uploadLogo).not.toHaveBeenCalled()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'appStore.noImage' }),
        )
    })

    it('reports thrown upload errors', async () => {
        selectCroppedImage()
        const error = new Error('network')
        handlers.uploadLogo.mockRejectedValueOnce(error)
        renderHook(() => useStoreLogoLogic(appId)).handler.handleSaveLogo()
        await settle()
        expect(failure).toHaveBeenCalledWith(error)
    })

    it('confirms the removal dialog, removes the logo and closes it', async () => {
        let logic = renderHook(() => useStoreLogoLogic(appId))
        logic.handler.handleOpenRemoveLogo()
        logic = renderHook(() => useStoreLogoLogic(appId))
        expect(logic.state.isRemoveDialogOpen).toBe(true)

        logic.handler.handleConfirmRemoveLogo()
        await settle()
        expect(handlers.removeLogo).toHaveBeenCalledWith({ data: { appId } })
        expect(success).toHaveBeenCalledWith('appStore.logo.removed', {
            title: 'appStore.title',
        })
        logic = renderHook(() => useStoreLogoLogic(appId))
        expect(logic.state.isRemoveDialogOpen).toBe(false)
    })

    it('keeps the dialog open when the removal is refused and can close it', async () => {
        let logic = renderHook(() => useStoreLogoLogic(appId))
        logic.handler.handleOpenRemoveLogo()
        handlers.removeLogo.mockResolvedValueOnce({
            success: false,
            error: 'Nicht erlaubt',
        })
        logic = renderHook(() => useStoreLogoLogic(appId))
        logic.handler.handleConfirmRemoveLogo()
        await settle()
        logic = renderHook(() => useStoreLogoLogic(appId))
        expect(logic.state.isRemoveDialogOpen).toBe(true)

        logic.handler.handleCloseRemoveLogo()
        expect(
            renderHook(() => useStoreLogoLogic(appId)).state.isRemoveDialogOpen,
        ).toBe(false)
    })

    it('passes the crop controls through to the selection', () => {
        const logic = renderHook(() => useStoreLogoLogic(appId))
        expect(logic.handler.handleCropChange).toBe(selection.setter.setCrop)
        expect(logic.handler.handleZoomChange).toBe(selection.setter.setZoom)
        expect(logic.handler.handleCancelLogo).toBe(
            selection.handler.handleResetSelection,
        )
    })
})

describe('store screenshots logic', () => {
    it('swaps a screenshot with its neighbour and saves the new order', async () => {
        const logic = renderHook(() =>
            useStoreScreenshotsLogic(appId, screenshots),
        )
        logic.handler.handleMove(0, 1)
        await settle()
        expect(handlers.reorder).toHaveBeenCalledWith({
            data: { appId, screenshotIds: [shotB, shotA, shotC] },
        })
        expect(success).toHaveBeenCalledWith('appStore.screenshots.reordered', {
            title: 'appStore.title',
        })

        logic.handler.handleMove(2, -1)
        await settle()
        expect(handlers.reorder).toHaveBeenLastCalledWith({
            data: { appId, screenshotIds: [shotA, shotC, shotB] },
        })
    })

    it('ignores moves beyond either end', async () => {
        const logic = renderHook(() =>
            useStoreScreenshotsLogic(appId, screenshots),
        )
        logic.handler.handleMove(0, -1)
        logic.handler.handleMove(2, 1)
        logic.handler.handleMove(7, -1)
        await settle()
        expect(handlers.reorder).not.toHaveBeenCalled()
    })

    it('allows adding screenshots only below the limit', () => {
        expect(
            renderHook(() => useStoreScreenshotsLogic(appId, screenshots)).state
                .canAdd,
        ).toBe(true)
        const full = Array.from({ length: 8 }, (_, index) => ({
            id: `id-${index}`,
            src: `/s${index}.webp`,
        }))
        expect(
            renderHook(() => useStoreScreenshotsLogic(appId, full)).state
                .canAdd,
        ).toBe(false)
    })

    it('uploads the cropped screenshot, confirms and resets the selection', async () => {
        selectCroppedImage()
        renderHook(() =>
            useStoreScreenshotsLogic(appId, screenshots),
        ).handler.handleSaveScreenshot()
        await settle()
        expect(handlers.addShot).toHaveBeenCalledWith({
            data: { appId, imageDataUrl: imageSrc, crop: croppedAreaPixels },
        })
        expect(success).toHaveBeenCalledWith('appStore.screenshots.saved', {
            title: 'appStore.title',
        })
        expect(selection.handler.handleResetSelection).toHaveBeenCalled()
    })

    it('keeps the selection when the screenshot limit refuses the upload', async () => {
        selectCroppedImage()
        handlers.addShot.mockResolvedValueOnce({
            success: false,
            error: 'Es sind höchstens 8 Screenshots erlaubt.',
        })
        renderHook(() =>
            useStoreScreenshotsLogic(appId, screenshots),
        ).handler.handleSaveScreenshot()
        await settle()
        expect(failure).toHaveBeenCalled()
        expect(selection.handler.handleResetSelection).not.toHaveBeenCalled()
    })

    it('does not upload without a selected image', async () => {
        renderHook(() =>
            useStoreScreenshotsLogic(appId, screenshots),
        ).handler.handleSaveScreenshot()
        await settle()
        expect(handlers.addShot).not.toHaveBeenCalled()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'appStore.noImage' }),
        )
    })

    it('removes the chosen screenshot after confirmation and closes the dialog', async () => {
        let logic = renderHook(() =>
            useStoreScreenshotsLogic(appId, screenshots),
        )
        logic.handler.handleOpenRemove(shotB)
        logic = renderHook(() => useStoreScreenshotsLogic(appId, screenshots))
        expect(logic.state.removeId).toBe(shotB)

        logic.handler.handleConfirmRemove()
        await settle()
        expect(handlers.removeShot).toHaveBeenCalledWith({
            data: { appId, screenshotId: shotB },
        })
        expect(success).toHaveBeenCalledWith('appStore.screenshots.removed', {
            title: 'appStore.title',
        })
        logic = renderHook(() => useStoreScreenshotsLogic(appId, screenshots))
        expect(logic.state.removeId).toBeNull()
    })

    it('does nothing when confirming without a chosen screenshot', async () => {
        renderHook(() =>
            useStoreScreenshotsLogic(appId, screenshots),
        ).handler.handleConfirmRemove()
        await settle()
        expect(handlers.removeShot).not.toHaveBeenCalled()
    })

    it('can cancel the removal dialog', () => {
        let logic = renderHook(() =>
            useStoreScreenshotsLogic(appId, screenshots),
        )
        logic.handler.handleOpenRemove(shotA)
        logic = renderHook(() => useStoreScreenshotsLogic(appId, screenshots))
        logic.handler.handleCloseRemove()
        expect(
            renderHook(() => useStoreScreenshotsLogic(appId, screenshots)).state
                .removeId,
        ).toBeNull()
    })
})

describe('store description logic', () => {
    it('tracks changes ignoring surrounding whitespace', () => {
        let logic = renderHook(() => useStoreDescriptionLogic(appId, 'Alt'))
        expect(logic.state).toMatchObject({ value: 'Alt', hasChanged: false })

        logic.handler.handleChange('  Alt  ')
        logic = renderHook(() => useStoreDescriptionLogic(appId, 'Alt'))
        expect(logic.state.hasChanged).toBe(false)

        logic.handler.handleChange('Neu')
        logic = renderHook(() => useStoreDescriptionLogic(appId, 'Alt'))
        expect(logic.state).toMatchObject({ value: 'Neu', hasChanged: true })

        logic.handler.handleReset()
        logic = renderHook(() => useStoreDescriptionLogic(appId, 'Alt'))
        expect(logic.state).toMatchObject({ value: 'Alt', hasChanged: false })
    })

    it('saves the current text and confirms with a toast', async () => {
        let logic = renderHook(() => useStoreDescriptionLogic(appId, 'Alt'))
        logic.handler.handleChange('Neu')
        logic = renderHook(() => useStoreDescriptionLogic(appId, 'Alt'))
        logic.handler.handleSave()
        await settle()
        expect(handlers.description).toHaveBeenCalledWith({
            data: { appId, description: 'Neu' },
        })
        expect(success).toHaveBeenCalledWith('appStore.description.saved', {
            title: 'appStore.title',
        })
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['app-store'] })
    })

    it('reports refused and failed saves', async () => {
        handlers.description.mockResolvedValueOnce({
            success: false,
            error: 'Nicht erlaubt',
        })
        renderHook(() =>
            useStoreDescriptionLogic(appId, ''),
        ).handler.handleSave()
        await settle()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Nicht erlaubt' }),
        )

        const error = new Error('network')
        handlers.description.mockRejectedValueOnce(error)
        renderHook(() =>
            useStoreDescriptionLogic(appId, ''),
        ).handler.handleSave()
        await settle()
        expect(failure).toHaveBeenCalledWith(error)
    })
})

describe('screenshot gallery logic', () => {
    it('wraps around in both directions', () => {
        let logic = renderHook(() => useScreenshotGalleryLogic(3))
        expect(logic.state.activeIndex).toBe(0)

        logic.handler.handlePrevious()
        logic = renderHook(() => useScreenshotGalleryLogic(3))
        expect(logic.state.activeIndex).toBe(2)

        logic.handler.handleNext()
        logic = renderHook(() => useScreenshotGalleryLogic(3))
        expect(logic.state.activeIndex).toBe(0)

        logic.handler.handleNext()
        logic = renderHook(() => useScreenshotGalleryLogic(3))
        expect(logic.state.activeIndex).toBe(1)
    })

    it('selects a thumbnail directly', () => {
        renderHook(() => useScreenshotGalleryLogic(3)).handler.handleSelect(2)
        expect(
            renderHook(() => useScreenshotGalleryLogic(3)).state.activeIndex,
        ).toBe(2)
    })

    it('clamps the index when the screenshot count shrinks', () => {
        renderHook(() => useScreenshotGalleryLogic(6)).handler.handleSelect(5)
        let logic = renderHook(() => useScreenshotGalleryLogic(3))
        expect(logic.state.activeIndex).toBe(2)

        logic.handler.handleNext()
        logic = renderHook(() => useScreenshotGalleryLogic(3))
        expect(logic.state.activeIndex).toBe(0)
    })

    it('stays at zero and ignores navigation without screenshots', () => {
        const logic = renderHook(() => useScreenshotGalleryLogic(0))
        logic.handler.handleNext()
        logic.handler.handlePrevious()
        expect(
            renderHook(() => useScreenshotGalleryLogic(0)).state.activeIndex,
        ).toBe(0)
    })

    it('opens and closes the lightbox', () => {
        let logic = renderHook(() => useScreenshotGalleryLogic(2))
        expect(logic.state.isLightboxOpen).toBe(false)
        logic.handler.handleOpenLightbox()
        logic = renderHook(() => useScreenshotGalleryLogic(2))
        expect(logic.state.isLightboxOpen).toBe(true)
        logic.handler.handleCloseLightbox()
        expect(
            renderHook(() => useScreenshotGalleryLogic(2)).state.isLightboxOpen,
        ).toBe(false)
    })

    it('listens to the keyboard only while the lightbox is open', () => {
        const listeners = new Map<string, (event: { key: string }) => void>()
        const removeEventListener = vi.fn()
        stubTestGlobal('window', {
            addEventListener: (
                type: string,
                listener: (event: { key: string }) => void,
            ) => listeners.set(type, listener),
            removeEventListener,
        })

        let logic = renderHook(() => useScreenshotGalleryLogic(3))
        runEffects()
        expect(listeners.size).toBe(0)

        logic.handler.handleOpenLightbox()
        logic = renderHook(() => useScreenshotGalleryLogic(3))
        const cleanup = runEffects()
        const onKeyDown = listeners.get('keydown')
        expect(onKeyDown).toBeDefined()

        onKeyDown?.({ key: 'ArrowRight' })
        logic = renderHook(() => useScreenshotGalleryLogic(3))
        expect(logic.state.activeIndex).toBe(1)

        onKeyDown?.({ key: 'ArrowLeft' })
        onKeyDown?.({ key: 'ArrowLeft' })
        logic = renderHook(() => useScreenshotGalleryLogic(3))
        expect(logic.state.activeIndex).toBe(2)

        onKeyDown?.({ key: 'Escape' })
        logic = renderHook(() => useScreenshotGalleryLogic(3))
        expect(logic.state.isLightboxOpen).toBe(false)

        cleanup()
        expect(removeEventListener).toHaveBeenCalledWith('keydown', onKeyDown)
    })
})

describe('store page logic', () => {
    it('combines the app detail with the sign-in state', () => {
        const app = { appId, name: 'Wetter' } as never
        queryResults.set('detail', app)
        queryResults.set('session', { user: { id: 'viewer' } })
        expect(renderHook(() => useAppDetailPageLogic(appId)).state).toEqual({
            app,
            isSignedIn: true,
        })
    })

    it('falls back to no app and a signed-out visitor', () => {
        expect(renderHook(() => useAppDetailPageLogic(appId)).state).toEqual({
            app: null,
            isSignedIn: false,
        })
    })

    it('exposes the editable apps and their loading state', () => {
        expect(renderHook(useEditableStoreAppsLogic).state).toEqual({
            apps: [],
            isLoading: false,
        })
        queryResults.set('editable', [{ appId }] as never)
        queryResults.set('loading', true)
        expect(renderHook(useEditableStoreAppsLogic).state).toEqual({
            apps: [{ appId } as never],
            isLoading: true,
        })
    })

    it('exposes the editor entry and its loading state', () => {
        expect(renderHook(() => useStoreEditorPageLogic(appId)).state).toEqual({
            entry: null,
            isLoading: false,
        })
        queryResults.set('editor', { appId } as never)
        queryResults.set('loading', true)
        expect(renderHook(() => useStoreEditorPageLogic(appId)).state).toEqual({
            entry: { appId } as never,
            isLoading: true,
        })
    })
})
