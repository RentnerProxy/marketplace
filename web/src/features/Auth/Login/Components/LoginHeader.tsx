import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useLoginHeaderLogic from '@/features/Auth/Login/Hooks/useLoginHeaderLogic.ts'
import {
    applyImageFallback,
    DEFAULT_IMAGE_SRC,
} from '@/lib/Images/imageFallbacks.ts'

export function LoginHeader() {
    const { t } = useTranslationStore()
    const { state } = useLoginHeaderLogic()

    return (
        <div className="mb-8">
            <div className="mb-8 flex items-center gap-3 border-b border-[#dce6df] pb-6">
                {state.hasCustomLogo ||
                state.companyName !== PROJECT_CONFIG.defaultName ? (
                    <>
                        <img
                            src={state.logoSrc}
                            alt={state.companyName}
                            loading="eager"
                            decoding="sync"
                            fetchPriority="high"
                            onError={(event) =>
                                applyImageFallback(event, DEFAULT_IMAGE_SRC)
                            }
                            className="h-12 w-12 shrink-0 object-contain"
                        />
                        <span className="font-display text-xl leading-tight">
                            {state.companyName}
                        </span>
                    </>
                ) : (
                    <MarketplaceLogo
                        className="w-64 max-w-full"
                        sizes="256px"
                    />
                )}
            </div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#0d6d2b]">
                {t('auth.login.eyebrow')}
            </p>
            <h1 className="font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl">
                {t('auth.login.welcomeBack')}
            </h1>
            <p className="mt-4 text-sm leading-7 text-[#52675d]">
                {t('marketplace.loginDescription')}
            </p>
        </div>
    )
}
