import type { MarketplaceSeoPage } from '@/lib/Seo/Types/seo.types.ts'

export const marketplacePublicOrigin = 'https://market.rentner.dev'

export const marketplaceRobotsDirectives = {
    public: 'index, follow, max-image-preview:large',
    private: 'noindex, nofollow, nosnippet',
} as const

export const marketplaceSeoPages = [
    {
        path: '/',
        title: 'RentnerProxy Marketplace – Apps for your stack',
        description:
            'The official RentnerProxy marketplace. Explore planned monitoring, DNS and security apps, and follow the latest development updates.',
    },
    {
        path: '/apps',
        title: 'Apps and extensions – RentnerProxy Marketplace',
        description:
            'Monitoring, DNS, security and more: explore planned official RentnerProxy apps. Installation will arrive as the marketplace grows.',
    },
    {
        path: '/blog',
        title: 'Blog and changelog – RentnerProxy Marketplace',
        description:
            'News, features and changelogs from the central RentnerProxy marketplace. Follow development through alpha, beta and stable releases.',
    },
    {
        path: '/imprint',
        title: 'Legal notice – RentnerProxy Marketplace',
        description:
            'Legal notice for the RentnerProxy marketplace, including operator details and contact information.',
    },
    {
        path: '/privacy',
        title: 'Privacy policy – RentnerProxy Marketplace',
        description:
            'Privacy information for the RentnerProxy marketplace, including how personal data is processed and your rights.',
    },
] as const satisfies readonly MarketplaceSeoPage[]
