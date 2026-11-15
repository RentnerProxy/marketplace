import { describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import NotFound from '@/shared/NothingFound/index.tsx'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@tanstack/react-router', () => ({
    Link: ({
        to,
        children,
        ...props
    }: {
        to: string
        children: ReactNode
        'aria-label'?: string
    }) => createElement('a', { ...props, href: to }, children),
}))

describe('Missing route page', () => {
    it('renders the 404 explanation and an accessible route back to the dashboard', () => {
        const html = renderToStaticMarkup(NotFound())
        expect(html).toContain('404')
        expect(html).toContain('shared.notFound.title')
        expect(html).toContain('shared.notFound.description')
        expect(html).toContain('aria-label="shared.notFound.backToDashboard"')
        expect(html).toContain('href="/"')
    })
})
