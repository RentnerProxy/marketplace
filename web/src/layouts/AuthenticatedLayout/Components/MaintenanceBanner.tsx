import { Clock, Minus, Send } from 'lucide-react'
import { CustomTooltip } from '@rentnerkev/tooltips'
import type { MaintenanceBannerProps } from '../Types/authenticated-layout-component-props.types.ts'
import { formatRemainingTime } from '@/lib/Date/date.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useMaintenanceBannerLogic from '../Hooks/useMaintenanceBannerLogic.ts'
import { Textarea } from '@rentnerkev/inputs'

export default function MaintenanceBanner({
    millisecondsUntilMaintenance,
    pendingUsername,
    isOwnRequestPending,
    onMinimize,
}: MaintenanceBannerProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useMaintenanceBannerLogic()

    return (
        <section className="comic-notice relative w-full bg-surface-dark p-3 pr-14 text-white [--notice-tone:var(--color-warning)]">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] lg:items-start">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <Clock className="h-4 w-4 text-warning" />
                        {t('maintenance.startsIn', {
                            time: formatRemainingTime(
                                millisecondsUntilMaintenance,
                            ),
                        })}
                    </div>

                    <p className="mt-1 text-xs leading-5 text-secondary-text">
                        {t('maintenance.bannerDescription')}
                    </p>

                    {pendingUsername && (
                        <p className="mt-2 rounded-md border border-border-dark bg-background-dark px-2.5 py-1.5 text-xs font-medium text-secondary-text">
                            {isOwnRequestPending
                                ? t('maintenance.pendingOwnRequest')
                                : t('maintenance.pendingRequest', {
                                      username: pendingUsername,
                                  })}
                        </p>
                    )}
                </div>

                {!pendingUsername && (
                    <form
                        className="grid w-full gap-2"
                        onSubmit={(event) => {
                            event.preventDefault()
                            handler.handleRequestMaintenanceExtension()
                        }}
                    >
                        <Textarea
                            value={state.reason}
                            onChange={(event) =>
                                handler.handleReasonChange(event.target.value)
                            }
                            required
                            minLength={10}
                            maxLength={500}
                            placeholder={t('maintenance.extensionPlaceholder')}
                            showLength
                        />

                        <button
                            type="submit"
                            disabled={state.isRequestingMaintenanceExtension}
                            className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Send className="h-4 w-4" />
                            {state.isRequestingMaintenanceExtension
                                ? t('maintenance.requestSent')
                                : t('maintenance.requestExtension')}
                        </button>
                    </form>
                )}
            </div>

            <div className="absolute right-3 top-3">
                <CustomTooltip
                    side="bottom"
                    content={t('maintenance.minimizeBanner')}
                >
                    <button
                        type="button"
                        aria-label={t('maintenance.minimizeBanner')}
                        onClick={onMinimize}
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:text-white"
                    >
                        <Minus className="h-4 w-4" />
                    </button>
                </CustomTooltip>
            </div>
        </section>
    )
}
