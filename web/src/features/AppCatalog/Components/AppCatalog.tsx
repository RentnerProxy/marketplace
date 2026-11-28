import { CircleAlert, LoaderCircle, RotateCw, SearchX } from 'lucide-react'
import ProfileAppCard from '@/features/Social/Components/ProfileAppCard.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useAppCatalogLogic from '../Hooks/useAppCatalogLogic.ts'
import type { AppCatalogProps } from '../Types/app-catalog.types.ts'
import AppCatalogToolbar from './AppCatalogToolbar.tsx'

/** Published apps with search, sorting and a star filter. */
export default function AppCatalog({
    title,
    hideWhenEmpty = false,
    emptyState = null,
}: AppCatalogProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useAppCatalogLogic()

    if (state.isLoading) {
        return hideWhenEmpty ? null : (
            <p className="comic-lettering flex items-center justify-center gap-2 py-16 text-sm text-secondary-text">
                <LoaderCircle
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                />
                {t('catalog.loading')}
            </p>
        )
    }

    if (state.isError) {
        return (
            <div
                role="alert"
                className="comic-notice flex flex-col items-start gap-3 bg-surface-dark p-5 text-foreground [--notice-tone:var(--color-danger)]"
            >
                <p className="flex items-center gap-2 text-sm font-semibold">
                    <CircleAlert aria-hidden="true" className="h-4 w-4" />
                    {t('catalog.loadError')}
                </p>
                <button
                    type="button"
                    onClick={handler.handleRetry}
                    className="comic-btn comic-btn-sm comic-btn-white"
                >
                    <RotateCw aria-hidden="true" className="h-4 w-4" />
                    {t('catalog.retry')}
                </button>
            </div>
        )
    }

    if (state.totalCount === 0) {
        return hideWhenEmpty ? null : emptyState
    }

    return (
        <section
            aria-labelledby={title ? 'app-catalog-title' : undefined}
            aria-label={title ? undefined : t('catalog.title')}
            className="flex flex-col gap-6"
        >
            {title && (
                <h2
                    id="app-catalog-title"
                    className="comic-title text-4xl sm:text-5xl"
                >
                    {title}
                </h2>
            )}
            <AppCatalogToolbar state={state} handler={handler} />
            <p
                aria-live="polite"
                className="comic-lettering text-xs text-secondary-text"
            >
                {t('catalog.resultCount', {
                    count: state.apps.length,
                    total: state.totalCount,
                })}
            </p>
            {state.apps.length === 0 ? (
                <div className="comic-hatch flex flex-col items-center gap-3 rounded-md border-[3px] border-dashed border-border-dark px-5 py-12 text-center [--hatch-color:color-mix(in_oklab,var(--color-primary)_12%,transparent)]">
                    <SearchX aria-hidden="true" className="h-8 w-8" />
                    <p className="text-sm">{t('catalog.noMatches')}</p>
                    <button
                        type="button"
                        onClick={handler.handleResetFilters}
                        className="comic-btn comic-btn-sm comic-btn-white"
                    >
                        {t('catalog.resetFilters')}
                    </button>
                </div>
            ) : (
                <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {state.apps.map((app) => (
                        <ProfileAppCard
                            key={app.appId}
                            app={app}
                            publisher={app.publisher}
                            isSignedIn={state.isSignedIn}
                        />
                    ))}
                </ul>
            )}
        </section>
    )
}
