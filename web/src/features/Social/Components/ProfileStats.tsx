import { Download, Package, Star } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { ProfileStatsProps } from '../Types/social-component.types.ts'

/** Apps, total downloads and stars of an account's apps. */
export default function ProfileStats({
    appCount,
    starCount,
}: ProfileStatsProps) {
    const { t } = useTranslationStore()
    const comingSoon = (
        <span className="rounded-sm bg-ink px-1.5 text-[0.7rem] uppercase text-proxy-300">
            {t('profile.stats.comingSoon')}
        </span>
    )

    return (
        <>
            <span className="comic-chip">
                <Package aria-hidden="true" className="h-4 w-4" />
                {t('profile.stats.apps')}
                <span className="tabular-nums">{appCount}</span>
            </span>
            <span className="comic-chip">
                <Download aria-hidden="true" className="h-4 w-4" />
                {t('profile.stats.downloads')}
                {comingSoon}
            </span>
            <span className="comic-chip">
                <Star aria-hidden="true" className="h-4 w-4" />
                {t('profile.stats.stars')}
                <span className="tabular-nums">{starCount}</span>
            </span>
        </>
    )
}
