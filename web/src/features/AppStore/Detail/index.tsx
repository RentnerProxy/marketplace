import { Link } from '@tanstack/react-router'
import { CalendarDays, PencilLine, Scale, Tag } from 'lucide-react'
import StarButton from '@/features/Social/Components/StarButton.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { getProfileImageSrc } from '@/lib/Images/userImageUrls.ts'
import AppLogo from '../Components/AppLogo.tsx'
import useAppDetailPageLogic from '../Hooks/useAppDetailPageLogic.ts'
import type { AppDetailPageProps } from '../Types/app-store-component.types.ts'
import ScreenshotGallery from './Components/ScreenshotGallery.tsx'

export default function AppDetailPage({ appId }: AppDetailPageProps) {
    const { t, language } = useTranslationStore()
    const { state } = useAppDetailPageLogic(appId)
    const app = state.app

    if (!app) {
        return null
    }

    const publishedLabel = new Intl.DateTimeFormat(language, {
        dateStyle: 'long',
    }).format(new Date(app.publishedAt))

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
            <section
                aria-labelledby="app-detail-title"
                className="comic-panel relative isolate overflow-hidden bg-surface-dark p-6 text-foreground sm:p-8"
            >
                <div
                    aria-hidden="true"
                    className="comic-hatch pointer-events-none absolute inset-y-0 right-0 -z-10 w-1/2 [mask-image:linear-gradient(270deg,black,transparent)]"
                />
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                    <AppLogo logoSrc={app.logoSrc} name={app.name} size="lg" />
                    <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-secondary-text">
                            {app.appId}
                        </p>
                        <h1
                            id="app-detail-title"
                            className="comic-title mt-1 break-words text-5xl sm:text-6xl"
                        >
                            {app.name}
                        </h1>
                        <p className="mt-3 max-w-2xl text-base leading-7">
                            {app.summary}
                        </p>
                        {app.publisher && (
                            <Link
                                to="/u/$username"
                                params={{ username: app.publisher.username }}
                                className="mt-4 inline-flex items-center gap-2 font-comic text-sm font-bold hover:underline"
                            >
                                <img
                                    src={getProfileImageSrc(
                                        app.publisher.id,
                                        app.publisher.profileImageVersion ?? 0,
                                    )}
                                    alt=""
                                    className="h-7 w-7 rounded-full border-2 border-ink object-cover"
                                />
                                {t('appStore.detail.by', {
                                    username: app.publisher.username,
                                })}
                            </Link>
                        )}
                        <div className="mt-5 flex flex-wrap gap-2 text-xs">
                            <span className="comic-chip">
                                <Tag
                                    aria-hidden="true"
                                    className="h-3.5 w-3.5"
                                />
                                {t('social.appVersion', {
                                    version: app.version,
                                })}
                            </span>
                            <span className="comic-chip">
                                <Scale
                                    aria-hidden="true"
                                    className="h-3.5 w-3.5"
                                />
                                {app.license}
                            </span>
                            <span className="comic-chip">
                                <CalendarDays
                                    aria-hidden="true"
                                    className="h-3.5 w-3.5"
                                />
                                {t('appStore.detail.published', {
                                    date: publishedLabel,
                                })}
                            </span>
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-3">
                        <StarButton app={app} isSignedIn={state.isSignedIn} />
                        {app.canEdit && (
                            <Link
                                to="/user/app-store/$appId"
                                params={{ appId: app.appId }}
                                className="comic-btn comic-btn-sm comic-btn-white"
                            >
                                <PencilLine
                                    aria-hidden="true"
                                    className="h-4 w-4"
                                />
                                {t('appStore.edit')}
                            </Link>
                        )}
                    </div>
                </div>
            </section>

            <ScreenshotGallery name={app.name} screenshots={app.screenshots} />

            <section
                aria-labelledby="app-description-title"
                className="comic-card bg-surface-dark p-6 text-foreground sm:p-8"
            >
                <h2 id="app-description-title" className="comic-title text-4xl">
                    {t('appStore.description.title')}
                </h2>
                <p className="mt-4 max-w-3xl whitespace-pre-line break-words text-base leading-8">
                    {app.description || app.summary}
                </p>
            </section>
        </div>
    )
}
