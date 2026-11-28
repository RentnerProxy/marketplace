import type { BlinkingHeadProps } from './Types/marketplace-logo.types.ts'

const HEAD_BLINK_FRAMES = 9
const HEAD_BLINK_SPRITES = {
    lg: { frameHeight: 192, frameWidth: 175, name: 'head-blink-v1-192' },
    sm: { frameHeight: 96, frameWidth: 88, name: 'head-blink-v1-96' },
} as const

/**
 * The RentnerProxy head logo from the landing page. A nine-frame film strip
 * slides inside a frame-sized window; reduced motion rests on open eyes.
 */
export default function BlinkingHead({
    className = '',
    delay = 0,
    priority = false,
    size = 'sm',
}: BlinkingHeadProps) {
    const sprite = HEAD_BLINK_SPRITES[size]

    return (
        <span
            aria-hidden="true"
            className={`relative block aspect-[345/378] overflow-hidden ${className}`}
        >
            <picture className="contents">
                <source
                    srcSet={`/brand/${sprite.name}.avif`}
                    type="image/avif"
                />
                <img
                    alt=""
                    className="absolute left-0 top-0 h-full w-[900%] max-w-none animate-head-blink motion-reduce:animate-none"
                    decoding="async"
                    draggable={false}
                    fetchPriority={priority ? 'high' : undefined}
                    height={sprite.frameHeight}
                    loading={priority ? 'eager' : 'lazy'}
                    src={`/brand/${sprite.name}.webp`}
                    style={{ animationDelay: `${delay}s` }}
                    width={sprite.frameWidth * HEAD_BLINK_FRAMES}
                />
            </picture>
        </span>
    )
}
