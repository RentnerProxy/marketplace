import { Home } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function Footer() {
    const { t } = useTranslationStore()

    return (
        <Link
            aria-label={t('shared.notFound.backToDashboard')}
            to="/"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
            <Home size={18} />
            {t('shared.notFound.backToDashboard')}
        </Link>
    )
}
