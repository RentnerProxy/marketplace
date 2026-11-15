import { ShieldCheck } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function SetupHeader() {
    const { t } = useTranslationStore()

    return (
        <div className="mb-6 text-center">
            <HeadingIcon
                icon={ShieldCheck}
                size="lg"
                className="mx-auto mb-4"
            />
            <h1 className="text-2xl font-bold text-white">
                {t('auth.firstSetup.title')}
            </h1>
            <p className="mt-2 text-sm text-secondary-text">
                {t('auth.firstSetup.description')}
            </p>
        </div>
    )
}
