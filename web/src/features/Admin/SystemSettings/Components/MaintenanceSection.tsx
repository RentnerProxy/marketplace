import { CALENDAR_LOCALES } from '@/config/language-library.config.ts'
import { Check, Clock, Wrench, X } from 'lucide-react'
import { SingleCalendar } from '@rentnerkev/calendar'
import { NumericInput } from '@rentnerkev/inputs'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { MaintenanceSectionProps } from '../Types/system-settings-component-props.types.ts'
import { formatMaintenanceDate } from '@/lib/Date/date.ts'
import StatusIndicator from '@/shared/StatusIndicator.tsx'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function MaintenanceSection({
    state,
    handler,
}: MaintenanceSectionProps) {
    const { t, language } = useTranslationStore()
    const request = state.pendingMaintenanceExtensionRequest

    return (
        <section
            aria-labelledby="system-maintenance-title"
            className="marketplace-content-panel min-w-0 flex-1 rounded-2xl border border-border-dark bg-surface-dark p-5 sm:p-6"
        >
            <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                    <HeadingIcon icon={Wrench} tone="warning" size="sm" />

                    <div>
                        <h2
                            id="system-maintenance-title"
                            className="text-base leading-tight font-semibold tracking-tight text-foreground"
                        >
                            {t('admin.systemSettings.maintenance')}
                        </h2>
                        <p className="mt-1 text-sm leading-5 text-secondary-text">
                            {t('admin.systemSettings.maintenanceDescription')}
                        </p>
                    </div>
                </div>

                <div className="rounded-xl border border-border-dark bg-input-dark/35 p-4">
                    <StatusIndicator
                        tone={
                            state.isMaintenanceModeEnabled
                                ? 'warning'
                                : 'neutral'
                        }
                    >
                        {state.isMaintenanceModeEnabled
                            ? state.isMaintenanceModeActive
                                ? t('common.active')
                                : t('common.planned')
                            : t('common.inactive')}
                    </StatusIndicator>

                    <div className="mt-4">
                        <span className="text-xs font-semibold text-secondary-text">
                            {t('admin.systemSettings.startAt')}
                        </span>

                        <div className="mt-2">
                            {state.isMaintenanceModeEnabled ? (
                                <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border-dark bg-background-dark px-3 text-sm font-semibold text-foreground">
                                    <Clock className="h-4 w-4 text-secondary-text" />
                                    <span>
                                        {formatMaintenanceDate(
                                            state.maintenanceStartsAt,
                                        )}
                                    </span>
                                </div>
                            ) : (
                                <SingleCalendar
                                    valueFormat="iso-datetime"
                                    enableTime
                                    button
                                    backdrop
                                    locale={CALENDAR_LOCALES[language]}
                                    icon={<Clock className="h-4 w-4" />}
                                    showHolidays
                                    minDateTime={state.maintenanceMinDateTime}
                                    placeholder={t(
                                        'admin.systemSettings.startAtPlaceholder',
                                    )}
                                    value={state.maintenanceStartsAt}
                                    onChange={
                                        handler.handleMaintenanceStartsAtChange
                                    }
                                />
                            )}
                        </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            disabled={
                                state.isSavingMaintenanceMode ||
                                state.isMaintenanceModeEnabled
                            }
                            onClick={handler.handleEnableMaintenanceMode}
                            className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Wrench className="h-4 w-4" />
                            {t('admin.systemSettings.plan')}
                        </button>

                        <button
                            type="button"
                            disabled={
                                state.isSavingMaintenanceMode ||
                                !state.isMaintenanceModeEnabled
                            }
                            onClick={handler.handleDisableMaintenanceMode}
                            className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-background-dark px-4 text-sm font-semibold text-white transition-colors hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <X className="h-4 w-4" />
                            {t('common.deactivate')}
                        </button>
                    </div>
                </div>

                {request && (
                    <div className="rounded-xl border border-warning/35 bg-warning/5 p-4">
                        <h3 className="text-sm font-semibold text-foreground">
                            {t('admin.systemSettings.extensionRequest')}
                        </h3>

                        <p className="mt-1 text-sm text-secondary-text">
                            {t(
                                'admin.systemSettings.extensionRequestDescription',
                                {
                                    username: request.user.username,
                                },
                            )}
                        </p>

                        <p className="mt-3 rounded-lg border border-border-dark bg-input-dark/60 px-3 py-2 text-sm wrap-anywhere text-foreground">
                            {request.reason}
                        </p>

                        <div className="mt-4">
                            <NumericInput
                                label={t(
                                    'admin.systemSettings.extensionMinutes',
                                )}
                                placeholder="..."
                                min={1}
                                max={120}
                                step={1}
                                value={state.maintenanceExtensionMinutes}
                                error={state.maintenanceExtensionMinutesError}
                                onValueChange={
                                    handler.handleMaintenanceExtensionMinutesChange
                                }
                            />
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <button
                                type="button"
                                disabled={
                                    state.isResolvingMaintenanceExtensionRequest ||
                                    Boolean(
                                        state.maintenanceExtensionMinutesError,
                                    )
                                }
                                onClick={
                                    handler.handleApproveMaintenanceExtensionRequest
                                }
                                className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Check className="h-4 w-4" />
                                {t('common.approve')}
                            </button>

                            <button
                                type="button"
                                disabled={
                                    state.isResolvingMaintenanceExtensionRequest
                                }
                                onClick={
                                    handler.handleRejectMaintenanceExtensionRequest
                                }
                                className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-background-dark px-4 text-sm font-semibold text-danger transition-colors hover:border-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <X className="h-4 w-4" />
                                {t('common.reject')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </section>
    )
}
