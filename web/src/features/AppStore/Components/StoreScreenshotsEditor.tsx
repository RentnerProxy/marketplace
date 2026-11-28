import { CustomTooltip } from '@rentnerkev/tooltips'
import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react'
import { APP_STORE_CONFIG } from '@/config/app-store.config.ts'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import ImageCropDialog from '@/shared/Images/Components/ImageCropDialog.tsx'
import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import useStoreScreenshotsLogic from '../Hooks/useStoreScreenshotsLogic.ts'
import type { StoreScreenshotsEditorProps } from '../Types/app-store-component.types.ts'

const iconButton =
    'grid h-9 w-9 cursor-pointer place-items-center rounded-md border-2 border-ink bg-mist-50 text-ink shadow-[2px_2px_0_0_var(--color-ink)] transition-transform hover:-translate-x-px hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40'

export default function StoreScreenshotsEditor({
    appId,
    screenshots,
}: StoreScreenshotsEditorProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useStoreScreenshotsLogic(appId, screenshots)
    const lastIndex = screenshots.length - 1

    return (
        <section
            aria-labelledby="store-screenshots-title"
            className="rounded-lg border border-border-dark bg-surface-dark p-5 sm:p-6"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                    id="store-screenshots-title"
                    className="comic-title text-3xl"
                >
                    {t('appStore.screenshots.title')}
                </h2>
                <span className="comic-chip tabular-nums">
                    {screenshots.length}/{APP_STORE_CONFIG.maxScreenshots}
                </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-secondary-text">
                {t('appStore.screenshots.hint')}
            </p>

            <ol className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {screenshots.map((screenshot, index) => (
                    <li
                        key={screenshot.id}
                        className="comic-card overflow-hidden bg-background-dark"
                    >
                        <div className="relative aspect-video">
                            <img
                                src={screenshot.src}
                                alt={t('appStore.screenshots.alt', {
                                    number: index + 1,
                                })}
                                loading="lazy"
                                className="h-full w-full object-cover"
                            />
                            <span className="comic-chip absolute left-2 top-2 tabular-nums">
                                {index + 1}
                            </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t-2 border-ink p-2">
                            <div className="flex gap-2">
                                <CustomTooltip
                                    side="top"
                                    content={t('appStore.screenshots.moveLeft')}
                                >
                                    <button
                                        type="button"
                                        aria-label={t(
                                            'appStore.screenshots.moveLeft',
                                        )}
                                        disabled={
                                            index === 0 || state.isReordering
                                        }
                                        onClick={() =>
                                            handler.handleMove(index, -1)
                                        }
                                        className={iconButton}
                                    >
                                        <ArrowLeft
                                            aria-hidden="true"
                                            className="h-4 w-4"
                                        />
                                    </button>
                                </CustomTooltip>
                                <CustomTooltip
                                    side="top"
                                    content={t(
                                        'appStore.screenshots.moveRight',
                                    )}
                                >
                                    <button
                                        type="button"
                                        aria-label={t(
                                            'appStore.screenshots.moveRight',
                                        )}
                                        disabled={
                                            index === lastIndex ||
                                            state.isReordering
                                        }
                                        onClick={() =>
                                            handler.handleMove(index, 1)
                                        }
                                        className={iconButton}
                                    >
                                        <ArrowRight
                                            aria-hidden="true"
                                            className="h-4 w-4"
                                        />
                                    </button>
                                </CustomTooltip>
                            </div>
                            <CustomTooltip
                                side="top"
                                content={t('appStore.screenshots.remove')}
                            >
                                <button
                                    type="button"
                                    aria-label={t(
                                        'appStore.screenshots.remove',
                                    )}
                                    onClick={() =>
                                        handler.handleOpenRemove(screenshot.id)
                                    }
                                    className={iconButton}
                                >
                                    <Trash2
                                        aria-hidden="true"
                                        className="h-4 w-4"
                                    />
                                </button>
                            </CustomTooltip>
                        </div>
                    </li>
                ))}

                {state.canAdd && (
                    <li>
                        <label className="comic-hatch flex aspect-video h-full cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-[3px] border-dashed border-border-dark text-secondary-text transition-colors focus-within:border-primary hover:border-primary hover:text-foreground [--hatch-color:color-mix(in_oklab,var(--color-primary)_12%,transparent)]">
                            <ImagePlus aria-hidden="true" className="h-8 w-8" />
                            <span className="comic-lettering text-sm">
                                {t('appStore.screenshots.add')}
                            </span>
                            <input
                                type="file"
                                accept={IMAGE_UPLOAD_CONFIG.allowedMimeTypes.join(
                                    ',',
                                )}
                                className="sr-only"
                                onChange={(event) => {
                                    handler.handleSelectImage(
                                        event.target.files?.[0] ?? null,
                                    )
                                    event.target.value = ''
                                }}
                            />
                        </label>
                    </li>
                )}
            </ol>

            {state.imageSrc && (
                <ImageCropDialog
                    titleId="store-screenshot-crop-title"
                    title={t('appStore.screenshots.cropTitle')}
                    hint={t('appStore.cropHint')}
                    imageSrc={state.imageSrc}
                    crop={state.crop}
                    zoom={state.zoom}
                    aspect={APP_STORE_CONFIG.screenshotAspectRatio}
                    isSaving={state.isSavingScreenshot}
                    saveLabel={t('appStore.screenshots.save')}
                    onCropChange={handler.handleCropChange}
                    onZoomChange={handler.handleZoomChange}
                    onCropComplete={handler.handleCropComplete}
                    onCancel={handler.handleCancelScreenshot}
                    onSave={handler.handleSaveScreenshot}
                />
            )}

            <SafeDeleteModal
                isOpen={state.removeId !== null}
                title={t('appStore.screenshots.removeTitle')}
                question={t('appStore.screenshots.removeQuestion')}
                confirmLabel={t('appStore.screenshots.remove')}
                isConfirming={state.isRemovingScreenshot}
                onClose={handler.handleCloseRemove}
                onConfirm={handler.handleConfirmRemove}
            />
        </section>
    )
}
