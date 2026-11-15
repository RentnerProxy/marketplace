import { describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import de from '@/language/Locales/de.json'
import en from '@/language/Locales/en.json'
import type { DashboardServiceHealth } from '@/features/Admin/Dashboard/Types/dashboard-domain.types.ts'

const translations = createInstance()
await translations.init({
    lng: 'de',
    resources: { de: { translation: de }, en: { translation: en } },
    interpolation: { escapeValue: false },
})
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: translations.t.bind(translations) }),
}))

const { default: ServiceStatusCard } =
    await import('@/features/Admin/Dashboard/Components/ServiceStatusCard.tsx')

describe('Farben und verständliche Texte der Statuskarten', function () {
    it.each([
        {
            health: { status: 'running', detail: 'heartbeatCurrent' },
            color: 'success',
        },
        {
            health: { status: 'starting', detail: 'workerStarting' },
            color: 'warning',
        },
        {
            health: { status: 'connecting', detail: 'connectionPending' },
            color: 'warning',
        },
        {
            health: { status: 'down', detail: 'heartbeatMissing' },
            color: 'danger',
        },
        {
            health: { status: 'error', detail: 'workerUnhealthy' },
            color: 'danger',
        },
        {
            health: { status: 'checking', detail: 'checking' },
            color: 'warning',
        },
        {
            health: { status: 'unknown', detail: 'statusUnavailable' },
            color: 'warning',
        },
        {
            health: { status: 'unknown', detail: 'workerStatusUnavailable' },
            color: 'warning',
        },
        {
            health: { status: 'error', detail: 'rateLimitUnavailable' },
            color: 'danger',
        },
    ] satisfies Array<{ health: DashboardServiceHealth; color: string }>)(
        'zeigt $health.status mit Farbe und Text in beiden Sprachen',
        async function ({ health, color }) {
            async function expectTranslatedCard(language: 'de' | 'en') {
                await translations.changeLanguage(language)
                const source = language === 'de' ? de : en
                const html = renderToStaticMarkup(
                    createElement(ServiceStatusCard, {
                        service: 'worker',
                        health,
                        isSelected: false,
                        onSelect: vi.fn(),
                    }),
                )
                expect(html).toContain(`bg-${color}`)
                expect(html).toContain(
                    source.admin.dashboard.status[health.status],
                )
                expect(html).toContain(
                    source.admin.dashboard.details[health.detail],
                )
                expect(html).toContain('aria-live="polite"')
                expect(html).not.toContain('admin.dashboard.')
            }

            await expectTranslatedCard('de')
            await expectTranslatedCard('en')
        },
    )
})
