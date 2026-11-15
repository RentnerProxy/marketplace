import { Link } from '@tanstack/react-router'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import CardWave from '@/shared/Brand/CardWave.tsx'
import { ArrowLeft, Clock3, KeyRound } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function RegisterPage() {
    const { t } = useTranslationStore()

    return (
        <section aria-labelledby="register-title" className="relative isolate w-full max-w-lg overflow-hidden rounded-[2rem] border border-white/15 bg-white px-7 py-10 text-marketplace-void shadow-[0_24px_100px_rgba(0,0,0,0.2)] sm:p-10">
            <CardWave />
            <div className="mb-8 flex items-center gap-3 border-b border-[#dce6df] pb-6">
                <MarketplaceLogo className="w-64 max-w-full" sizes="256px" />
            </div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#0d6d2b]">{t('auth.register.eyebrow')}</p>
            <h1 id="register-title" className="font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl">{t('auth.register.title')}</h1>
            <p className="mt-4 text-sm leading-7 text-[#52675d]">{t('auth.register.description')}</p>

            <div id="registration-preview-notice" role="note" className="my-7 flex items-start gap-3 rounded-2xl border border-[#b5ddc1] bg-[#e9fff0] p-4">
                <Clock3 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#0d6d2b]" />
                <div>
                    <h2 className="text-sm font-bold">{t('auth.register.previewTitle')}</h2>
                    <p className="mt-1 text-xs leading-6 text-[#52675d]">{t('auth.register.previewDescription')}</p>
                </div>
            </div>

            <fieldset disabled aria-describedby="registration-preview-notice" className="space-y-5">
                <legend className="sr-only">{t('auth.register.accountDetails')}</legend>
                <div>
                    <label htmlFor="register-username" className="mb-2 block text-sm font-semibold">{t('marketplace.usernameLabel')}</label>
                    <input id="register-username" type="text" autoComplete="off" placeholder={t('auth.login.usernamePlaceholder')} className="w-full cursor-not-allowed rounded-xl border border-[#cbd9d0] bg-[#f5f8f6] px-4 py-3.5 text-sm placeholder:text-[#607468]" />
                </div>
                <div>
                    <label htmlFor="register-email" className="mb-2 block text-sm font-semibold">{t('auth.register.email')}</label>
                    <input id="register-email" type="email" autoComplete="off" placeholder={t('auth.register.emailPlaceholder')} className="w-full cursor-not-allowed rounded-xl border border-[#cbd9d0] bg-[#f5f8f6] px-4 py-3.5 text-sm placeholder:text-[#607468]" />
                </div>
                <div>
                    <label htmlFor="register-password" className="mb-2 block text-sm font-semibold">{t('marketplace.passwordLabel')}</label>
                    <input id="register-password" type="password" autoComplete="new-password" placeholder={t('auth.login.passwordPlaceholder')} className="w-full cursor-not-allowed rounded-xl border border-[#cbd9d0] bg-[#f5f8f6] px-4 py-3.5 text-sm placeholder:text-[#607468]" />
                </div>
                <button type="submit" disabled className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-[#dce6df] px-4 py-3.5 text-sm font-bold text-[#52675d]">
                    <KeyRound aria-hidden="true" className="h-4 w-4" />{t('auth.register.comingSoon')}
                </button>
            </fieldset>

            <p className="mt-7 border-t border-[#dce6df] pt-6 text-center text-sm text-[#52675d]">{t('auth.register.alreadyRegistered')}</p>
            <Link to="/login" className="mt-3 flex items-center justify-center gap-2 text-sm font-bold text-[#0d6d2b] underline-offset-4 hover:underline"><ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('auth.login.login')}</Link>
        </section>
    )
}
