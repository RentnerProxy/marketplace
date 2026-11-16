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
        <div className="mb-7">
            {state.hasCustomLogo ||
            state.companyName !== PROJECT_CONFIG.defaultName ? (
                <div className="mb-6 flex items-center gap-3">
                    <img
                        src={state.logoSrc}
                        alt={state.companyName}
                        loading="eager"
                        decoding="sync"
                        fetchPriority="high"
                        onError={(event) =>
                            applyImageFallback(event, DEFAULT_IMAGE_SRC)
                        }
                        className="h-10 w-10 shrink-0 rounded-lg object-contain"
                    />
                    <span className="text-sm font-semibold leading-tight text-[#294b35]">
                        {state.companyName}
                    </span>
                </div>
            ) : null}
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[#176b34]">
                {t('auth.login.eyebrow')}
            </p>
            <h1 className="font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl">
                {t('auth.login.welcomeBack')}
            </h1>
            <p className="mt-3 text-sm leading-7 text-[#65786c]">
                {t('auth.experience.accountHint')}
            </p>
        </div>
    )
}
