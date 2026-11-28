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
        <div className="mb-5">
            {state.hasCustomLogo ||
            state.companyName !== PROJECT_CONFIG.defaultName ? (
                <div className="mb-3 flex items-center gap-2.5">
                    <img
                        src={state.logoSrc}
                        alt={state.companyName}
                        loading="eager"
                        decoding="sync"
                        fetchPriority="high"
                        onError={(event) =>
                            applyImageFallback(event, DEFAULT_IMAGE_SRC)
                        }
                        className="h-8 w-8 shrink-0 rounded-lg object-contain"
                    />
                    <span className="text-sm font-semibold leading-tight text-ink">
                        {state.companyName}
                    </span>
                </div>
            ) : null}
            <p className="comic-caption mb-4">{t('auth.login.eyebrow')}</p>
            <h1 className="comic-title text-5xl sm:text-6xl">
                {t('auth.login.welcomeBack')}
            </h1>
            <p className="mt-2 text-sm leading-5 text-steel-600">
                {t('auth.experience.accountHint')}
            </p>
        </div>
    )
}
