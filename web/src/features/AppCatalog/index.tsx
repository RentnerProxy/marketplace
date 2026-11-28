import { Link } from '@tanstack/react-router'
import { PackagePlus } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import MascotImage from '@/shared/Brand/MascotImage.tsx'
import AppCatalog from './Components/AppCatalog.tsx'

/** Signed-in landing page: every published app in one searchable grid. */
export default function AppCatalogPage() {
    const { t } = useTranslationStore()

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
            <AppCatalog
                emptyState={
                    <section className="comic-panel relative isolate flex flex-col items-start gap-4 overflow-hidden bg-surface-dark p-6 text-foreground sm:p-8">
                        <MascotImage
                            mascot="proxyBox"
                            sizes="10rem"
                            className="pointer-events-none absolute -bottom-6 right-4 -z-10 w-40 opacity-90"
                        />
                        <h2 className="comic-title text-4xl">
                            {t('catalog.emptyTitle')}
                        </h2>
                        <p className="max-w-xl text-sm leading-6 text-secondary-text">
                            {t('catalog.emptyDescription')}
                        </p>
                        <Link
                            to="/user/app-submissions"
                            className="comic-btn comic-btn-sm"
                        >
                            <PackagePlus
                                aria-hidden="true"
                                className="h-4 w-4"
                            />
                            {t('catalog.submitCta')}
                        </Link>
                    </section>
                }
            />
        </div>
    )
}
