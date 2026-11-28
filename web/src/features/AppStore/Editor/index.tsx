import { Link } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink, LoaderCircle } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import AppLogo from '../Components/AppLogo.tsx'
import StoreDescriptionEditor from '../Components/StoreDescriptionEditor.tsx'
import StoreLogoEditor from '../Components/StoreLogoEditor.tsx'
import StoreScreenshotsEditor from '../Components/StoreScreenshotsEditor.tsx'
import useStoreEditorPageLogic from '../Hooks/useStoreEditorPageLogic.ts'
import type { StoreEditorPageProps } from '../Types/app-store-component.types.ts'

/** Store listing editor for owners and reviewers, also before publication. */
export default function StoreEditorPage({ appId }: StoreEditorPageProps) {
    const { t } = useTranslationStore()
    const { state } = useStoreEditorPageLogic(appId)
    const entry = state.entry

    if (state.isLoading) {
        return (
            <p className="comic-lettering flex items-center justify-center gap-2 py-16 text-sm text-secondary-text">
                <LoaderCircle
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                />
                {t('appStore.loading')}
            </p>
        )
    }

    if (!entry) {
        return (
            <section className="comic-panel mx-auto max-w-xl bg-surface-dark p-6 text-center">
                <h1 className="comic-title text-4xl">
                    {t('appStore.notAllowedTitle')}
                </h1>
                <p className="mt-3 text-sm text-secondary-text">
                    {t('appStore.notAllowedDescription')}
                </p>
                <Link
                    to="/user/app-submissions"
                    className="comic-btn comic-btn-sm mt-5"
                >
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    {t('appStore.backToSubmissions')}
                </Link>
            </section>
        )
    }

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <Link
                to="/user/app-submissions"
                className="comic-lettering inline-flex w-fit items-center gap-2 text-sm text-secondary-text hover:text-foreground"
            >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                {t('appStore.backToSubmissions')}
            </Link>
            <header className="comic-panel flex flex-wrap items-center gap-5 bg-surface-dark p-5 sm:p-6">
                <AppLogo logoSrc={entry.logoSrc} name={entry.name} size="md" />
                <div className="min-w-0 flex-1">
                    <p className="comic-caption">
                        {t('appStore.editorEyebrow')}
                    </p>
                    <h1 className="comic-title mt-2 truncate text-5xl">
                        {entry.name}
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono text-secondary-text">
                            {entry.appId}
                        </span>
                        <span className="comic-chip">
                            {t(`submissions.status.${entry.status}`)}
                        </span>
                    </div>
                </div>
                {entry.isPublished ? (
                    <Link
                        to="/apps/$appId"
                        params={{ appId: entry.appId }}
                        className="comic-btn comic-btn-sm comic-btn-white"
                    >
                        <ExternalLink aria-hidden="true" className="h-4 w-4" />
                        {t('appStore.viewPublic')}
                    </Link>
                ) : (
                    <p className="max-w-xs text-xs leading-5 text-secondary-text">
                        {t('appStore.notPublishedHint')}
                    </p>
                )}
            </header>

            <StoreLogoEditor
                appId={entry.appId}
                logoSrc={entry.logoSrc}
                name={entry.name}
            />
            <StoreScreenshotsEditor
                appId={entry.appId}
                screenshots={entry.screenshots}
            />
            <StoreDescriptionEditor
                key={entry.appId}
                appId={entry.appId}
                description={entry.description}
            />
        </div>
    )
}
