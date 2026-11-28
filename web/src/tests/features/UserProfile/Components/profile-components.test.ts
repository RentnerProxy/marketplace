import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type useProfileBannerLogic from '@/features/UserProfile/Hooks/useProfileBannerLogic.ts'
import type useProfileBioLogic from '@/features/UserProfile/Hooks/useProfileBioLogic.ts'
import type useUserProfilePageLogic from '@/features/UserProfile/Hooks/useUserProfilePageLogic.ts'
import type useProfileAppsListLogic from '@/features/Social/Hooks/useProfileAppsListLogic.ts'
import type useProfileImageSettingsLogic from '@/features/UserSettings/Components/Account/Hooks/useProfileImageSettingsLogic.ts'

let banner: ReturnType<typeof useProfileBannerLogic>
let bio: ReturnType<typeof useProfileBioLogic>
let page: ReturnType<typeof useUserProfilePageLogic>
let avatar: ReturnType<typeof useProfileImageSettingsLogic>
let apps: ReturnType<typeof useProfileAppsListLogic>

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
mock.module('@/features/UserProfile/Hooks/useProfileBannerLogic.ts', () => ({
    default: () => banner,
}))
mock.module('@/features/UserProfile/Hooks/useProfileBioLogic.ts', () => ({
    default: () => bio,
}))
mock.module('@/features/UserProfile/Hooks/useUserProfilePageLogic.ts', () => ({
    default: () => page,
}))
mock.module(
    '@/features/UserSettings/Components/Account/Hooks/useProfileImageSettingsLogic.ts',
    () => ({ default: () => avatar }),
)
mock.module('@tanstack/react-router', () => ({
    Link: ({
        to,
        params,
        children,
        className,
    }: {
        to: string
        params?: Record<string, string>
        children: ReactNode
        className?: string
    }) =>
        createElement(
            'a',
            {
                href: to.replace('$username', params?.username ?? ''),
                className,
            },
            children,
        ),
}))
mock.module('react-dom', () => ({
    createPortal: (node: unknown) => node,
}))
mock.module('@rentnerkev/tooltips', () => ({
    CustomTooltip: ({
        children,
        content,
    }: {
        children: ReactNode
        content: ReactNode
    }) => createElement('span', { 'data-tooltip': content }, children),
}))
mock.module('@/features/Social/Hooks/useProfileAppsListLogic.ts', () => ({
    default: () => apps,
}))
mock.module('@/features/Social/Hooks/useStarButtonLogic.ts', () => ({
    default: () => ({
        state: { isPending: false },
        handler: { handleToggleStar: mock() },
    }),
}))
mock.module('@/shared/SafeDeleteModal/index.tsx', () => ({
    default: ({ isOpen, question }: { isOpen: boolean; question: string }) =>
        isOpen ? createElement('dialog', { open: true }, question) : null,
}))
mock.module('@/shared/Images/Hooks/useResolvedImageSrc.ts', () => ({
    default: (src: string) => ({
        state: { imageSrc: src },
        handler: { handleImageError: mock() },
    }),
}))
mock.module('react-easy-crop', () => ({
    default: ({ image }: { image: string }) =>
        createElement('img', { src: image, alt: 'Banner crop' }),
}))
for (const section of ['AppearanceSection', 'SecuritySection']) {
    mock.module(
        `@/features/UserSettings/Components/${section}/index.tsx`,
        () => ({
            default: () => createElement('div', null, `section:${section}`),
        }),
    )
}

const { default: ProfileHero } =
    await import('@/features/UserProfile/Components/ProfileHero.tsx')
const { default: ProfileBio } =
    await import('@/features/UserProfile/Components/ProfileBio.tsx')
const { default: ProfileAppsSection } =
    await import('@/features/UserProfile/Components/ProfileAppsSection.tsx')
const { default: UserProfilePage } =
    await import('@/features/UserProfile/index.tsx')
const { default: ProfileAvatar } =
    await import('@/features/UserProfile/Components/ProfileAvatar.tsx')

const heroProps = {
    appCount: 2,
    starCount: 5,
    bannerSrc: null,
    bio: '',
    followerCount: 4,
    followingCount: 2,
    profileImageSrc: '/profile.png',
    userId: 'member-1',
    username: 'tester',
}

beforeEach(() => {
    apps = { state: { apps: [], isLoading: false } }
    banner = {
        state: {
            crop: { x: 0, y: 0 },
            imageSrc: null,
            isRemoveDialogOpen: false,
            isRemovingBanner: false,
            isSavingBanner: false,
            zoom: 1,
        },
        handler: {
            handleCancelBanner: mock(),
            handleCloseRemoveBanner: mock(),
            handleConfirmRemoveBanner: mock(),
            handleCropChange: mock(),
            handleCropComplete: mock(),
            handleOpenRemoveBanner: mock(),
            handleSaveBanner: mock(),
            handleSelectImage: mock(),
            handleZoomChange: mock(),
        },
    }
    avatar = {
        state: {
            copy: false,
            crop: { x: 0, y: 0 },
            imageSrc: null,
            isSavingProfileImage: false,
            zoom: 1,
        },
        handler: {
            handleCopy: mock(async () => {}),
            handleCropChange: mock(),
            handleCropComplete: mock(),
            handleResetSelectedImage: mock(),
            handleSaveProfileImage: mock(),
            handleSelectImage: mock(),
            handleZoomChange: mock(),
        },
    }
    bio = {
        state: {
            bioValue: 'Hi',
            hasBioChanged: false,
            isEditingBio: false,
            isSavingBio: false,
        },
        handler: {
            handleBioChange: mock(),
            handleCancelEditingBio: mock(),
            handleSaveBio: mock(),
            handleStartEditingBio: mock(),
        },
    }
    page = {
        state: {
            activeTab: 'apps',
            appCount: 0,
            starCount: 0,
            bannerSrc: null,
            bio: '',
            followerCount: 0,
            followingCount: 0,
            profileImageSrc: '/profile.png',
            userId: 'member-1',
            username: 'tester',
        },
        handler: { handleTabChange: mock() },
    }
})

describe('ProfileHero', () => {
    it('shows the default comic banner, avatar, empty bio and stats', () => {
        const html = renderToStaticMarkup(createElement(ProfileHero, heroProps))
        expect(html).toContain('thumbs-up-v1')
        expect(html).toContain('alt="tester"')
        expect(html).toContain('profile.bio.empty')
        expect(html).toContain('profile.stats.apps')
        expect(html).toContain('profile.stats.stars')
        expect(html).toContain('<span class="tabular-nums">5</span>')
        expect(html).toContain('href="/u/tester"')
        expect(html).toContain('social.viewPublicProfile')
        expect(html).toContain('social.followers')
        expect(html).toContain('profile.banner.change')
        expect(html).not.toContain('profile.banner.remove')
    })

    it('shows an uploaded banner with a remove action and the stored bio', () => {
        const html = renderToStaticMarkup(
            createElement(ProfileHero, {
                ...heroProps,
                bannerSrc: '/api/user/background?v=1',
                bio: 'Builds proxies.',
            }),
        )
        expect(html).toContain('src="/api/user/background?v=1"')
        expect(html).toContain('data-tooltip="profile.banner.remove"')
        expect(html).not.toContain(' title=')
        expect(html).not.toContain('profile.banner.removeQuestion')
        expect(html).toContain('Builds proxies.')
        expect(html).not.toContain('profile.bio.empty')
    })

    it('opens the removal confirmation instead of deleting right away', () => {
        banner.state.isRemoveDialogOpen = true
        const html = renderToStaticMarkup(
            createElement(ProfileHero, {
                ...heroProps,
                bannerSrc: '/api/user/background?v=1',
            }),
        )
        expect(html).toContain('<dialog open="">profile.banner.removeQuestion')
    })

    it('switches to the crop editor while a new banner is selected', () => {
        banner.state.imageSrc = 'data:image/png;base64,AAAA'
        banner.state.isSavingBanner = true
        const html = renderToStaticMarkup(createElement(ProfileHero, heroProps))
        expect(html).toContain('alt="Banner crop"')
        expect(html).toContain('type="range"')
        expect(html).toContain('profile.banner.save')
        expect(html).toContain('animate-spin')
        expect(html).not.toContain('profile.banner.change')
    })
})

describe('profile sections', () => {
    it('shows the bio with a pencil that switches to the inline editor', () => {
        let html = renderToStaticMarkup(
            createElement(ProfileBio, { bio: 'Hi' }),
        )
        expect(html).toContain('Hi')
        expect(html).toContain('aria-label="profile.bio.edit"')
        expect(html).not.toContain('<textarea')
        bio.state.isEditingBio = true
        html = renderToStaticMarkup(createElement(ProfileBio, { bio: 'Hi' }))
        expect(html).toContain('<textarea')
        expect(html).toContain('2/280')
        expect(html).toContain('maxLength="280"')
        expect(html).toContain('profile.cancel')
    })

    it('renders placeholder slots until the first published app', () => {
        const html = renderToStaticMarkup(
            createElement(ProfileAppsSection, { username: 'tester' }),
        )
        expect(html).toContain('profile.apps.title')
        expect(html).toContain('profile.apps.placeholder{&quot;number&quot;:3}')
        expect(html).not.toContain('comingSoon')
    })

    it('lists published apps with their stars instead of placeholders', () => {
        apps = {
            state: {
                apps: [
                    {
                        appId: 'rentner.weather-widget',
                        name: 'Wetter',
                        summary: 'Zeigt das Wetter.',
                        license: 'MIT',
                        version: '1.0.0',
                        publishedAt: '2026-11-01T00:00:00.000Z',
                        logoSrc: null,
                        starCount: 2,
                        isStarred: false,
                    },
                ],
                isLoading: false,
            },
        }
        const html = renderToStaticMarkup(
            createElement(ProfileAppsSection, { username: 'tester' }),
        )
        expect(html).toContain('Wetter')
        expect(html).toContain('social.star')
        expect(html).not.toContain('profile.apps.placeholder')
    })

    it('renders the active tab content on the profile page', () => {
        let html = renderToStaticMarkup(createElement(UserProfilePage))
        expect(html).toContain('profile.apps.title')
        expect(html).not.toContain('profile.tabs.profile')
        page.state.activeTab = 'appearance'
        expect(renderToStaticMarkup(createElement(UserProfilePage))).toContain(
            'section:AppearanceSection',
        )
        page.state.activeTab = 'security'
        expect(renderToStaticMarkup(createElement(UserProfilePage))).toContain(
            'section:SecuritySection',
        )
    })
})

describe('ProfileAvatar', () => {
    const avatarProps = {
        profileImageSrc: '/profile.png',
        userId: 'member-1',
        username: 'tester',
    }

    it('turns the avatar into an image picker without a crop dialog', () => {
        const html = renderToStaticMarkup(
            createElement(ProfileAvatar, avatarProps),
        )
        expect(html).toContain('src="/profile.png"')
        expect(html).toContain('type="file"')
        expect(html).toContain('profile.avatar.change')
        expect(html).not.toContain('role="dialog"')
    })

    afterEach(restoreTestGlobals)

    it('opens the round crop dialog for a selected image', () => {
        stubTestGlobal('document', { body: {} })
        avatar.state.imageSrc = 'data:image/png;base64,AAAA'
        avatar.state.isSavingProfileImage = true
        const html = renderToStaticMarkup(
            createElement(ProfileAvatar, avatarProps),
        )
        expect(html).toContain('role="dialog"')
        expect(html).toContain('profile.avatar.cropTitle')
        expect(html).toContain('alt="Banner crop"')
        expect(html).toContain('common.saving')
        expect(html).toContain('type="range"')
    })
})
