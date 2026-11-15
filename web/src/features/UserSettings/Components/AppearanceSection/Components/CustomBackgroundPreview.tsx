import { Bell, LogOut, UserRound } from 'lucide-react'
import Cropper from 'react-easy-crop'
import type { CustomBackgroundPreviewProps } from '../Types/custom-background-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function CustomBackgroundPreview({
    containerRef,
    handler,
    state,
}: CustomBackgroundPreviewProps) {
    const { t } = useTranslationStore()

    return (
        <div
            className="mt-4 overflow-hidden rounded-lg border border-border-dark bg-background-dark"
            role="group"
            aria-label={t('userSettings.background.preview')}
        >
            <div
                className="relative flex"
                style={{ aspectRatio: state.previewLayout.aspectRatio }}
            >
                <div
                    className="pointer-events-none relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-r border-border-dark bg-surface-dark"
                    style={{
                        width: state.previewLayout.sidebarWidth,
                    }}
                    aria-hidden="true"
                >
                    <div
                        className={`flex min-h-10 shrink-0 items-center gap-2 border-b border-border-dark ${state.previewLayout.isSidebarCollapsed ? 'px-1' : 'px-2'}`}
                        style={{ height: state.previewLayout.topbarHeight }}
                    >
                        <div className="h-5 w-5 shrink-0 rounded-md bg-primary" />
                        {!state.previewLayout.isSidebarCollapsed && (
                            <div className="min-w-0">
                                <div className="h-2 w-16 rounded-full bg-white/80" />
                                <div className="mt-1 h-1.5 w-10 rounded-full bg-secondary-text/60" />
                            </div>
                        )}
                    </div>

                    <div
                        className={`space-y-1 pt-3 ${state.previewLayout.isSidebarCollapsed ? 'px-1' : 'px-2'}`}
                    >
                        <div className="h-6 rounded-md bg-input-dark shadow-[inset_2px_0_0_var(--color-primary)]" />
                        <div className="h-6 rounded-md bg-input-dark/80" />
                        <div className="h-6 rounded-md bg-input-dark/80" />
                        <div className="h-6 rounded-md bg-input-dark/80" />
                    </div>

                    <div
                        className={`mt-auto space-y-1 border-t border-border-dark py-2 ${state.previewLayout.isSidebarCollapsed ? 'px-1' : 'px-2'}`}
                    >
                        <div className="flex h-7 items-center gap-1.5 rounded-md bg-input-dark px-1.5 text-secondary-text">
                            <UserRound className="h-3.5 w-3.5 shrink-0" />
                            {!state.previewLayout.isSidebarCollapsed && (
                                <div className="h-1.5 w-12 rounded-full bg-secondary-text/70" />
                            )}
                        </div>
                        <div className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-secondary-text">
                            <LogOut className="h-3.5 w-3.5 shrink-0" />
                            {!state.previewLayout.isSidebarCollapsed && (
                                <div className="h-1.5 w-10 rounded-full bg-secondary-text/70" />
                            )}
                        </div>
                    </div>
                </div>

                <div
                    ref={containerRef}
                    className="relative h-full min-w-0 flex-1 overflow-hidden bg-background-dark"
                >
                    {state.backgroundImageSrc &&
                    state.cropSize.width > 0 &&
                    state.cropSize.height > 0 ? (
                        <div className="absolute inset-0">
                            <Cropper
                                image={state.backgroundImageSrc}
                                crop={state.backgroundCrop}
                                zoom={state.backgroundZoom}
                                cropSize={{
                                    width: state.cropSize.width,
                                    height: state.cropSize.height,
                                }}
                                cropShape="rect"
                                objectFit="cover"
                                showGrid={false}
                                style={{
                                    containerStyle: {
                                        inset: 0,
                                        height: '100%',
                                        position: 'absolute',
                                        width: '100%',
                                    },
                                    cropAreaStyle: {
                                        border: 'none',
                                        color: 'transparent',
                                    },
                                }}
                                onCropChange={
                                    handler.handleBackgroundCropChange
                                }
                                onZoomChange={
                                    handler.handleBackgroundZoomChange
                                }
                                onCropComplete={
                                    handler.handleBackgroundCropComplete
                                }
                            />
                        </div>
                    ) : state.previewBackgroundSrc ? (
                        <div
                            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                            style={{
                                backgroundImage: `url("${state.previewBackgroundSrc}")`,
                            }}
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-input-dark">
                            <span className="rounded-md border border-border-dark bg-background-dark/80 px-3 py-2 text-xs font-semibold text-secondary-text">
                                {t('userSettings.background.empty')}
                            </span>
                        </div>
                    )}

                    <div
                        className="pointer-events-none absolute inset-0 bg-background-dark"
                        style={{
                            opacity: state.customBackgroundDarknessValue / 100,
                        }}
                    />

                    <div
                        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex min-h-10 items-center justify-between gap-2 border-b border-border-dark bg-surface-dark px-2"
                        style={{ height: state.previewLayout.topbarHeight }}
                        aria-hidden="true"
                    >
                        <div className="min-w-0">
                            <div className="h-1.5 w-20 max-w-full rounded-full bg-white/80" />
                            <div className="mt-1 h-1 w-12 max-w-full rounded-full bg-secondary-text/60" />
                        </div>
                        <div className="relative flex h-3/5 aspect-square shrink-0 items-center justify-center rounded border border-border-dark bg-input-dark text-secondary-text">
                            <Bell className="h-3/4 w-3/4" />
                            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full border border-surface-dark bg-primary" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
