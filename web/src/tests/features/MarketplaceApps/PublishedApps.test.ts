import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type usePublishedAppsLogic from '@/features/MarketplaceApps/Hooks/usePublishedAppsLogic.ts'
import type { ProfileApp } from '@/features/Social/Types/social.types.ts'

let logic: ReturnType<typeof usePublishedAppsLogic>

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
    }: {
        to: string
        params?: Record<string, string>
        children: ReactNode
    }) =>
        createElement(
            'a',
            {
                href: to.replace(
                    /\$(\w+)/gu,
                    (_match, key: string) => params?.[key] ?? '',
                ),
            },
            children,
        ),
}))
mock.module('@rentnerkev/tooltips', () => ({
    CustomTooltip: ({ children }: { children: ReactNode }) =>
        createElement('span', null, children),
}))
mock.module('@/features/Social/Hooks/useStarButtonLogic.ts', () => ({
    default: () => ({
        state: { isPending: false },
        handler: { handleToggleStar: mock() },
    }),
}))
mock.module(
    '@/features/MarketplaceApps/Hooks/usePublishedAppsLogic.ts',
    () => ({
        default: () => logic,
    }),
)

const { default: PublishedApps } =
    await import('@/features/MarketplaceApps/Components/PublishedApps.tsx')

const app: ProfileApp = {
    appId: 'rentner.weather-widget',
    name: 'Wetter',
    summary: 'Zeigt das Wetter.',
    license: 'MIT',
    version: '1.0.0',
    publishedAt: '2026-11-01T00:00:00.000Z',
    logoSrc: '/images/apps/rentner.weather-widget/logo.webp',
    starCount: 3,
    isStarred: false,
}

beforeEach(() => {
    logic = { state: { apps: [], isSignedIn: false } }
})

describe('published apps catalog', () => {
    it('renders nothing before the first publication', () => {
        expect(renderToStaticMarkup(createElement(PublishedApps))).toBe('')
    })

    it('lists published apps as cards linking to their detail page', () => {
        logic = {
            state: {
                apps: [
                    app,
                    { ...app, appId: 'rentner.other', name: 'Anderes' },
                ],
                isSignedIn: true,
            },
        }
        const html = renderToStaticMarkup(createElement(PublishedApps))
        expect(html).toContain('appStore.catalogTitle')
        expect(html).toContain('href="/apps/rentner.weather-widget"')
        expect(html).toContain('href="/apps/rentner.other"')
        expect(html).toContain('Anderes')
        expect(html).toContain(
            'src="/images/apps/rentner.weather-widget/logo.webp"',
        )
        expect(html).toContain('aria-pressed="false"')
    })

    it('sends signed-out visitors to the login from the star button', () => {
        logic = { state: { apps: [app], isSignedIn: false } }
        expect(renderToStaticMarkup(createElement(PublishedApps))).toContain(
            'href="/login"',
        )
    })

    it('does not offer editing on the public catalog', () => {
        logic = { state: { apps: [app], isSignedIn: true } }
        expect(
            renderToStaticMarkup(createElement(PublishedApps)),
        ).not.toContain('/user/app-store/')
    })
})
