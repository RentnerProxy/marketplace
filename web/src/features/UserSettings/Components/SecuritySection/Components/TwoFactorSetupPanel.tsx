import { CustomTooltip } from '@rentnerkev/tooltips'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, LoaderCircle } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { TwoFactorSetupPanelProps } from '../Types/two-factor-component-props.types.ts'

export default function TwoFactorSetupPanel({
    state,
    handler,
}: TwoFactorSetupPanelProps) {
    const { t } = useTranslationStore()
    const isOpen = Boolean(state.twoFactorOtpAuthUrl)

    return (
        <div
            aria-hidden={!isOpen}
            inert={!isOpen}
            data-open={isOpen}
            className="grid grid-rows-[0fr] opacity-0 data-[open=true]:grid-rows-[1fr] data-[open=true]:opacity-100 motion-safe:translate-y-2.5 motion-safe:transition-[grid-template-rows,opacity,translate] motion-safe:duration-200 motion-safe:data-[open=true]:translate-y-0"
        >
            <div className="min-h-0 overflow-hidden">
                <div className="grid gap-4 pt-4 lg:grid-cols-[180px_1fr]">
                    <div className="flex min-h-[182px] items-center justify-center rounded-lg border border-border-dark bg-white p-4">
                        {state.twoFactorOtpAuthUrl && (
                            <QRCodeSVG
                                value={state.twoFactorOtpAuthUrl}
                                size={148}
                                aria-hidden="true"
                                className="motion-safe:transition-[scale,opacity] motion-safe:duration-200 motion-safe:starting:scale-[0.94] motion-safe:starting:opacity-0"
                            />
                        )}
                    </div>

                    <div className="space-y-3">
                        <p className="text-sm text-secondary-text">
                            {t('userSettings.security.2faScan')}
                        </p>

                        {isOpen && state.twoFactorSecret && (
                            <CustomTooltip
                                content={
                                    state.copySecret
                                        ? t('common.copied')
                                        : t('common.clickToCopy')
                                }
                                side="top"
                            >
                                <button
                                    type="button"
                                    onClick={handler.handleCopySecret}
                                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border-dark bg-background-dark px-3 py-2 text-left text-xs break-all text-secondary-text transition-[color,border-color,scale] hover:border-primary/50 hover:text-white focus-visible:border-primary/50 focus-visible:text-white motion-safe:active:scale-[0.99]"
                                >
                                    <span>
                                        {t('userSettings.security.secret', {
                                            secret: state.twoFactorSecret,
                                        })}
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        data-copied={state.copySecret}
                                        className="group grid shrink-0"
                                    >
                                        <Copy className="col-start-1 row-start-1 size-3.5 group-data-[copied=true]:opacity-0 motion-safe:transition-all motion-safe:duration-200 motion-safe:group-data-[copied=true]:scale-60" />
                                        <Check className="col-start-1 row-start-1 size-3.5 text-emerald-500 opacity-0 group-data-[copied=true]:opacity-100 motion-safe:scale-60 motion-safe:transition-all motion-safe:duration-200 motion-safe:group-data-[copied=true]:scale-100" />
                                    </span>
                                </button>
                            </CustomTooltip>
                        )}

                        <div className="flex min-h-25 flex-col gap-3 sm:min-h-11 sm:flex-row">
                            {isOpen && (
                                <>
                                    <input
                                        value={state.twoFactorToken}
                                        onChange={(event) =>
                                            handler.handleTwoFactorTokenChange(
                                                event.target.value,
                                            )
                                        }
                                        aria-label={t(
                                            'auth.twoFactor.codeLabel',
                                        )}
                                        autoComplete="one-time-code"
                                        inputMode="numeric"
                                        maxLength={6}
                                        placeholder="123456"
                                        className="h-11 flex-1 rounded-md border border-border-dark bg-background-dark px-3 text-sm text-white outline-none transition-colors focus:border-primary/50"
                                    />
                                    <button
                                        type="button"
                                        disabled={
                                            state.isConfirmingTwoFactorSetup ||
                                            state.twoFactorToken.length !== 6
                                        }
                                        onClick={
                                            handler.handleConfirmTwoFactorSetup
                                        }
                                        className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-[background-color,scale] hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:enabled:active:scale-[0.97]"
                                    >
                                        {state.isConfirmingTwoFactorSetup && (
                                            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" />
                                        )}
                                        {state.isConfirmingTwoFactorSetup
                                            ? t(
                                                  'userSettings.security.checking',
                                              )
                                            : t(
                                                  'userSettings.security.2faConfirm',
                                              )}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
