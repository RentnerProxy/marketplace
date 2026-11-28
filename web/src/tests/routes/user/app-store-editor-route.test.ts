import { describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

type RouteOptions = {
    beforeLoad: (context: { params: { appId: string } }) => void
    component: () => ReturnType<typeof createElement>
}

let params = { appId: 'rentner.weather' }
const notFoundError = new Error('not found')

mock.module('@tanstack/react-router', () => ({
    createFileRoute: () => (options: RouteOptions) => ({
        ...options,
        useParams: () => params,
    }),
    notFound: () => notFoundError,
}))
mock.module('@/features/AppStore/Editor/index.tsx', () => ({
    default: ({ appId }: { appId: string }) =>
        createElement('main', null, `editor:${appId}`),
}))
mock.module('@/shared/RouteErrorComponent/RouteErrorComponent.tsx', () => ({
    RouteErrorComponent: () => null,
}))

const { Route } =
    await import('@/routes/_authenticated/user/app-submissions_.$appId.tsx')
const route = Route as unknown as RouteOptions

describe('store listing editor route', () => {
    it('accepts valid app ids and renders the editor for them', () => {
        expect(() =>
            route.beforeLoad({ params: { appId: 'rentner.weather' } }),
        ).not.toThrow()
        expect(renderToStaticMarkup(createElement(route.component))).toBe(
            '<main>editor:rentner.weather</main>',
        )
    })

    it('answers malformed app ids with not found', () => {
        params = { appId: '../etc' }
        expect(() => route.beforeLoad({ params })).toThrow(notFoundError)
    })
})
