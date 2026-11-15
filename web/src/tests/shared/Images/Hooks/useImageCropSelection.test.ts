import * as actualReact from 'react'
import * as actualQuery from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { ImageSelectionTestEffect } from './image-crop-selection.test.types.ts'

const actualReactExports = { ...actualReact }
const actualQueryExports = { ...actualQuery }
const ActualMutationObserver = actualQuery.MutationObserver
const queryClient = new actualQuery.QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
})
const cells: Array<unknown> = []
const refs: Array<{ current: unknown }> = []
const effects: Array<ImageSelectionTestEffect> = []
const pendingMutations: Array<Promise<unknown>> = []
let stateCursor = 0
let refCursor = 0
let effectCursor = 0
let stateWrites = 0
const readers: Array<TestFileReader> = []
const originalFileReader = Object.getOwnPropertyDescriptor(
    globalThis,
    'FileReader',
)
const mocks = {
    saveLogo: vi.fn(async () => ({ success: true })),
    saveProfile: vi.fn(async () => ({
        success: true,
        profileImageVersion: 123,
    })),
    updateCache: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}
const startTransfer = vi.fn(() => ({
    complete: mocks.complete,
    fail: mocks.fail,
}))

class TestFileReader extends EventTarget {
    result: string | ArrayBuffer | null = null

    readAsDataURL(_file: File) {
        readers.push(this)
    }

    complete(result: string | ArrayBuffer | null) {
        this.result = result
        this.dispatchEvent(new Event('load'))
    }
}

vi.mock('react', () => ({
    ...actualReactExports,
    useState(initial: unknown) {
        const index = stateCursor++
        if (!(index in cells)) cells[index] = initial
        return [
            cells[index],
            function (value: unknown) {
                stateWrites += 1
                cells[index] =
                    typeof value === 'function'
                        ? Reflect.apply(value, undefined, [cells[index]])
                        : value
            },
        ]
    },
    useRef(initial: unknown) {
        const index = refCursor++
        return (refs[index] ??= { current: initial })
    },
    useEffect(
        setup: actualReact.EffectCallback,
        dependencies?: ReadonlyArray<unknown>,
    ) {
        const index = effectCursor++
        const previous = effects[index]
        const changed =
            !previous ||
            !dependencies ||
            !previous.dependencies ||
            dependencies.some(
                (value, offset) =>
                    !Object.is(value, previous.dependencies?.[offset]),
            )
        if (changed)
            effects[index] = {
                setup,
                dependencies,
                pending: true,
                cleanup: previous?.cleanup,
            }
    },
}))
vi.mock('@tanstack/react-query', () => ({
    ...actualQueryExports,
    useQueryClient: () => queryClient,
    useMutation<T>(options: UseMutationOptions<T>) {
        const observer = new ActualMutationObserver(queryClient, options)
        return {
            isPending: false,
            mutate() {
                pendingMutations.push(observer.mutate().catch(() => undefined))
            },
        }
    },
}))
vi.mock('@/features/Admin/SystemSettings/middleware.ts', () => ({
    updateSystemLogoHandler: mocks.saveLogo,
}))
vi.mock('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserProfileImageHandler: mocks.saveProfile,
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    ADMIN_SYSTEM_SETTINGS_QUERY_KEY: ['admin-system-settings'],
    profileImageVersionQueryKey: (userId: string) => [
        'profile-image-version',
        userId,
    ],
}))
vi.mock('@/lib/UserSettings/sessionCache.ts', () => ({
    updateAuthenticatedSessionUserCache: mocks.updateCache,
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@rentnerkev/toasts', () => ({
    toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))
vi.mock('@/lib/Errors/appError.ts', () => ({ AppError: Error }))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: mocks.toastError,
}))
vi.mock('@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts', () => ({
    startTransferTask: startTransfer,
}))

import useImageCropSelection from '@/shared/Images/Hooks/useImageCropSelection.ts'
import useSystemLogoUpload from '@/features/Admin/SystemSettings/Hooks/useSystemLogoUpload.ts'
import useProfileImageSettingsLogic from '@/features/UserSettings/Components/Account/Hooks/useProfileImageSettingsLogic.ts'

function renderHook<T>(hook: () => T): T {
    stateCursor = 0
    refCursor = 0
    effectCursor = 0
    const result = hook()
    for (const effect of effects) {
        if (!effect.pending) continue
        effect.cleanup?.()
        const cleanup = effect.setup()
        effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined
        effect.pending = false
    }
    return result
}

function unmount() {
    for (const effect of effects) {
        effect.cleanup?.()
        effect.cleanup = undefined
    }
}

function completeRead(index: number, source: string | ArrayBuffer | null) {
    const reader = readers[index]
    if (!reader) throw new Error('Expected a pending synthetic file read')
    reader.complete(source)
}

const fixtureFile = new File(['synthetic'], 'synthetic.png', {
    type: 'image/png',
})
const fixturePixels = { x: 10, y: 20, width: 80, height: 90 }
const firstSource = 'data:image/png;base64,AAAA'
const secondSource = 'data:image/png;base64,BBBB'

function profileHook() {
    return useProfileImageSettingsLogic('synthetic-user')
}

beforeEach(function () {
    vi.clearAllMocks()
    cells.length = 0
    refs.length = 0
    effects.length = 0
    readers.length = 0
    pendingMutations.length = 0
    stateWrites = 0
    queryClient.clear()
    Object.defineProperty(globalThis, 'FileReader', {
        configurable: true,
        value: TestFileReader,
    })
})

afterEach(function () {
    unmount()
    queryClient.clear()
    if (originalFileReader)
        Object.defineProperty(globalThis, 'FileReader', originalFileReader)
    else Reflect.deleteProperty(globalThis, 'FileReader')
})

describe('gemeinsame Bildauswahl und Crop-Lebenszyklus', function () {
    it('behält eine abgebrochene Dateiauswahl und wartet auf Pixel des neuen Bildes', function () {
        let selection = renderHook(useImageCropSelection)
        selection.handler.handleSelectImage(fixtureFile)
        selection.handler.handleSelectImage(null)
        expect(readers).toHaveLength(1)
        completeRead(0, firstSource)
        selection = renderHook(useImageCropSelection)
        selection.setter.setCrop({ x: 4, y: 8 })
        selection.setter.setZoom(2)
        selection.handler.handleCropComplete(null, fixturePixels)
        selection.handler.handleSelectImage(fixtureFile)
        completeRead(1, secondSource)
        expect(renderHook(useImageCropSelection).state).toEqual({
            imageSrc: secondSource,
            crop: { x: 0, y: 0 },
            zoom: 1,
            croppedAreaPixels: null,
        })
    })

    it.each([true, false])(
        'übernimmt bei überlappenden Lesevorgängen ausschließlich die neueste Auswahl (alt zuerst: %s)',
        function (oldFirst) {
            const selection = renderHook(useImageCropSelection)
            selection.handler.handleSelectImage(fixtureFile)
            selection.handler.handleSelectImage(fixtureFile)
            completeRead(
                oldFirst ? 0 : 1,
                oldFirst ? firstSource : secondSource,
            )
            if (oldFirst)
                expect(
                    renderHook(useImageCropSelection).state.imageSrc,
                ).toBeNull()
            completeRead(
                oldFirst ? 1 : 0,
                oldFirst ? secondSource : firstSource,
            )
            expect(renderHook(useImageCropSelection).state.imageSrc).toBe(
                secondSource,
            )
        },
    )

    it('verwirft nach Reset noch laufende Lesevorgänge und setzt alle Crop-Werte zurück', function () {
        const selection = renderHook(useImageCropSelection)
        selection.setter.setCrop({ x: 4, y: 8 })
        selection.setter.setZoom(2)
        selection.handler.handleCropComplete(null, fixturePixels)
        selection.handler.handleSelectImage(fixtureFile)
        selection.handler.handleResetSelection()
        const writesAfterReset = stateWrites
        completeRead(0, firstSource)
        expect(stateWrites).toBe(writesAfterReset)
        expect(renderHook(useImageCropSelection).state).toEqual({
            imageSrc: null,
            crop: { x: 0, y: 0 },
            zoom: 1,
            croppedAreaPixels: null,
        })
    })

    it('verwirft nach Unmount Ergebnisse ohne weiteren State-Write', function () {
        renderHook(useImageCropSelection).handler.handleSelectImage(fixtureFile)
        unmount()
        const writesAfterUnmount = stateWrites
        completeRead(0, firstSource)
        expect(stateWrites).toBe(writesAfterUnmount)
    })

    it('bleibt nach StrictMode-Cleanup für eine neue Auswahl verwendbar', function () {
        renderHook(useImageCropSelection).handler.handleSelectImage(fixtureFile)
        unmount()
        for (const effect of effects) effect.pending = true
        renderHook(useImageCropSelection).handler.handleSelectImage(fixtureFile)
        completeRead(0, firstSource)
        expect(renderHook(useImageCropSelection).state.imageSrc).toBeNull()
        completeRead(1, secondSource)
        expect(renderHook(useImageCropSelection).state.imageSrc).toBe(
            secondSource,
        )
    })

    it('löscht nach erfolgreicher Speicherung nur die Quelle und verwirft ausstehende Lesevorgänge', function () {
        const selection = renderHook(useImageCropSelection)
        selection.setter.setCrop({ x: 4, y: 8 })
        selection.setter.setZoom(2)
        selection.handler.handleCropComplete(null, fixturePixels)
        selection.handler.handleSelectImage(fixtureFile)
        selection.handler.handleClearSelectedImage()
        completeRead(0, firstSource)
        expect(renderHook(useImageCropSelection).state).toEqual({
            imageSrc: null,
            crop: { x: 4, y: 8 },
            zoom: 2,
            croppedAreaPixels: fixturePixels,
        })
    })

    it('übernimmt keine nichttextuellen FileReader-Ergebnisse', function () {
        renderHook(useImageCropSelection).handler.handleSelectImage(fixtureFile)
        completeRead(0, new ArrayBuffer(8))
        expect(renderHook(useImageCropSelection).state.imageSrc).toBeNull()
    })
})

describe('Bildauswahl bei den Feature-Eigentümern', function () {
    it('speichert ein neues Logo erst nach neuen Crop-Pixeln und erhält Cache und Upload-Effekte', async function () {
        let logo = renderHook(useSystemLogoUpload)
        logo.handler.handleSelectLogo(fixtureFile)
        completeRead(0, firstSource)
        logo = renderHook(useSystemLogoUpload)
        logo.handler.handleCropComplete(null, fixturePixels)
        logo.handler.handleSelectLogo(fixtureFile)
        completeRead(1, secondSource)
        logo = renderHook(useSystemLogoUpload)
        expect(logo.state.croppedAreaPixels).toBeNull()
        logo.handler.handleSaveLogo()
        await Promise.all(pendingMutations)
        expect(mocks.saveLogo).not.toHaveBeenCalled()
        expect(startTransfer).not.toHaveBeenCalled()

        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
        logo.handler.handleCropComplete(null, fixturePixels)
        logo = renderHook(useSystemLogoUpload)
        logo.handler.handleSaveLogo()
        await Promise.all(pendingMutations)
        expect(mocks.saveLogo).toHaveBeenCalledWith({
            data: { imageDataUrl: secondSource, crop: fixturePixels },
        })
        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['admin-system-settings'],
        })
        expect(mocks.complete).toHaveBeenCalledWith(
            'admin.systemSettings.logoUploaded',
        )
        expect(
            renderHook(useSystemLogoUpload).state.selectedLogoDataUrl,
        ).toBeNull()
    })

    it('erhält beim Profilbild die lokalen Handler und aktualisiert die bestätigte Bildversion', async function () {
        let profile = renderHook(profileHook)
        profile.handler.handleSelectImage(fixtureFile)
        completeRead(0, firstSource)
        profile = renderHook(profileHook)
        profile.handler.handleCropChange({ x: 4, y: 8 })
        profile.handler.handleZoomChange(2)
        profile.handler.handleCropComplete(null, fixturePixels)
        profile = renderHook(profileHook)
        expect(profile.state.crop).toEqual({ x: 4, y: 8 })
        expect(profile.state.zoom).toBe(2)
        profile.handler.handleSaveProfileImage()
        await Promise.all(pendingMutations)
        expect(mocks.saveProfile).toHaveBeenCalledWith({
            data: { imageDataUrl: firstSource, crop: fixturePixels },
        })
        expect(mocks.updateCache).toHaveBeenCalledWith(queryClient, {
            profileImageVersion: 123,
        })
        expect(
            queryClient.getQueryData<number>([
                'profile-image-version',
                'synthetic-user',
            ]),
        ).toBe(123)
        expect(renderHook(profileHook).state.imageSrc).toBeNull()
    })
})
