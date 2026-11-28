import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { DEFAULT_IMAGE_SRC } from '@/lib/Images/imageFallbacks.ts'
import {
    getProfileImageSrc,
    getPublicProfileBannerSrc,
} from '@/lib/Images/userImageUrls.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { publicProfileQueryOptions } from '@/lib/Social/socialQueries.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import type {
    PublicProfilePageLogicReturn,
    PublicProfileTab,
} from '../Types/public-profile.types.ts'

export default function usePublicProfilePageLogic(
    username: string,
): PublicProfilePageLogicReturn {
    const { language } = useTranslationStore()
    const { data: profile } = useQuery(publicProfileQueryOptions(username))
    const { data: session } = useQuery(authenticatedSessionQueryOptions())
    const search = useSearch({ from: '/u/$username' })
    const navigate = useNavigate()

    function handleTabChange(tab: PublicProfileTab) {
        void navigate({
            to: '/u/$username',
            params: { username },
            search: { tab },
            replace: true,
            resetScroll: false,
        }).catch(toastAppError)
    }

    return {
        state: {
            activeTab: search.tab ?? 'apps',
            bannerSrc: profile
                ? getPublicProfileBannerSrc(profile.id, profile.bannerVersion)
                : null,
            isSignedIn: Boolean(session?.user),
            joinedLabel: profile
                ? new Intl.DateTimeFormat(language, {
                      month: 'long',
                      year: 'numeric',
                  }).format(new Date(profile.joinedAt))
                : '',
            profile: profile ?? null,
            profileImageSrc: profile
                ? getProfileImageSrc(profile.id, profile.profileImageVersion)
                : DEFAULT_IMAGE_SRC,
        },
        handler: { handleTabChange },
    }
}
