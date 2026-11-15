import useTranslationStore from '@/language/useTranslationStore.ts'
import { ShieldCheck } from 'lucide-react'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function Privacy() {
    const { t } = useTranslationStore()

    return (
        <div className="w-full rounded-lg border border-border-dark bg-surface-dark p-8 text-center">
            <HeadingIcon
                icon={ShieldCheck}
                size="lg"
                className="mx-auto mb-4"
            />
            <h1 className="text-2xl font-bold text-white">
                {t('auth.privacy.title')}
            </h1>
            <p className="mt-2 text-sm text-secondary-text">
                {t('auth.privacy.placeholder')}
            </p>
        </div>
    )
}
