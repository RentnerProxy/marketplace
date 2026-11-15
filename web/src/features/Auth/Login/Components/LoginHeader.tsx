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
        <div className="mb-6 text-center">
            <div className="mb-6 flex flex-col items-center gap-3">
                <h1 className="text-xl font-bold text-white">
                    {state.companyName}
                </h1>
                <img
                    src={state.logoSrc}
                    alt={state.companyName}
                    loading="eager"
                    decoding="sync"
                    fetchPriority="high"
                    onError={(event) =>
                        applyImageFallback(event, DEFAULT_IMAGE_SRC)
                    }
                    className="h-20 w-20 object-contain"
                />
            </div>
            <h2 className="text-xl font-bold text-white">
                {t('auth.login.title')}
            </h2>
            <p className="text-sm text-secondary-text mt-1">
                {t('marketplace.loginDescription')}
            </p>
        </div>
    )
}
