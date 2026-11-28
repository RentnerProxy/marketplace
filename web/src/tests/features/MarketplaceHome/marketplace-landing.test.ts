import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import type { AnchorHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    hookReact,
    renderHook,
    resetHooks,
} from '@/tests/layouts/hook-harness.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import {
    APP_LIFECYCLE_CONNECTIONS,
    APP_LIFECYCLE_STEPS,
} from '@/features/MarketplaceHome/Components/AppLifecycle/app-lifecycle.config.ts'
import type { AppLifecycleConnection } from '@/features/MarketplaceHome/Components/AppLifecycle/Types/app-lifecycle.types.ts'

vi.mock('react', () => hookReact)
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
vi.mock('@tanstack/react-router', () => ({
    Link: ({
        to,
        hash,
        ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & {
        to: string
        hash?: string
    }) => createElement('a', { ...props, href: hash ? `${to}#${hash}` : to }),
}))
vi.mock('@/features/AppCatalog/Components/AppCatalog.tsx', () => ({
    default: () => createElement('section', null, 'Published apps'),
}))

const { default: MarketplaceHome } =
    await import('@/features/MarketplaceHome/index.tsx')
const { default: AppLifecycle } =
    await import('@/features/MarketplaceHome/Components/AppLifecycle/index.tsx')
const { default: MarketplaceApps } =
    await import('@/features/MarketplaceApps/index.tsx')

const renderLifecycle = () => renderHook(AppLifecycle)

function stepButton(tree: ReturnType<typeof AppLifecycle>, id: string) {
    return findElement(
        tree,
        (element) =>
            element.type === 'button' &&
            elements(element.props.children).some(
                (child) =>
                    child.props.children ===
                    `marketplace.flow.steps.${id}.title`,
            ),
    )
}

function activeConnectionTrails(tree: ReturnType<typeof AppLifecycle>) {
    return elements(tree).filter(
        (element) =>
            element.type === 'path' &&
            element.props.className === 'marketplace-flow-travel',
    )
}

beforeEach(resetHooks)

describe('marketplace landing page', () => {
    it('introduces the marketplace with catalog and repository calls to action', () => {
        const html = renderToStaticMarkup(createElement(MarketplaceHome))

        expect(html).toContain('aria-labelledby="marketplace-title"')
        expect(html).toContain('RentnerProxy')
        expect(html).toContain('marketplace.heroEyebrow')
        expect(html).toContain('marketplace.tagline')
        expect(html).toContain('marketplace.availability')
        expect(html).toContain('href="/apps"')
        expect(html).toContain(`href="${PROJECT_CONFIG.repositoryUrl}"`)
        expect(html).toContain('rel="noopener noreferrer"')
        expect(html).toContain('/brand/proxy-box-v2-640.webp')
        expect(html).toContain('loading="eager"')
        expect(html).toContain('id="marketplace-flow"')
        expect(html).toContain('marketplace.flow.title')
        expect(html).toContain('id="marketplace-flow-detail"')
    })
})

describe('app lifecycle flow', () => {
    it('lists every stage in order and starts with the template details', () => {
        const html = renderToStaticMarkup(createElement(AppLifecycle))

        for (const step of APP_LIFECYCLE_STEPS) {
            expect(html).toContain(`marketplace.flow.steps.${step.id}.caption`)
            expect(html).toContain(`marketplace.flow.roles.${step.role}`)
        }
        expect(html.split('aria-pressed="true"')).toHaveLength(2)
        expect(html).toContain(
            'marketplace.flow.detailLabel{&quot;number&quot;:&quot;01&quot;,&quot;total&quot;:6}',
        )
        expect(html).toContain('marketplace.flow.steps.template.description')
        expect(html).toContain('id="marketplace-flow-arrow-review"')
        expect(html).toContain('stroke-dasharray="5 6"')
        expect(html).toContain('marketplace.flow.legend.release')
    })

    it('highlights only the connections of the active stage', () => {
        const tree = renderLifecycle()
        expect(activeConnectionTrails(tree)).toHaveLength(
            APP_LIFECYCLE_CONNECTIONS.filter(
                (connection: AppLifecycleConnection) =>
                    connection.from === 'template' ||
                    connection.to === 'template',
            ).length,
        )
        expect(stepButton(tree, 'template').props['aria-pressed']).toBe(true)
        expect(stepButton(tree, 'review').props['aria-pressed']).toBe(false)
    })

    it('selects a stage on click and announces its details', () => {
        invoke(stepButton(renderLifecycle(), 'review'), 'onClick')

        const tree = renderLifecycle()
        expect(stepButton(tree, 'review').props['aria-pressed']).toBe(true)
        expect(stepButton(tree, 'template').props['aria-pressed']).toBe(false)
        expect(activeConnectionTrails(tree)).toHaveLength(3)
        const html = renderToStaticMarkup(tree)
        expect(html).toContain(
            'marketplace.flow.detailLabel{&quot;number&quot;:&quot;04&quot;,&quot;total&quot;:6}',
        )
        expect(html).toContain('marketplace.flow.steps.review.description')
        expect(html).not.toContain(
            'marketplace.flow.steps.template.description',
        )
    })
})

describe('marketplace app catalog page', () => {
    it('shows published apps, the planned app types and a way back to the flow', () => {
        const html = renderToStaticMarkup(createElement(MarketplaceApps))

        expect(html).toContain('marketplace.catalog.title')
        expect(html).toContain('Published apps')
        for (const id of [
            'monitoring',
            'docker',
            'loadBalancer',
            'dns',
            'oidc',
            'crowdsec',
        ]) {
            expect(html).toContain(`marketplace.apps.${id}.title`)
            expect(html).toContain(`marketplace.apps.${id}.description`)
        }
        expect(html.split('common.planned')).toHaveLength(7)
        expect(html).toContain('href="/#marketplace-flow"')
        expect(html).toContain('marketplace.catalog.backToFlow')
    })
})
