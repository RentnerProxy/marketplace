import { motion } from 'motion/react'
import { KeyRound, LoaderCircle, MailCheck } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import usePasswordResetLogic from '@/features/UserSettings/Components/SecuritySection/Hooks/usePasswordResetLogic.ts'

export default function PasswordResetSection() {
    const { t } = useTranslationStore()
    const { state, handler } = usePasswordResetLogic()

    return (
        <motion.section
            layout
            className="relative overflow-hidden rounded-lg border border-border-dark bg-input-dark/50 p-4"
        >
            <div className="relative">
                <div className="flex items-center gap-2">
                    <motion.span
                        animate={{
                            rotate: state.isRequestingPasswordReset ? -8 : 0,
                            scale: state.isRequestingPasswordReset ? 1.08 : 1,
                        }}
                        transition={{
                            type: 'spring',
                            stiffness: 360,
                            damping: 22,
                        }}
                    >
                        <KeyRound className="h-4 w-4 text-primary" />
                    </motion.span>

                    <h3 className="text-sm font-semibold text-white">
                        {t('userSettings.security.passwordTitle')}
                    </h3>
                </div>

                <p className="mt-1 text-sm text-secondary-text">
                    {t('userSettings.security.passwordDescription')}
                </p>

                <motion.button
                    type="button"
                    disabled={state.isRequestingPasswordReset}
                    onClick={handler.handleRequestPasswordReset}
                    whileTap={
                        state.isRequestingPasswordReset
                            ? undefined
                            : {
                                  scale: 0.97,
                              }
                    }
                    className="mt-3 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <motion.span
                        animate={
                            state.isRequestingPasswordReset
                                ? {
                                      rotate: 360,
                                  }
                                : {
                                      rotate: 0,
                                  }
                        }
                        transition={
                            state.isRequestingPasswordReset
                                ? {
                                      duration: 1,
                                      repeat: Infinity,
                                      ease: 'linear',
                                  }
                                : {
                                      type: 'spring',
                                      stiffness: 360,
                                      damping: 22,
                                  }
                        }
                    >
                        {state.isRequestingPasswordReset ? (
                            <LoaderCircle className="h-4 w-4" />
                        ) : (
                            <MailCheck className="h-4 w-4" />
                        )}
                    </motion.span>

                    {state.isRequestingPasswordReset
                        ? t('userSettings.security.passwordSending')
                        : t('userSettings.security.passwordReset')}
                </motion.button>
            </div>
        </motion.section>
    )
}
