import { Package } from 'lucide-react'
import type { AppLogoProps } from '../Types/app-store-component.types.ts'

const SIZE_CLASSES = {
    sm: 'h-12 w-12 border-[3px]',
    md: 'h-20 w-20 border-[3px]',
    lg: 'h-28 w-28 border-4 sm:h-36 sm:w-36',
} as const

const ICON_CLASSES = { sm: 'h-6 w-6', md: 'h-9 w-9', lg: 'h-14 w-14' } as const

/** Store logo tile; falls back to the comic package icon without a logo. */
export default function AppLogo({ logoSrc, name, size }: AppLogoProps) {
    const frame = `${SIZE_CLASSES[size]} shrink-0 overflow-hidden rounded-md border-ink shadow-[3px_3px_0_0_var(--app-comic-pop,var(--color-ink))]`

    if (logoSrc) {
        return (
            <img
                src={logoSrc}
                alt={name}
                loading="lazy"
                className={`${frame} bg-mist-100 object-cover`}
            />
        )
    }

    return (
        <span
            aria-hidden="true"
            className={`${frame} grid place-items-center bg-proxy-400 text-on-proxy`}
        >
            <Package className={ICON_CLASSES[size]} />
        </span>
    )
}
