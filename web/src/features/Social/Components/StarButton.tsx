import { Link } from '@tanstack/react-router'
import { CustomTooltip } from '@rentnerkev/tooltips'
import { LoaderCircle, Star } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useStarButtonLogic from '../Hooks/useStarButtonLogic.ts'
import type { StarButtonProps } from '../Types/social-component.types.ts'

/** GitHub-style star toggle with the app's current star count. */
export default function StarButton({ app, isSignedIn }: StarButtonProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useStarButtonLogic(app)
    const count = <span className="tabular-nums">{app.starCount}</span>

    if (!isSignedIn) {
        return (
            <CustomTooltip side="top" content={t('social.loginToStar')}>
                <Link
                    to="/login"
                    aria-label={t('social.loginToStar')}
                    className="comic-btn comic-btn-sm comic-btn-white"
                >
                    <Star aria-hidden="true" className="h-4 w-4" />
                    {count}
                </Link>
            </CustomTooltip>
        )
    }

    const label = app.isStarred ? t('social.unstar') : t('social.star')
    const Icon = state.isPending ? LoaderCircle : Star
    const iconState = state.isPending
        ? 'animate-spin'
        : app.isStarred
          ? 'fill-current'
          : ''

    return (
        <CustomTooltip side="top" content={label}>
            <button
                type="button"
                aria-label={label}
                aria-pressed={app.isStarred}
                disabled={state.isPending}
                onClick={handler.handleToggleStar}
                className={`comic-btn comic-btn-sm ${app.isStarred ? '' : 'comic-btn-white'}`}
            >
                <Icon aria-hidden="true" className={`h-4 w-4 ${iconState}`} />
                {count}
            </button>
        </CustomTooltip>
    )
}
