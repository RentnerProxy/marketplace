import {
    Check,
    LoaderCircle,
    LockKeyhole,
    ShieldCheck,
    ShieldOff,
} from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useTwoFactorLogic from '@/features/UserSettings/Components/SecuritySection/Hooks/useTwoFactorLogic.ts'
import TwoFactorSetupPanel from './TwoFactorSetupPanel.tsx'
import ReauthenticationInput from './ReauthenticationInput.tsx'
import SecurityChangeLoginNotice from './SecurityChangeLoginNotice.tsx'

export default function TwoFactorSection() {
    const { t } = useTranslationStore()
    const { state, handler } = useTwoFactorLogic()
    const isEnabled = state.isTwoFactorEnabled
    const isReauthenticationDisabled =
        state.isTwoFactorBusy || state.isLoadingTwoFactorStatus
    const isActionDisabled =
        isReauthenticationDisabled || !state.isTwoFactorReauthenticationReady
    const isActionPending = isEnabled
        ? state.isDisablingTwoFactor
        : state.isStartingTwoFactorSetup
    const actionLabel = isEnabled
        ? isActionPending
            ? 'userSettings.security.2faDisabling'
            : 'userSettings.security.2faDisable'
        : isActionPending
          ? 'userSettings.security.2faPreparing'
          : 'userSettings.security.2faEnable'
    const ActionIcon = isEnabled ? ShieldOff : LockKeyhole

    return (
        <section className="relative overflow-hidden rounded-lg border border-border-dark bg-input-dark/50 p-4">
            {state.isReauthenticationRequired && (
                <div className="relative mb-4">
                    <SecurityChangeLoginNotice />
                </div>
            )}
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <ShieldCheck
                            data-enabled={isEnabled}
                            className="h-4 w-4 text-primary data-[enabled=true]:text-emerald-400 motion-safe:transition-[color,rotate,scale] motion-safe:duration-200 motion-safe:data-[enabled=false]:rotate-[-6deg] motion-safe:data-[enabled=true]:scale-[1.05]"
                        />

                        <h3 className="text-sm font-semibold text-white">
                            {t('userSettings.security.2faTitle')}
                        </h3>
                    </div>

                    <p className="mt-1 text-sm text-secondary-text">
                        {t('userSettings.security.2faDescription')}
                    </p>
                </div>

                {(isEnabled || !state.twoFactorOtpAuthUrl) && (
                    <div
                        key={isEnabled ? 'disable-2fa' : 'enable-2fa'}
                        className="w-full space-y-3 sm:max-w-sm motion-safe:transition-[opacity,translate] motion-safe:duration-200 motion-safe:starting:-translate-y-1.5 motion-safe:starting:opacity-0"
                    >
                        <ReauthenticationInput
                            id={
                                isEnabled
                                    ? 'disable-two-factor-reauthentication'
                                    : 'enable-two-factor-reauthentication'
                            }
                            isTotp={isEnabled}
                            value={state.twoFactorReauthenticationValue}
                            disabled={isReauthenticationDisabled}
                            onChange={
                                handler.handleTwoFactorReauthenticationValueChange
                            }
                        />
                        <button
                            type="button"
                            disabled={isActionDisabled}
                            onClick={
                                isEnabled
                                    ? handler.handleDisableTwoFactor
                                    : handler.handleStartTwoFactorSetup
                            }
                            className={[
                                'flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-[color,background-color,border-color,scale] disabled:cursor-not-allowed disabled:opacity-60 motion-safe:enabled:active:scale-[0.97]',
                                isEnabled
                                    ? 'border border-border-dark bg-background-dark text-danger hover:border-danger hover:text-white'
                                    : 'bg-primary text-white hover:bg-primary-hover',
                            ].join(' ')}
                        >
                            {isActionPending ? (
                                <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" />
                            ) : (
                                <ActionIcon className="h-4 w-4" />
                            )}

                            {t(actionLabel)}
                        </button>
                    </div>
                )}
            </div>

            <div
                aria-hidden={!isEnabled}
                inert={!isEnabled}
                data-open={isEnabled}
                className="grid grid-rows-[0fr] opacity-0 data-[open=true]:grid-rows-[1fr] data-[open=true]:opacity-100 motion-safe:-translate-y-1.5 motion-safe:transition-[grid-template-rows,opacity,translate] motion-safe:duration-200 motion-safe:data-[open=true]:translate-y-0"
            >
                <div className="min-h-0 overflow-hidden">
                    <div className="mt-4 flex items-center gap-2 rounded-md border border-border-dark bg-surface-dark px-3 py-2 text-sm text-white">
                        <Check className="h-4 w-4 shrink-0 text-success" />
                        {t('userSettings.security.2faActive')}
                    </div>
                </div>
            </div>

            <TwoFactorSetupPanel state={state} handler={handler} />
        </section>
    )
}
