import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function BackToLoginLink() {
    const { t } = useTranslationStore()

    return (
        <Link
            to="/login"
            className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-secondary-text transition-colors hover:text-white"
        >
            <ArrowLeft className="h-4 w-4" />
            {t('common.backToLogin')}
        </Link>
    )
}
