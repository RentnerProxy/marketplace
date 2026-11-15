import { CustomTooltip } from '@rentnerkev/tooltips'
import { QRCodeSVG } from 'qrcode.react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, LoaderCircle } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { TwoFactorSetupPanelProps } from '../Types/two-factor-component-props.types.ts'

export default function TwoFactorSetupPanel({
    state,
    handler,
}: TwoFactorSetupPanelProps) {
    const { t } = useTranslationStore()

    return (
        <AnimatePresence>
            {state.twoFactorOtpAuthUrl && (
                <motion.div
                    layout
                    className="relative mt-4 grid gap-4 lg:grid-cols-[180px_1fr]"
                    initial={{ opacity: 0, y: 10, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: 10, height: 0 }}
                    transition={{
                        type: 'spring',
                        stiffness: 320,
                        damping: 32,
                    }}
                >
                    <motion.div
                        className="flex items-center justify-center rounded-lg border border-border-dark bg-white p-4"
                        initial={{ scale: 0.94, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{
                            type: 'spring',
                            stiffness: 360,
                            damping: 24,
                            delay: 0.05,
                        }}
                    >
                        <QRCodeSVG
                            value={state.twoFactorOtpAuthUrl}
                            size={148}
                        />
                    </motion.div>

                    <div className="space-y-3">
                        <p className="text-sm text-secondary-text">
                            {t('userSettings.security.2faScan')}
                        </p>

                        <AnimatePresence>
                            {state.twoFactorSecret && (
                                <CustomTooltip
                                    content={
                                        state.copySecret
                                            ? t('common.copied')
                                            : t('common.clickToCopy')
                                    }
                                    side="top"
                                >
                                    <motion.div
                                        onClick={handler.handleCopySecret}
                                        whileTap={{ scale: 0.99 }}
                                        className="flex cursor-pointer items-center justify-between gap-2 break-all rounded-md border border-border-dark bg-background-dark px-3 py-2 text-xs text-secondary-text transition-colors hover:border-primary/50 hover:text-white"
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 6 }}
                                    >
                                        <span>
                                            {t('userSettings.security.secret', {
                                                secret: state.twoFactorSecret,
                                            })}
                                        </span>
                                        <AnimatePresence mode="wait">
                                            <motion.span
                                                key={
                                                    state.copySecret
                                                        ? 'copied'
                                                        : 'copy'
                                                }
                                                initial={{
                                                    opacity: 0,
                                                    scale: 0.6,
                                                }}
                                                animate={{
                                                    opacity: 1,
                                                    scale: 1,
                                                }}
                                                exit={{
                                                    opacity: 0,
                                                    scale: 0.6,
                                                }}
                                                transition={{
                                                    type: 'spring',
                                                    stiffness: 500,
                                                    damping: 24,
                                                }}
                                            >
                                                {state.copySecret ? (
                                                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                                ) : (
                                                    <Copy className="h-3.5 w-3.5 shrink-0" />
                                                )}
                                            </motion.span>
                                        </AnimatePresence>
                                    </motion.div>
                                </CustomTooltip>
                            )}
                        </AnimatePresence>

                        <div className="flex flex-col gap-3 sm:flex-row">
                            <input
                                value={state.twoFactorToken}
                                onChange={(event) =>
                                    handler.handleTwoFactorTokenChange(
                                        event.target.value,
                                    )
                                }
                                inputMode="numeric"
                                maxLength={6}
                                placeholder="123456"
                                className="h-11 flex-1 rounded-md border border-border-dark bg-background-dark px-3 text-sm text-white outline-none transition-colors focus:border-primary/50"
                            />
                            <motion.button
                                type="button"
                                disabled={
                                    state.isConfirmingTwoFactorSetup ||
                                    state.twoFactorToken.length !== 6
                                }
                                onClick={handler.handleConfirmTwoFactorSetup}
                                whileTap={
                                    state.isConfirmingTwoFactorSetup ||
                                    state.twoFactorToken.length !== 6
                                        ? undefined
                                        : { scale: 0.97 }
                                }
                                className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {state.isConfirmingTwoFactorSetup && (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                )}
                                {state.isConfirmingTwoFactorSetup
                                    ? t('userSettings.security.checking')
                                    : t('userSettings.security.2faConfirm')}
                            </motion.button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
