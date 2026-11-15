import { beforeEach, describe, expect, it, vi } from 'bun:test'
import * as ReactQuery from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import type { updateCurrentUserBackgroundHandler } from '@/features/UserSettings/middleware.ts'
import type { CustomBackgroundImageMutationsOptions } from '@/features/UserSettings/Components/AppearanceSection/Types/custom-background-logic.types.ts'

const actualReactQuery = { ...ReactQuery }
const ActualMutationObserver = ReactQuery.MutationObserver
const queryClient = new ReactQuery.QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
})
const pending: Array<Promise<unknown>> = []
const saveRequest = vi.fn<typeof updateCurrentUserBackgroundHandler>()
const updateCache = vi.fn()
const resetSelection = vi.fn()
const complete = vi.fn()
const fail = vi.fn()
const startTransfer = vi.fn(() => ({ complete, fail }))
const toastError = vi.fn()
const savedResult = {
    success: true as const,
    customBackgroundDarkness: 60,
    customBackgroundUpdatedAt: '2026-10-01T10:00:00.000Z',
    backgroundSrc: '/api/user/background?v=saved',
}

vi.mock('@tanstack/react-query', () => ({
    ...actualReactQuery,
    useQueryClient: () => queryClient,
    useMutation<T>(options: UseMutationOptions<T>) {
        const observer = new ActualMutationObserver(queryClient, options)
        return {
            isPending: false,
            mutate() {
                pending.push(observer.mutate().catch(() => undefined))
            },
        }
    },
}))
vi.mock('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserBackgroundHandler: saveRequest,
    deleteCurrentUserBackgroundHandler: vi.fn(),
}))
vi.mock('@/lib/UserSettings/sessionCache.ts', () => ({
    updateAuthenticatedSessionUserCache: updateCache,
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@rentnerkev/toasts', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/lib/Errors/appError.ts', () => ({
    AppError: Error,
}))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: toastError,
}))
vi.mock('@/lib/Images/imageDataUrlSize.ts', () => ({
    getDataUrlByteSize: () => 4,
}))
vi.mock('@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts', () => ({
    startTransferTask: startTransfer,
}))

const { default: useCustomBackgroundImageMutations } =
    await import('@/features/UserSettings/Components/AppearanceSection/Hooks/useCustomBackgroundImageMutations.ts')
const options: CustomBackgroundImageMutationsOptions = {
    backgroundImageSrc: 'data:image/png;base64,AAAA',
    backgroundCroppedAreaPixels: { x: 100, y: 80, width: 700, height: 500 },
    customBackgroundDarknessValue: 65,
    resetSelectedBackgroundImage: resetSelection,
}

describe('Hintergrund-Speicherung aus der Vorschau', function () {
    beforeEach(function () {
        queryClient.clear()
        pending.length = 0
        saveRequest.mockReset()
        saveRequest.mockResolvedValue(savedResult)
        updateCache.mockClear()
        resetSelection.mockClear()
        startTransfer.mockClear()
        complete.mockClear()
        fail.mockClear()
        toastError.mockClear()
    })

    it('überträgt Ausschnitt und Abdunklung und übernimmt die bestätigten Serverwerte', async function () {
        const { handler } = useCustomBackgroundImageMutations(options)
        handler.handleSaveBackgroundImage()
        await Promise.all(pending)

        expect(saveRequest).toHaveBeenCalledWith({
            data: {
                imageDataUrl: options.backgroundImageSrc,
                crop: options.backgroundCroppedAreaPixels,
                customBackgroundDarkness: 65,
            },
        })
        expect(updateCache).toHaveBeenCalledWith(queryClient, {
            customBackgroundDarkness: 60,
            customBackgroundUpdatedAt: savedResult.customBackgroundUpdatedAt,
        })
        expect(resetSelection).toHaveBeenCalledTimes(1)
        expect(complete).toHaveBeenCalledWith('toast.backgroundSaved')
    })

    it('behält die Auswahl bei einer fehlgeschlagenen Speicherung', async function () {
        saveRequest.mockResolvedValue({
            success: false,
            error: 'synthetic failure',
        })
        const { handler } = useCustomBackgroundImageMutations(options)
        handler.handleSaveBackgroundImage()
        await Promise.all(pending)

        expect(resetSelection).not.toHaveBeenCalled()
        expect(updateCache).not.toHaveBeenCalled()
        expect(fail).toHaveBeenCalledWith('synthetic failure')
        expect(toastError).toHaveBeenCalled()
    })

    it('lädt ohne gültigen Ausschnitt kein Bild hoch', async function () {
        const { handler } = useCustomBackgroundImageMutations({
            ...options,
            backgroundCroppedAreaPixels: null,
        })
        handler.handleSaveBackgroundImage()
        await Promise.all(pending)

        expect(saveRequest).not.toHaveBeenCalled()
        expect(startTransfer).not.toHaveBeenCalled()
        expect(resetSelection).not.toHaveBeenCalled()
    })
})
