import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { publicProfileQueryOptions } from '@/lib/Social/socialQueries.ts'
import {
    getProfileImageSrc,
    getUserBackgroundSrc,
} from '@/lib/Images/userImageUrls.ts'
import { DEFAULT_IMAGE_SRC } from '@/lib/Images/imageFallbacks.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useLocalProfileImageVersion from '@/shared/Images/Hooks/useLocalProfileImageVersion.ts'
import type {
    UserProfilePageLogicReturn,
    UserProfileTab,
} from '../Types/user-profile.types.ts'

export default function useUserProfilePageLogic(): UserProfilePageLogicReturn {
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())
    const search = useSearch({ from: '/_authenticated/profile' })
    const navigate = useNavigate()
    const user = sessionData?.user
    const userId = user?.id ?? ''
    const localProfileImageVersion = useLocalProfileImageVersion(userId, null)
    const profileImageVersion =
        localProfileImageVersion ?? user?.profileImageVersion ?? 0
    const username = user?.username ?? ''
    const { data: publicProfile } = useQuery({
        ...publicProfileQueryOptions(username),
        enabled: Boolean(username),
    })

    function handleTabChange(tab: UserProfileTab) {
        void navigate({
            to: '/profile',
            search: { tab },
            replace: true,
            resetScroll: false,
        }).catch(toastAppError)
    }

    return {
        state: {
            activeTab: search.tab ?? 'apps',
            appCount: publicProfile?.appCount ?? 0,
            starCount: publicProfile?.starCount ?? 0,
            bannerSrc: getUserBackgroundSrc(
                userId,
                user?.customBackgroundUpdatedAt,
            ),
            bio: user?.bio ?? '',
            followerCount: publicProfile?.followerCount ?? 0,
            followingCount: publicProfile?.followingCount ?? 0,
            profileImageSrc: userId
                ? getProfileImageSrc(userId, profileImageVersion)
                : DEFAULT_IMAGE_SRC,
            userId,
            username,
        },
        handler: { handleTabChange },
    }
}
