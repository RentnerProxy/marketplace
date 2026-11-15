import { Link } from '@tanstack/react-router'
import { CustomTooltip } from '@rentnerkev/tooltips'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { SidebarHeaderProps } from '../Types/authenticated-layout-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useAuthenticatedSidebarLogic from '../Hooks/useAuthenticatedSidebarLogic.ts'
import {
    applyImageFallback,
    DEFAULT_FAVICON_SRC,
} from '@/lib/Images/imageFallbacks.ts'

export default function SidebarHeader({
    title,
    subtitle,
    logoSrc,
    homeTo,
    isCollapsed,
}: SidebarHeaderProps) {
    const { t } = useTranslationStore()
    const { handler } = useAuthenticatedSidebarLogic()
    const collapseLabel = isCollapsed ? t('nav.expand') : t('nav.collapse')

    return (
        <>
            <CustomTooltip side="bottom" content={collapseLabel}>
                <button
                    type="button"
                    onClick={handler.handleToggleCollapse}
                    className="absolute -right-4 top-6 z-40 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border-dark bg-input-dark text-secondary-text shadow-lg shadow-black/30 transition-colors hover:text-white"
                    aria-label={collapseLabel}
                >
                    {isCollapsed ? (
                        <ChevronRight className="h-4 w-4" />
                    ) : (
                        <ChevronLeft className="h-4 w-4" />
                    )}
                </button>
            </CustomTooltip>

            <div className="flex h-18 items-center gap-3 border-b border-border-dark px-4">
                <Link
                    to={homeTo}
                    preload={false}
                    className="flex min-w-0 flex-1 items-center gap-3"
                >
                    <img
                        src={logoSrc}
                        alt={title}
                        loading="eager"
                        decoding="sync"
                        fetchPriority="high"
                        onError={(event) =>
                            applyImageFallback(event, DEFAULT_FAVICON_SRC)
                        }
                        className="h-10 w-10 shrink-0 rounded-lg border border-border-dark bg-input-dark object-contain"
                    />
                    {!isCollapsed && (
                        <div className="min-w-0">
                            <p className="truncate text-sm font-bold leading-5">
                                {title}
                            </p>
                            <p className="truncate text-xs text-secondary-text">
                                {subtitle}
                            </p>
                        </div>
                    )}
                </Link>
            </div>
        </>
    )
}
