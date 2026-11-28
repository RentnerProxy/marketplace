import { describe, expect, it, mock } from 'bun:test'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@tanstack/react-router', () => ({
    Link: ({
        to,
        hash,
        children,
    }: {
        to: string
        hash?: string
        children: ReactNode
    }) => createElement('a', { href: `${to}#${hash ?? ''}` }, children),
}))
mock.module('@/features/AppCatalog/Components/AppCatalog.tsx', () => ({
    default: ({
        title,
        hideWhenEmpty,
    }: {
        title: string
        hideWhenEmpty: boolean
    }) =>
        createElement('div', null, `catalog:${title}:${String(hideWhenEmpty)}`),
}))

const { default: MarketplaceApps } =
    await import('@/features/MarketplaceApps/index.tsx')
const { buildAppDetailHead } = await import('@/features/AppStore/Detail/seo.ts')

describe('public apps page', () => {
    it('shows the published catalog above the planned apps', () => {
        const html = renderToStaticMarkup(createElement(MarketplaceApps))
        expect(html).toContain('marketplace.catalog.title')
        expect(html).toContain('catalog:appStore.catalogTitle:true')
        expect(html.indexOf('catalog:appStore.catalogTitle')).toBeLessThan(
            html.indexOf('marketplace.apps.monitoring.title'),
        )
        expect(html).toContain('href="/#marketplace-flow"')
    })
})

describe('app detail head', () => {
    it('names the app, describes it and keeps it out of search indexes', () => {
        const head = buildAppDetailHead('Wetter', 'Zeigt das Wetter.')
        expect(head.meta[0]?.title).toContain('Wetter')
        expect(head.meta).toContainEqual({
            name: 'description',
            content: 'Zeigt das Wetter.',
        })
        expect(head.meta.at(-1)).toMatchObject({ name: 'robots' })
    })
})
