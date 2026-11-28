import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type usePeopleSearchLogic from '@/features/People/Hooks/usePeopleSearchLogic.ts'
import type usePublicProfilePageLogic from '@/features/PublicProfile/Hooks/usePublicProfilePageLogic.ts'
import type useFollowButtonLogic from '@/features/Social/Hooks/useFollowButtonLogic.ts'
import type useProfileAppsListLogic from '@/features/Social/Hooks/useProfileAppsListLogic.ts'
import type useProfileFollowListLogic from '@/features/Social/Hooks/useProfileFollowListLogic.ts'
import type useStarButtonLogic from '@/features/Social/Hooks/useStarButtonLogic.ts'
import type {
    ProfileApp,
    ProfileSummary,
    PublicProfile,
} from '@/features/Social/Types/social.types.ts'

let followLogic: ReturnType<typeof useFollowButtonLogic>
let listLogic: ReturnType<typeof useProfileFollowListLogic>
let pageLogic: ReturnType<typeof usePublicProfilePageLogic>
let peopleLogic: ReturnType<typeof usePeopleSearchLogic>
let starLogic: ReturnType<typeof useStarButtonLogic>
let appsLogic: ReturnType<typeof useProfileAppsListLogic>

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
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
mock.module('@rentnerkev/tooltips', () => ({
    CustomTooltip: ({
        children,
        content,
    }: {
        children: ReactNode
        content: ReactNode
    }) => createElement('span', { 'data-tooltip': content }, children),
}))
mock.module('@rentnerkev/inputs', () => ({
    TextInput: ({
        value,
        placeholder,
    }: {
        value: string
        placeholder: string
    }) => createElement('input', { value, placeholder, readOnly: true }),
}))
mock.module('@/features/Social/Hooks/useFollowButtonLogic.ts', () => ({
    default: () => followLogic,
}))
mock.module('@/features/Social/Hooks/useProfileFollowListLogic.ts', () => ({
    default: () => listLogic,
}))
mock.module(
    '@/features/PublicProfile/Hooks/usePublicProfilePageLogic.ts',
    () => ({
        default: () => pageLogic,
    }),
)
mock.module('@/features/People/Hooks/usePeopleSearchLogic.ts', () => ({
    default: () => peopleLogic,
}))
mock.module('@/features/Social/Hooks/useStarButtonLogic.ts', () => ({
    default: () => starLogic,
}))
mock.module('@/features/Social/Hooks/useProfileAppsListLogic.ts', () => ({
    default: () => appsLogic,
}))

const { default: FollowButton } =
    await import('@/features/Social/Components/FollowButton.tsx')
const { default: ProfileCard } =
    await import('@/features/Social/Components/ProfileCard.tsx')
const { default: ProfileFollowList } =
    await import('@/features/Social/Components/ProfileFollowList.tsx')
const { default: PublicProfilePage } =
    await import('@/features/PublicProfile/index.tsx')
const { default: PublicProfileNotFound } =
    await import('@/features/PublicProfile/Components/PublicProfileNotFound.tsx')
const { default: PeoplePage } = await import('@/features/People/index.tsx')
const { default: StarButton } =
    await import('@/features/Social/Components/StarButton.tsx')
const { default: ProfileAppsList } =
    await import('@/features/Social/Components/ProfileAppsList.tsx')
const { default: ProfileAppCard } =
    await import('@/features/Social/Components/ProfileAppCard.tsx')
const { buildPublicProfileHead } =
    await import('@/features/PublicProfile/seo.ts')

const profile: ProfileSummary = {
    id: '019f72d1-dc60-7040-bdac-9e201573f002',
    username: 'kevin',
    bio: 'Builds proxies.',
    isTeam: true,
    profileImageVersion: 9,
    isFollowing: false,
    isSelf: false,
}
const publicProfile: PublicProfile = {
    ...profile,
    bannerVersion: null,
    followerCount: 12,
    followingCount: 3,
    appCount: 4,
    starCount: 6,
    joinedAt: '2026-01-15T00:00:00.000Z',
}
const app: ProfileApp = {
    appId: 'rentner.weather-widget',
    name: 'Wetter',
    summary: 'Zeigt das Wetter.',
    license: 'MIT',
    version: '1.0.0',
    publishedAt: '2026-11-01T00:00:00.000Z',
    logoSrc: null,
    starCount: 3,
    isStarred: false,
}

function render(element: ReturnType<typeof createElement>) {
    return renderToStaticMarkup(element)
}

beforeEach(() => {
    starLogic = {
        state: { isPending: false },
        handler: { handleToggleStar: mock() },
    }
    appsLogic = { state: { apps: [], isLoading: false } }
    followLogic = {
        state: { isPending: false },
        handler: { handleToggleFollow: mock() },
    }
    listLogic = {
        state: {
            profiles: [profile],
            isLoading: false,
            hasMore: true,
            isLoadingMore: false,
        },
        handler: { handleLoadMore: mock() },
    }
    pageLogic = {
        state: {
            activeTab: 'apps',
            bannerSrc: null,
            isSignedIn: true,
            joinedLabel: 'Januar 2026',
            profile: publicProfile,
            profileImageSrc: '/profile.png',
        },
        handler: { handleTabChange: mock() },
    }
    peopleLogic = {
        state: {
            query: '',
            searchedQuery: '',
            canSearch: false,
            isSearching: false,
            profiles: [],
        },
        handler: { handleQueryChange: mock() },
    }
})

describe('follow button', () => {
    it('hides itself on the own profile and asks guests to log in', () => {
        expect(
            render(
                createElement(FollowButton, {
                    profile: { ...profile, isSelf: true },
                    isSignedIn: true,
                }),
            ),
        ).toBe('')
        expect(
            render(createElement(FollowButton, { profile, isSignedIn: false })),
        ).toContain('href="/login"')
    })

    it('shows follow and following states', () => {
        expect(
            render(createElement(FollowButton, { profile, isSignedIn: true })),
        ).toContain('social.follow')
        const following = render(
            createElement(FollowButton, {
                profile: { ...profile, isFollowing: true },
                isSignedIn: true,
            }),
        )
        expect(following).toContain('aria-pressed="true"')
        expect(following).toContain('data-tooltip="social.unfollow"')
    })
})

describe('profile lists', () => {
    it('renders a linked profile card with team badge and bio', () => {
        const html = render(
            createElement(
                'ul',
                null,
                createElement(ProfileCard, {
                    profile,
                    isSignedIn: true,
                }),
            ),
        )
        expect(html).toContain('href="/u/kevin"')
        expect(html).toContain('social.team')
        expect(html).toContain('Builds proxies.')
        expect(html).toContain('profile-64.webp?v=9')
    })

    it('renders loading, empty and paged follow lists', () => {
        let html = render(
            createElement(ProfileFollowList, {
                username: 'kevin',
                list: 'followers',
                isSignedIn: true,
            }),
        )
        expect(html).toContain('social.loadMore')
        listLogic.state.profiles = []
        listLogic.state.hasMore = false
        html = render(
            createElement(ProfileFollowList, {
                username: 'kevin',
                list: 'following',
                isSignedIn: true,
            }),
        )
        expect(html).toContain('social.emptyFollowing')
        listLogic.state.isLoading = true
        expect(
            render(
                createElement(ProfileFollowList, {
                    username: 'kevin',
                    list: 'followers',
                    isSignedIn: true,
                }),
            ),
        ).toContain('animate-spin')
    })
})

describe('public profile page', () => {
    it('shows the hero, counts and the empty apps state', () => {
        const html = render(
            createElement(PublicProfilePage, { username: 'kevin' }),
        )
        expect(html).toContain('kevin')
        expect(html).toContain('social.team')
        expect(html).toContain(
            'social.joined{&quot;date&quot;:&quot;Januar 2026&quot;}',
        )
        expect(html).toContain('12')
        expect(html).toContain('proxy-box-v2')
        expect(html).toContain(
            'social.appsEmpty{&quot;username&quot;:&quot;kevin&quot;}',
        )
        expect(html).toContain('profile.stats.stars')
        expect(html).toContain('<span class="tabular-nums">6</span>')
        expect(html).toContain('profile.stats.downloads')
    })

    it('shows follower lists and an edit link on the own profile', () => {
        pageLogic.state.activeTab = 'followers'
        pageLogic.state.profile = { ...publicProfile, isSelf: true }
        pageLogic.state.bannerSrc = '/api/profiles/x/banner?v=1'
        const html = render(
            createElement(PublicProfilePage, { username: 'kevin' }),
        )
        expect(html).toContain('href="/profile"')
        expect(html).toContain('src="/api/profiles/x/banner?v=1"')
        expect(html).toContain('social.loadMore')
    })

    it('renders nothing before the profile is known and a friendly 404', () => {
        pageLogic.state.profile = null
        expect(
            render(createElement(PublicProfilePage, { username: 'x' })),
        ).toBe('')
        expect(render(createElement(PublicProfileNotFound))).toContain(
            'social.notFoundTitle',
        )
    })

    it('keeps public profiles out of search indexes', () => {
        expect(buildPublicProfileHead('kevin').meta).toContainEqual({
            name: 'robots',
            content: 'noindex, nofollow, nosnippet',
        })
    })
})

describe('people search page', () => {
    it('guides through hint, searching, empty and result states', () => {
        expect(render(createElement(PeoplePage))).toContain('social.searchHint')
        peopleLogic.state.canSearch = true
        peopleLogic.state.isSearching = true
        expect(render(createElement(PeoplePage))).toContain('animate-spin')
        peopleLogic.state.isSearching = false
        peopleLogic.state.searchedQuery = 'zz'
        expect(render(createElement(PeoplePage))).toContain(
            'social.empty{&quot;query&quot;:&quot;zz&quot;}',
        )
        peopleLogic.state.profiles = [profile]
        expect(render(createElement(PeoplePage))).toContain('href="/u/kevin"')
    })
})

describe('profile apps and stars', () => {
    it('shows a loading state, the empty state or app cards', () => {
        appsLogic = { state: { apps: [], isLoading: true } }
        const empty = createElement('p', null, 'empty')
        expect(
            render(
                createElement(ProfileAppsList, {
                    username: 'kevin',
                    isSignedIn: true,
                    emptyState: empty,
                }),
            ),
        ).toContain('social.appsLoading')

        appsLogic = { state: { apps: [], isLoading: false } }
        expect(
            render(
                createElement(ProfileAppsList, {
                    username: 'kevin',
                    isSignedIn: true,
                    emptyState: empty,
                }),
            ),
        ).toBe('<p>empty</p>')

        appsLogic = { state: { apps: [app], isLoading: false } }
        const html = render(
            createElement(ProfileAppsList, {
                username: 'kevin',
                isSignedIn: true,
                emptyState: empty,
            }),
        )
        expect(html).toContain('Wetter')
        expect(html).toContain('rentner.weather-widget')
        expect(html).toContain('Zeigt das Wetter.')
        expect(html).toContain(
            'social.appVersion{&quot;version&quot;:&quot;1.0.0&quot;}',
        )
        expect(html).toContain('MIT')
        expect(html).toContain('aria-pressed="false"')
    })

    it('sends signed-out visitors to the login with the star count', () => {
        const html = render(
            createElement(StarButton, { app, isSignedIn: false }),
        )
        expect(html).toContain('href="/login"')
        expect(html).toContain('social.loginToStar')
        expect(html).toContain('<span class="tabular-nums">3</span>')
    })

    it('marks starred apps and shows pending stars', () => {
        const starred = render(
            createElement(StarButton, {
                app: { ...app, isStarred: true, starCount: 4 },
                isSignedIn: true,
            }),
        )
        expect(starred).toContain('aria-pressed="true"')
        expect(starred).toContain('fill-current')
        expect(starred).toContain('social.unstar')

        starLogic.state.isPending = true
        const pendingStar = render(
            createElement(StarButton, { app, isSignedIn: true }),
        )
        expect(pendingStar).toContain('animate-spin')
        expect(pendingStar).toContain('disabled=""')
        expect(pendingStar).toContain('social.star')
    })
})

describe('profile app card', () => {
    it('links to the store detail page and hides editing by default', () => {
        const html = render(
            createElement(ProfileAppCard, { app, isSignedIn: true }),
        )
        expect(html).toContain('href="/apps/$appId"')
        expect(html).not.toContain('/user/app-store/')
        expect(html).not.toContain('appStore.edit')
    })

    it('shows the store edit link only when editing is allowed', () => {
        const html = render(
            createElement(ProfileAppCard, {
                app,
                isSignedIn: true,
                canEdit: true,
            }),
        )
        expect(html).toContain('href="/user/app-store/$appId"')
        expect(html).toContain('data-tooltip="appStore.edit"')
    })
})
