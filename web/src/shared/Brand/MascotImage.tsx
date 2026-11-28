import type { MascotImageProps } from './Types/mascot-image.types.ts'

const MASCOT_WIDTHS = [320, 640, 960] as const
const MASCOT_ASSETS = {
    proxyBox: { name: 'proxy-box-v2', width: 640, height: 740 },
    thumbsUp: { name: 'thumbs-up-v1', width: 640, height: 830 },
} as const

function getMascotSrcSet(name: string, format: 'avif' | 'webp') {
    return MASCOT_WIDTHS.map(
        (width) => `/brand/${name}-${width}.${format} ${width}w`,
    ).join(', ')
}

/** Landing page mascot art; decorative, so it carries no alternative text. */
export default function MascotImage({
    className = '',
    mascot,
    priority = false,
    sizes,
}: MascotImageProps) {
    const asset = MASCOT_ASSETS[mascot]

    return (
        <picture className="contents">
            <source
                srcSet={getMascotSrcSet(asset.name, 'avif')}
                sizes={sizes}
                type="image/avif"
            />
            <img
                alt=""
                aria-hidden="true"
                className={`h-auto select-none ${className}`}
                decoding="async"
                draggable={false}
                fetchPriority={priority ? 'high' : undefined}
                height={asset.height}
                loading={priority ? 'eager' : 'lazy'}
                sizes={sizes}
                src={`/brand/${asset.name}-640.webp`}
                srcSet={getMascotSrcSet(asset.name, 'webp')}
                width={asset.width}
            />
        </picture>
    )
}
