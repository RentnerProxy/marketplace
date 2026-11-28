import { Link } from '@tanstack/react-router'
import { UserX } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function PublicProfileNotFound() {
    const { t } = useTranslationStore()

    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-16">
            <section className="comic-panel bg-white p-8 text-center text-ink">
                <UserX aria-hidden="true" className="mx-auto h-10 w-10" />
                <h1 className="comic-title mt-4 text-5xl">
                    {t('social.notFoundTitle')}
                </h1>
                <p className="mt-3 text-steel-600">
                    {t('social.notFoundDescription')}
                </p>
                <Link to="/" className="comic-btn comic-btn-sm mt-6">
                    {t('marketplace.home')}
                </Link>
            </section>
        </div>
    )
}
