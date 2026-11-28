export type MarketplaceLogoSize = 'sm' | 'md' | 'lg'

export type MarketplaceLogoProps = {
    className?: string
    priority?: boolean
    showMarketplace?: boolean
    size?: MarketplaceLogoSize
    tone?: 'ink' | 'light'
}

export type BlinkingHeadProps = {
    className?: string
    delay?: number
    priority?: boolean
    size?: 'sm' | 'lg'
}
