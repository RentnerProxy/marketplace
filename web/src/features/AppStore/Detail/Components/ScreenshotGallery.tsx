import { CustomTooltip } from '@rentnerkev/tooltips'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useScreenshotGalleryLogic from '../../Hooks/useScreenshotGalleryLogic.ts'
import type { ScreenshotGalleryProps } from '../../Types/app-store-component.types.ts'

const navButton =
    'grid h-11 w-11 cursor-pointer place-items-center rounded-full border-[3px] border-ink bg-mist-50 text-ink shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-x-px hover:-translate-y-px'

/** Clickable 16:9 carousel with thumbnails and a fullscreen lightbox. */
export default function ScreenshotGallery({
    name,
    screenshots,
}: ScreenshotGalleryProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useScreenshotGalleryLogic(screenshots.length)
    const active = screenshots[state.activeIndex]
    const hasMany = screenshots.length > 1

    if (!active) {
        return null
    }

    const alt = t('appStore.detail.screenshotAlt', {
        name,
        number: state.activeIndex + 1,
        total: screenshots.length,
    })
    const previousLabel = t('appStore.detail.previous')
    const nextLabel = t('appStore.detail.next')

    return (
        <section
            aria-labelledby="app-gallery-title"
            className="flex flex-col gap-4"
        >
            <h2 id="app-gallery-title" className="comic-title text-4xl">
                {t('appStore.screenshots.title')}
            </h2>
            <div className="comic-panel relative overflow-hidden bg-ink">
                <button
                    type="button"
                    onClick={handler.handleOpenLightbox}
                    aria-label={t('appStore.detail.openLightbox')}
                    className="group block aspect-video w-full cursor-zoom-in"
                >
                    <img
                        src={active.src}
                        alt={alt}
                        className="h-full w-full object-cover"
                    />
                    <span
                        aria-hidden="true"
                        className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-md border-2 border-ink bg-mist-50 text-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    >
                        <Expand className="h-5 w-5" />
                    </span>
                </button>
                {hasMany && (
                    <>
                        <div className="absolute left-3 top-1/2 -translate-y-1/2">
                            <CustomTooltip side="top" content={previousLabel}>
                                <button
                                    type="button"
                                    aria-label={previousLabel}
                                    onClick={handler.handlePrevious}
                                    className={navButton}
                                >
                                    <ChevronLeft
                                        aria-hidden="true"
                                        className="h-6 w-6"
                                    />
                                </button>
                            </CustomTooltip>
                        </div>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <CustomTooltip side="top" content={nextLabel}>
                                <button
                                    type="button"
                                    aria-label={nextLabel}
                                    onClick={handler.handleNext}
                                    className={navButton}
                                >
                                    <ChevronRight
                                        aria-hidden="true"
                                        className="h-6 w-6"
                                    />
                                </button>
                            </CustomTooltip>
                        </div>
                        <span className="comic-chip absolute bottom-3 left-3 tabular-nums">
                            {state.activeIndex + 1}/{screenshots.length}
                        </span>
                    </>
                )}
            </div>

            {hasMany && (
                <ol className="flex gap-3 overflow-x-auto pb-2">
                    {screenshots.map((screenshot, index) => (
                        <li key={screenshot.id} className="shrink-0">
                            <button
                                type="button"
                                aria-current={index === state.activeIndex}
                                aria-label={t('appStore.screenshots.alt', {
                                    number: index + 1,
                                })}
                                onClick={() => handler.handleSelect(index)}
                                className={`block aspect-video w-36 cursor-pointer overflow-hidden rounded-md border-[3px] transition-transform hover:-translate-y-px ${index === state.activeIndex ? 'border-ink shadow-[3px_3px_0_0_var(--app-comic-pop,var(--color-ink))]' : 'border-border-dark opacity-70 hover:opacity-100'}`}
                            >
                                <img
                                    src={screenshot.src}
                                    alt=""
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                />
                            </button>
                        </li>
                    ))}
                </ol>
            )}

            {state.isLightboxOpen &&
                createPortal(
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={alt}
                        className="fixed inset-0 z-100 flex items-center justify-center bg-ink/90 p-4 backdrop-blur-sm"
                        onClick={handler.handleCloseLightbox}
                    >
                        <img
                            src={active.src}
                            alt={alt}
                            onClick={(event) => event.stopPropagation()}
                            className="max-h-full max-w-full rounded-md border-4 border-ink object-contain shadow-[6px_6px_0_0_var(--color-ink)]"
                        />
                        <button
                            type="button"
                            aria-label={t('appStore.detail.closeLightbox')}
                            onClick={handler.handleCloseLightbox}
                            className={`${navButton} absolute right-4 top-4`}
                        >
                            <X aria-hidden="true" className="h-6 w-6" />
                        </button>
                        {hasMany && (
                            <>
                                <button
                                    type="button"
                                    aria-label={previousLabel}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        handler.handlePrevious()
                                    }}
                                    className={`${navButton} absolute left-4 top-1/2 -translate-y-1/2`}
                                >
                                    <ChevronLeft
                                        aria-hidden="true"
                                        className="h-6 w-6"
                                    />
                                </button>
                                <button
                                    type="button"
                                    aria-label={nextLabel}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        handler.handleNext()
                                    }}
                                    className={`${navButton} absolute right-4 top-1/2 -translate-y-1/2`}
                                >
                                    <ChevronRight
                                        aria-hidden="true"
                                        className="h-6 w-6"
                                    />
                                </button>
                            </>
                        )}
                    </div>,
                    document.body,
                )}
        </section>
    )
}
