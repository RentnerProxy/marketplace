import type { MarketplaceSeoPage } from '@/lib/Seo/Types/seo.types.ts'

export const marketplacePublicOrigin = 'https://market.rentner.dev'

export const marketplaceRobotsDirectives = {
    public: 'index, follow, max-image-preview:large',
    private: 'noindex, nofollow, nosnippet',
} as const

export const marketplaceSeoPages = [
    {
        path: '/',
        title: 'RentnerProxy Marketplace – Apps für deinen Stack',
        description:
            'Der offizielle Marketplace für RentnerProxy. Entdecke geplante Apps für Monitoring, DNS und Sicherheit sowie Neuigkeiten aus der Entwicklung.',
    },
    {
        path: '/apps',
        title: 'Apps und Erweiterungen – RentnerProxy Marketplace',
        description:
            'Monitoring, DNS, Sicherheit und mehr: Entdecke die geplanten offiziellen RentnerProxy-Apps. Die Installation folgt mit dem Ausbau des Marketplace.',
    },
    {
        path: '/blog',
        title: 'Blog und Changelog – RentnerProxy Marketplace',
        description:
            'Neuigkeiten, Funktionen und Changelogs des zentralen RentnerProxy Marketplace. Verfolge die Entwicklung mit Alpha-, Beta- und Stable-Versionen.',
    },
    {
        path: '/imprint',
        title: 'Impressum – RentnerProxy Marketplace',
        description:
            'Impressum des RentnerProxy Marketplace mit Angaben zum Betreiber und Kontaktmöglichkeiten.',
    },
    {
        path: '/privacy',
        title: 'Datenschutz – RentnerProxy Marketplace',
        description:
            'Datenschutzhinweise des RentnerProxy Marketplace zur Verarbeitung personenbezogener Daten und zu deinen Rechten.',
    },
] as const satisfies readonly MarketplaceSeoPage[]
