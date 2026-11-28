import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type useAppCatalogLogic from '@/features/AppCatalog/Hooks/useAppCatalogLogic.ts'
import type { CatalogApp } from '@/features/AppStore/Types/app-store.types.ts'

let logic: ReturnType<typeof useAppCatalogLogic>

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
                href: Object.entries(params ?? {}).reduce(
                    (href, [key, value]) => href.replace(`$${key}`, value),
                    to,
                ),
                className,
            },
            children,
        ),
}))
mock.module('@rentnerkev/tooltips', () => ({
    CustomTooltip: ({ children }: { children: ReactNode }) => children,
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
mock.module('@rentnerkev/select', () => ({
    CustomSelect: ({
        label,
        value,
        options,
    }: {
        label: string
        value: string
        options: Array<{ value: string; label: string }>
    }) =>
        createElement(
            'select',
            { 'aria-label': label, value, readOnly: true },
            options.map((option) =>
                createElement(
                    'option',
                    { key: option.value, value: option.value },
                    option.label,
                ),
            ),
        ),
}))
mock.module('@/features/AppCatalog/Hooks/useAppCatalogLogic.ts', () => ({
    default: () => logic,
}))
mock.module('@/features/Social/Hooks/useStarButtonLogic.ts', () => ({
    default: () => ({
        state: { isPending: false },
        handler: { handleToggleStar: mock() },
    }),
}))

const { default: AppCatalog } =
    await import('@/features/AppCatalog/Components/AppCatalog.tsx')
const { default: AppCatalogPage } =
    await import('@/features/AppCatalog/index.tsx')
const { default: SubmissionStep } =
    await import('@/features/Marketplace/Components/SubmissionStep.tsx')

const app: CatalogApp = {
    appId: 'rentner.weather',
    name: 'Wetter',
    summary: 'Zeigt das Wetter.',
    license: 'MIT',
    version: '1.0.0',
    publishedAt: '2026-11-01T00:00:00.000Z',
    logoSrc: '/images/apps/rentner.weather/logo.webp',
    starCount: 4,
    isStarred: false,
    publisher: 'kevin',
}

function render(element: ReturnType<typeof createElement>) {
    return renderToStaticMarkup(element)
}

beforeEach(() => {
    logic = {
        state: {
            apps: [app],
            totalCount: 1,
            isLoading: false,
            isSignedIn: true,
            query: '',
            sort: 'newest',
            starredOnly: false,
        },
        handler: {
            handleQueryChange: mock(),
            handleSortChange: mock(),
            handleToggleStarredOnly: mock(),
            handleResetFilters: mock(),
        },
    }
})

describe('app catalog', () => {
    it('shows toolbar, result count and cards with logo, publisher and stars', () => {
        const html = render(createElement(AppCatalog, { title: 'Catalog' }))
        expect(html).toContain('id="app-catalog-title"')
        expect(html).toContain('catalog.searchPlaceholder')
        expect(html).toContain('catalog.sort.stars')
        expect(html).toContain('aria-pressed="false"')
        expect(html).toContain(
            'catalog.resultCount{&quot;count&quot;:1,&quot;total&quot;:1}',
        )
        expect(html).toContain('href="/apps/rentner.weather"')
        expect(html).toContain('src="/images/apps/rentner.weather/logo.webp"')
        expect(html).toContain('href="/u/kevin"')
        expect(html).toContain('<span class="tabular-nums">4</span>')
    })

    it('hides the star filter for anonymous visitors', () => {
        logic.state.isSignedIn = false
        expect(render(createElement(AppCatalog))).not.toContain(
            'catalog.starredOnly',
        )
    })

    it('offers a reset when no app matches the filters', () => {
        logic.state.apps = []
        const html = render(createElement(AppCatalog))
        expect(html).toContain('catalog.noMatches')
        expect(html).toContain('catalog.resetFilters')
    })

    it('shows loading and empty states or nothing on public pages', () => {
        logic.state.isLoading = true
        expect(render(createElement(AppCatalog))).toContain('catalog.loading')
        expect(render(createElement(AppCatalog, { hideWhenEmpty: true }))).toBe(
            '',
        )
        logic.state.isLoading = false
        logic.state.totalCount = 0
        logic.state.apps = []
        expect(render(createElement(AppCatalog, { hideWhenEmpty: true }))).toBe(
            '',
        )
        expect(
            render(
                createElement(AppCatalog, {
                    emptyState: createElement('p', null, 'nothing yet'),
                }),
            ),
        ).toBe('<p>nothing yet</p>')
    })

    it('invites to submit an app on the empty signed-in catalog page', () => {
        logic.state.totalCount = 0
        logic.state.apps = []
        const html = render(createElement(AppCatalogPage))
        expect(html).toContain('catalog.emptyTitle')
        expect(html).toContain('href="/user/app-submissions"')
    })
})

describe('submission steps', () => {
    it('numbers each step and marks finished ones', () => {
        const open = render(
            createElement(SubmissionStep, {
                step: 2,
                title: 'Version',
                description: 'Submit it',
                children: createElement('p', null, 'form'),
            }),
        )
        expect(open).toContain('aria-labelledby="submission-step-2"')
        expect(open).toContain('bg-white text-ink')
        expect(open).toContain('<p>form</p>')
        const done = render(
            createElement(SubmissionStep, {
                step: 1,
                title: 'Proof',
                description: 'Prove it',
                isDone: true,
                children: null,
            }),
        )
        expect(done).toContain('bg-proxy-400 text-on-proxy')
    })
})
