import { Link } from '@tanstack/react-router'
import { PackageX } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function AppDetailNotFound() {
    const { t } = useTranslationStore()

    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-16">
            <section className="comic-panel bg-white p-8 text-center text-ink">
                <PackageX aria-hidden="true" className="mx-auto h-10 w-10" />
                <h1 className="comic-title mt-4 text-5xl">
                    {t('appStore.detail.notFoundTitle')}
                </h1>
                <p className="mt-3 text-steel-600">
                    {t('appStore.detail.notFoundDescription')}
                </p>
                <Link to="/apps" className="comic-btn comic-btn-sm mt-6">
                    {t('appStore.detail.backToApps')}
                </Link>
            </section>
        </div>
    )
}
