import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import type { RouteErrorLogicReturn } from '@/shared/RouteErrorComponent/Types/routeError.types.ts'
import { findElement, invoke } from './renderHelpers.ts'

let logic: RouteErrorLogicReturn
const originalDev = process.env.DEV
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@/shared/RouteErrorComponent/Hooks/useRouteErrorLogic.ts', () => ({
    default: () => logic,
}))

beforeEach(() => {
    logic = {
        state: {
            copied: false,
            isTechnicalDetailsOpen: false,
            details: {
                category: 'server',
                errorName: 'ServiceError',
                message: 'Service temporarily unavailable',
                statusCode: 503,
                cause: 'Upstream timeout',
                errorPath: '/web/src/routes/example.tsx',
                technicalDetails: 'Safe diagnostic stack',
            },
        },
        handler: {
            handleCopyTechnicalDetails: mock(async () => {}),
            handleReload: mock(),
        },
        setter: { setIsTechnicalDetailsOpen: mock() },
    }
})

afterEach(() => {
    if (originalDev === undefined) delete process.env.DEV
    else process.env.DEV = originalDev
})

describe('RouteErrorComponent', () => {
    it('renders category, status and cause and wires retry and reload independently', () => {
        const reset = mock()
        const tree = RouteErrorComponent({ error: new Error('test'), reset })
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('shared.routeError.descriptions.server')
        expect(html).toContain('HTTP 503')
        expect(html).toContain('Service temporarily unavailable')
        expect(html).toContain('Upstream timeout')
        invoke(
            findElement(tree, (element) => element.props.onClick === reset),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick === logic.handler.handleReload,
            ),
            'onClick',
        )
        expect(reset).toHaveBeenCalledTimes(1)
        expect(logic.handler.handleReload).toHaveBeenCalledTimes(1)
    })

    it('omits optional status and cause for generic errors', () => {
        logic.state.details = {
            category: 'generic',
            errorName: 'Error',
            message: 'Unknown failure',
            technicalDetails: '',
        }
        const html = renderToStaticMarkup(
            RouteErrorComponent({ error: new Error('test'), reset: mock() }),
        )
        expect(html).toContain('shared.routeError.descriptions.generic')
        expect(html).not.toContain('HTTP ')
        expect(html).not.toContain('shared.routeError.cause')
    })

    it('toggles development diagnostics and exposes safe copy feedback', async () => {
        process.env.DEV = 'true'
        const props = { error: new Error('test'), reset: mock() }
        let tree = RouteErrorComponent(props)
        expect(renderToStaticMarkup(tree)).toContain('aria-expanded="false"')
        invoke(
            findElement(
                tree,
                (element) => element.props['aria-expanded'] === false,
            ),
            'onClick',
        )
        expect(logic.setter.setIsTechnicalDetailsOpen).toHaveBeenCalledWith(
            true,
        )
        logic.state.isTechnicalDetailsOpen = true
        tree = RouteErrorComponent(props)
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('/web/src/routes/example.tsx')
        expect(html).toContain('Safe diagnostic stack')
        expect(html).toContain('shared.routeError.copyDetails')
        await invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    logic.handler.handleCopyTechnicalDetails,
            ),
            'onClick',
        )
        expect(logic.handler.handleCopyTechnicalDetails).toHaveBeenCalledTimes(
            1,
        )
        logic.state.copied = true
        logic.state.details.errorPath = undefined
        expect(renderToStaticMarkup(RouteErrorComponent(props))).toContain(
            'shared.routeError.copied',
        )
        expect(renderToStaticMarkup(RouteErrorComponent(props))).not.toContain(
            '/web/src/routes/example.tsx',
        )
        invoke(
            findElement(
                tree,
                (element) => element.props['aria-expanded'] === true,
            ),
            'onClick',
        )
        expect(logic.setter.setIsTechnicalDetailsOpen).toHaveBeenCalledWith(
            false,
        )
    })
})
