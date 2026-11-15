import { Check, Laptop, Loader2, ShieldCheck, ShieldX } from 'lucide-react'
import { OtpInput } from '@rentnerkev/inputs'
import type { TwoFactorFormProps } from '../Types/login-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function TwoFactorForm({
    code,
    isLoading,
    isError,
    trustThisDevice,
    onSubmit,
    onChange,
    setRef,
    onTrustThisDeviceChange,
    onBackToLogin,
}: TwoFactorFormProps) {
    const { t } = useTranslationStore()

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2 text-center">
                <div className="mb-2 flex justify-center">
                    <HeadingIcon
                        icon={isError ? ShieldX : ShieldCheck}
                        tone={isError ? 'danger' : 'primary'}
                        size="lg"
                    />
                </div>
                <h2 className="font-display text-3xl text-marketplace-void">
                    {t('auth.twoFactor.title')}
                </h2>
                <p className="text-sm text-[#52675d]">
                    {t('auth.twoFactor.description')}
                </p>
            </div>

            <div className="my-4">
                <OtpInput
                    customDesign={{
                        bg: 'bg-[#f5f8f6]',
                        border: 'border-[#cbd9d0]',
                        text: 'text-marketplace-void',
                    }}
                    value={code}
                    onValueChange={onChange}
                    disabled={isLoading}
                    animated={true}
                    showProgress={true}
                    status={isError ? 'error' : 'idle'}
                    error={
                        isError && code.join('').length !== 6
                            ? t('auth.login.twoFactorCodeIncomplete')
                            : undefined
                    }
                    aria-label={t('auth.twoFactor.codeLabel')}
                    triggerRef={setRef}
                />
            </div>

            <label
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3.5 transition-colors ${
                    trustThisDevice
                        ? 'border-[#a2c7ae] bg-[#e9fff0] shadow-[inset_3px_0_0_var(--color-primary)]'
                        : 'border-[#dce6df] bg-[#f5f8f6] hover:border-[#a2c7ae]'
                } ${isLoading ? 'pointer-events-none opacity-50' : ''}`}
            >
                <div className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                    <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={trustThisDevice}
                        onChange={(event) =>
                            onTrustThisDeviceChange(event.target.checked)
                        }
                        disabled={isLoading}
                    />
                    <span
                        className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 ${
                            trustThisDevice
                                ? 'border-primary bg-primary'
                                : 'border-secondary-text bg-transparent'
                        }`}
                    >
                        {trustThisDevice ? (
                            <Check
                                className="h-3 w-3 text-background-dark"
                                strokeWidth={3}
                            />
                        ) : null}
                    </span>
                </div>
                <div className="flex gap-2 text-left">
                    <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-[#0d6d2b]" />
                    <div>
                        <span className="block text-sm font-medium text-marketplace-void">
                            {t('auth.twoFactor.rememberDevice')}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-[#52675d]">
                            {t('auth.twoFactor.rememberDeviceDescription')}
                        </span>
                    </div>
                </div>
            </label>

            <button
                type="submit"
                disabled={isLoading}
                className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-8 py-3.5 font-bold text-marketplace-void transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
                {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                    t('userSettings.security.2faConfirm')
                )}
            </button>

            <div className="mt-2 text-center">
                <button
                    type="button"
                    disabled={isLoading}
                    onClick={onBackToLogin}
                    className="cursor-pointer text-xs text-[#52675d] transition-colors hover:text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {t('common.backToLogin')}
                </button>
            </div>
        </form>
    )
}
