import { beforeEach, describe, expect, it, mock } from 'bun:test'
import {
    client,
    createSession,
    failure,
    query,
    render,
    reset,
    settle,
    success,
} from '@/tests/features/UserSettings/settings-hooks.test.helpers.ts'
import { DEFAULT_IMAGE_SRC } from '@/lib/Images/imageFallbacks.ts'

type BannerResult =
    | {
          success: true
          customBackgroundDarkness: number
          customBackgroundUpdatedAt: string
          backgroundSrc: string
      }
    | { success: false; error: string }

const updateBio = mock(
    async (
        _input: unknown,
    ): Promise<
        | { success: true; bio: string | null }
        | { success: false; error: string }
    > => ({ success: true, bio: null }),
)
const updateBackground = mock(
    async (_input: unknown): Promise<BannerResult> => ({
        success: true,
        customBackgroundDarkness: 55,
        customBackgroundUpdatedAt: '2026-11-27T20:00:00.000Z',
        backgroundSrc: '/background.webp',
    }),
)
const deleteBackground = mock(
    async (): Promise<
        { success: true } | { success: false; error: string }
    > => ({
        success: true,
    }),
)
const navigate = mock(async (_options: unknown) => {})
const transfer = { complete: mock(), fail: mock() }
const startTransfer = mock((_options: unknown) => transfer)
const selection = {
    state: {
        imageSrc: null as string | null,
        crop: { x: 0, y: 0 },
        zoom: 1,
        croppedAreaPixels: null as {
            x: number
            y: number
            width: number
            height: number
        } | null,
    },
    handler: {
        handleSelectImage: mock(),
        handleCropComplete: mock(),
        handleResetSelection: mock(),
        handleClearSelectedImage: mock(),
    },
    setter: { setCrop: mock(), setZoom: mock() },
}
let search: { tab?: string } = {}
let localVersion: number | null = null

mock.module('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserBioHandler: updateBio,
    updateCurrentUserBackgroundHandler: updateBackground,
    deleteCurrentUserBackgroundHandler: deleteBackground,
}))
mock.module('@/lib/Social/socialQueries.ts', () => ({
    publicProfileQueryOptions: (username: string) => ({
        queryKey: ['social', 'profile', username],
    }),
}))
mock.module('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useSearch: () => search,
}))
mock.module('@/shared/Images/Hooks/useLocalProfileImageVersion.ts', () => ({
    default: () => localVersion,
}))
mock.module('@/shared/Images/Hooks/useImageCropSelection.ts', () => ({
    default: () => selection,
}))
mock.module(
    '@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts',
    () => ({
        startTransferTask: startTransfer,
    }),
)

const { default: useUserProfilePageLogic } =
    await import('@/features/UserProfile/Hooks/useUserProfilePageLogic.ts')
const { default: useProfileBioLogic } =
    await import('@/features/UserProfile/Hooks/useProfileBioLogic.ts')
const { default: useProfileBannerLogic } =
    await import('@/features/UserProfile/Hooks/useProfileBannerLogic.ts')

beforeEach(() => {
    reset()
    search = {}
    localVersion = null
    selection.state.imageSrc = null
    selection.state.croppedAreaPixels = null
    navigate.mockReset().mockResolvedValue(undefined)
    updateBio.mockReset().mockResolvedValue({ success: true, bio: null })
    updateBackground.mockReset().mockResolvedValue({
        success: true,
        customBackgroundDarkness: 55,
        customBackgroundUpdatedAt: '2026-11-27T20:00:00.000Z',
        backgroundSrc: '/background.webp',
    })
    deleteBackground.mockReset().mockResolvedValue({ success: true })
})

describe('profile page logic', () => {
    it('falls back to safe defaults and opens the apps tab first', () => {
        expect(render(useUserProfilePageLogic).state).toEqual({
            activeTab: 'apps',
            appCount: 0,
            starCount: 0,
            bannerSrc: null,
            bio: '',
            followerCount: 0,
            followingCount: 0,
            profileImageSrc: DEFAULT_IMAGE_SRC,
            userId: '',
            username: '',
        })
    })

    it('derives the profile from the session and the requested tab', () => {
        const session = createSession()
        query.mockReturnValue({
            data: {
                ...session,
                user: {
                    ...session.user!,
                    bio: 'Builds proxies.',
                    customBackgroundUpdatedAt: '2026-11-27T20:00:00.000Z',
                },
            },
        })
        search = { tab: 'security' }
        localVersion = 9
        const state = render(useUserProfilePageLogic).state
        expect(state.activeTab).toBe('security')
        expect(state.bio).toBe('Builds proxies.')
        expect(state.username).toBe('tester')
        expect(state.profileImageSrc).toContain(
            '/images/user/member-1/profile.webp?v=9',
        )
        expect(state.bannerSrc).toBe(
            '/api/user/background?v=2026-11-27T20%3A00%3A00.000Z',
        )
    })

    it('switches tabs through the route search without scrolling', () => {
        render(useUserProfilePageLogic).handler.handleTabChange('appearance')
        expect(navigate).toHaveBeenCalledWith({
            to: '/profile',
            search: { tab: 'appearance' },
            replace: true,
            resetScroll: false,
        })
    })
})

describe('profile bio logic', () => {
    it('saves the edited bio and merges it into the session cache', async () => {
        client.setQueryData(['session'], createSession())
        let logic = render(() => useProfileBioLogic({ bio: '' }))
        expect(logic.state.hasBioChanged).toBe(false)
        logic.handler.handleBioChange('Hello community')
        logic = render(() => useProfileBioLogic({ bio: '' }))
        expect(logic.state).toMatchObject({
            bioValue: 'Hello community',
            hasBioChanged: true,
        })
        updateBio.mockResolvedValue({ success: true, bio: 'Hello community' })
        logic.handler.handleSaveBio()
        await settle()
        expect(updateBio).toHaveBeenCalledWith({
            data: { bio: 'Hello community' },
        })
        expect(success).toHaveBeenCalledWith('profile.bio.saved', {
            title: 'profile.title',
        })
        expect(client.getQueryData(['session'])).toMatchObject({
            user: { bio: 'Hello community' },
        })
        expect(
            render(() => useProfileBioLogic({ bio: '' })).state.isEditingBio,
        ).toBe(false)
    })

    it('opens and cancels the inline editor without keeping the draft', () => {
        let logic = render(() => useProfileBioLogic({ bio: 'Stored' }))
        expect(logic.state.isEditingBio).toBe(false)
        logic.handler.handleStartEditingBio()
        logic = render(() => useProfileBioLogic({ bio: 'Stored' }))
        expect(logic.state.isEditingBio).toBe(true)
        logic.handler.handleBioChange('Draft')
        logic = render(() => useProfileBioLogic({ bio: 'Stored' }))
        logic.handler.handleCancelEditingBio()
        logic = render(() => useProfileBioLogic({ bio: 'Stored' }))
        expect(logic.state).toMatchObject({
            bioValue: 'Stored',
            isEditingBio: false,
        })
    })

    it('resynchronizes the draft when the stored bio changes', () => {
        render(() => useProfileBioLogic({ bio: 'Old' }))
        render(() => useProfileBioLogic({ bio: 'New' }))
        expect(
            render(() => useProfileBioLogic({ bio: 'New' })).state.bioValue,
        ).toBe('New')
    })

    it('reports rejected and thrown saves without a success toast', async () => {
        updateBio.mockResolvedValue({ success: false, error: 'Too long' })
        render(() => useProfileBioLogic({ bio: '' })).handler.handleSaveBio()
        await settle()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Too long' }),
        )
        const error = new Error('offline')
        updateBio.mockRejectedValue(error)
        render(() => useProfileBioLogic({ bio: '' })).handler.handleSaveBio()
        await settle()
        expect(failure).toHaveBeenCalledWith(error)
        expect(success).not.toHaveBeenCalled()
    })
})

describe('profile banner logic', () => {
    it('refuses to upload without a cropped selection', async () => {
        render(useProfileBannerLogic).handler.handleSaveBanner()
        await settle()
        expect(updateBackground).not.toHaveBeenCalled()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'toast.backgroundMissing' }),
        )
    })

    it('uploads the cropped banner, clears the selection and updates the session', async () => {
        client.setQueryData(['session'], createSession())
        selection.state.imageSrc = 'data:image/png;base64,AAAA'
        selection.state.croppedAreaPixels = {
            x: 0,
            y: 0,
            width: 300,
            height: 100,
        }
        render(useProfileBannerLogic).handler.handleSaveBanner()
        await settle()
        expect(updateBackground).toHaveBeenCalledWith({
            data: {
                imageDataUrl: 'data:image/png;base64,AAAA',
                crop: { x: 0, y: 0, width: 300, height: 100 },
            },
        })
        expect(transfer.complete).toHaveBeenCalledWith('profile.banner.saved')
        expect(selection.handler.handleClearSelectedImage).toHaveBeenCalled()
        expect(success).toHaveBeenCalledWith('profile.banner.saved', {
            title: 'profile.title',
        })
        expect(client.getQueryData(['session'])).toMatchObject({
            user: { customBackgroundUpdatedAt: '2026-11-27T20:00:00.000Z' },
        })
    })

    it('marks rejected and failed uploads on the transfer task', async () => {
        selection.state.imageSrc = 'data:image/png;base64,AAAA'
        selection.state.croppedAreaPixels = {
            x: 0,
            y: 0,
            width: 300,
            height: 100,
        }
        updateBackground.mockResolvedValue({ success: false, error: 'Too big' })
        render(useProfileBannerLogic).handler.handleSaveBanner()
        await settle()
        expect(transfer.fail).toHaveBeenCalledWith('Too big')
        updateBackground.mockRejectedValue(new Error('offline'))
        render(useProfileBannerLogic).handler.handleSaveBanner()
        await settle()
        expect(transfer.fail).toHaveBeenCalledWith('profile.banner.failed')
        expect(success).not.toHaveBeenCalled()
    })

    it('asks for confirmation before removing the banner', () => {
        let logic = render(useProfileBannerLogic)
        expect(logic.state.isRemoveDialogOpen).toBe(false)
        logic.handler.handleOpenRemoveBanner()
        logic = render(useProfileBannerLogic)
        expect(logic.state.isRemoveDialogOpen).toBe(true)
        expect(deleteBackground).not.toHaveBeenCalled()
        logic.handler.handleCloseRemoveBanner()
        expect(render(useProfileBannerLogic).state.isRemoveDialogOpen).toBe(
            false,
        )
    })

    it('removes the banner after confirmation and clears it from the session', async () => {
        const session = createSession()
        client.setQueryData(['session'], {
            ...session,
            user: { ...session.user!, customBackgroundUpdatedAt: 'x' },
        })
        render(useProfileBannerLogic).handler.handleOpenRemoveBanner()
        render(useProfileBannerLogic).handler.handleConfirmRemoveBanner()
        await settle()
        expect(render(useProfileBannerLogic).state.isRemoveDialogOpen).toBe(
            false,
        )
        expect(deleteBackground).toHaveBeenCalled()
        expect(success).toHaveBeenCalledWith('profile.banner.removed', {
            title: 'profile.title',
        })
        expect(client.getQueryData(['session'])).toMatchObject({
            user: { customBackgroundUpdatedAt: null },
        })
        deleteBackground.mockResolvedValue({ success: false, error: 'Locked' })
        render(useProfileBannerLogic).handler.handleConfirmRemoveBanner()
        await settle()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Locked' }),
        )
    })
})
