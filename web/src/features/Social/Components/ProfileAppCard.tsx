import { Link } from '@tanstack/react-router'
import { CustomTooltip } from '@rentnerkev/tooltips'
import { AtSign, PencilLine, Scale, Tag } from 'lucide-react'
import AppLogo from '@/features/AppStore/Components/AppLogo.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { ProfileAppCardProps } from '../Types/social-component.types.ts'
import StarButton from './StarButton.tsx'

export default function ProfileAppCard({
    app,
    isSignedIn,
    canEdit = false,
    publisher = null,
}: ProfileAppCardProps) {
    const { t } = useTranslationStore()

    return (
        <li className="comic-card flex h-full flex-col gap-4 bg-surface-dark p-5 text-foreground">
            <div className="flex items-start justify-between gap-3">
                <Link
                    to="/apps/$appId"
                    params={{ appId: app.appId }}
                    className="group flex min-w-0 items-center gap-3"
                >
                    <AppLogo logoSrc={app.logoSrc} name={app.name} size="sm" />
                    <div className="min-w-0">
                        <h3 className="comic-title truncate text-2xl group-hover:underline">
                            {app.name}
                        </h3>
                        <p className="truncate font-mono text-xs text-secondary-text">
                            {app.appId}
                        </p>
                    </div>
                </Link>
                <StarButton app={app} isSignedIn={isSignedIn} />
            </div>
            <p className="line-clamp-3 flex-1 text-sm leading-6">
                {app.summary}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
                {publisher && (
                    <Link
                        to="/u/$username"
                        params={{ username: publisher }}
                        className="comic-chip transition-transform hover:-translate-x-px hover:-translate-y-px"
                    >
                        <AtSign aria-hidden="true" className="h-3.5 w-3.5" />
                        {publisher}
                    </Link>
                )}
                <span className="comic-chip">
                    <Tag aria-hidden="true" className="h-3.5 w-3.5" />
                    {t('social.appVersion', { version: app.version })}
                </span>
                <span className="comic-chip">
                    <Scale aria-hidden="true" className="h-3.5 w-3.5" />
                    {app.license}
                </span>
                {canEdit && (
                    <CustomTooltip side="top" content={t('appStore.edit')}>
                        <Link
                            to="/user/app-submissions/$appId"
                            params={{ appId: app.appId }}
                            aria-label={t('appStore.edit')}
                            className="comic-btn comic-btn-sm comic-btn-white ml-auto"
                        >
                            <PencilLine
                                aria-hidden="true"
                                className="h-4 w-4"
                            />
                        </Link>
                    </CustomTooltip>
                )}
            </div>
        </li>
    )
}
