import { AnimatePresence, motion } from 'motion/react'
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
    const isReauthenticationDisabled =
        state.isTwoFactorBusy || state.isLoadingTwoFactorStatus
    const isActionDisabled =
        isReauthenticationDisabled || !state.isTwoFactorReauthenticationReady

    return (
        <motion.section
            layout
            className="relative overflow-hidden rounded-lg border border-border-dark bg-input-dark/50 p-4"
        >
            {state.isReauthenticationRequired && (
                <div className="relative mb-4">
                    <SecurityChangeLoginNotice />
                </div>
            )}
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <motion.span
                            animate={{
                                rotate: state.isTwoFactorEnabled ? 0 : -6,
                                scale: state.isTwoFactorEnabled ? 1.05 : 1,
                            }}
                            transition={{
                                type: 'spring',
                                stiffness: 360,
                                damping: 20,
                            }}
                        >
                            <ShieldCheck
                                className={[
                                    'h-4 w-4 transition-colors',
                                    state.isTwoFactorEnabled
                                        ? 'text-emerald-400'
                                        : 'text-primary',
                                ].join(' ')}
                            />
                        </motion.span>

                        <h3 className="text-sm font-semibold text-white">
                            {t('userSettings.security.2faTitle')}
                        </h3>
                    </div>

                    <p className="mt-1 text-sm text-secondary-text">
                        {t('userSettings.security.2faDescription')}
                    </p>
                </div>

                <AnimatePresence initial={false} mode="wait">
                    {state.isTwoFactorEnabled ? (
                        <motion.div
                            key="disable-2fa"
                            className="w-full space-y-3 sm:max-w-sm"
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{
                                type: 'spring',
                                stiffness: 420,
                                damping: 30,
                            }}
                        >
                            <ReauthenticationInput
                                id="disable-two-factor-reauthentication"
                                isTotp
                                value={state.twoFactorReauthenticationValue}
                                disabled={isReauthenticationDisabled}
                                onChange={
                                    handler.handleTwoFactorReauthenticationValueChange
                                }
                            />
                            <motion.button
                                type="button"
                                disabled={isActionDisabled}
                                onClick={handler.handleDisableTwoFactor}
                                whileTap={
                                    isActionDisabled
                                        ? undefined
                                        : { scale: 0.97 }
                                }
                                className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-background-dark px-4 text-sm font-semibold text-danger transition-colors hover:border-danger hover:text-white disabled:opacity-60"
                            >
                                {state.isDisablingTwoFactor ? (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                ) : (
                                    <ShieldOff className="h-4 w-4" />
                                )}

                                {state.isDisablingTwoFactor
                                    ? t('userSettings.security.2faDisabling')
                                    : t('userSettings.security.2faDisable')}
                            </motion.button>
                        </motion.div>
                    ) : !state.twoFactorOtpAuthUrl ? (
                        <motion.div
                            key="enable-2fa"
                            className="w-full space-y-3 sm:max-w-sm"
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{
                                type: 'spring',
                                stiffness: 420,
                                damping: 30,
                            }}
                        >
                            <ReauthenticationInput
                                id="enable-two-factor-reauthentication"
                                isTotp={false}
                                value={state.twoFactorReauthenticationValue}
                                disabled={isReauthenticationDisabled}
                                onChange={
                                    handler.handleTwoFactorReauthenticationValueChange
                                }
                            />
                            <motion.button
                                type="button"
                                disabled={isActionDisabled}
                                onClick={handler.handleStartTwoFactorSetup}
                                whileTap={
                                    isActionDisabled
                                        ? undefined
                                        : { scale: 0.97 }
                                }
                                className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {state.isStartingTwoFactorSetup ? (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                ) : (
                                    <LockKeyhole className="h-4 w-4" />
                                )}

                                {state.isStartingTwoFactorSetup
                                    ? t('userSettings.security.2faPreparing')
                                    : t('userSettings.security.2faEnable')}
                            </motion.button>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>

            <AnimatePresence>
                {state.isTwoFactorEnabled && (
                    <motion.div
                        className="relative mt-4 flex items-center gap-2 rounded-md border border-border-dark bg-surface-dark px-3 py-2 text-sm text-white"
                        initial={{ opacity: 0, height: 0, y: -6 }}
                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -6 }}
                        transition={{
                            type: 'spring',
                            stiffness: 360,
                            damping: 30,
                        }}
                    >
                        <Check className="h-4 w-4 shrink-0 text-success" />
                        {t('userSettings.security.2faActive')}
                    </motion.div>
                )}
            </AnimatePresence>

            <TwoFactorSetupPanel state={state} handler={handler} />
        </motion.section>
    )
}
