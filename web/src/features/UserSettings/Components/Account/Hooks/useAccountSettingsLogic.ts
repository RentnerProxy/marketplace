import type { AccountSettingsLogicReturn } from '../Types/account-logic.types.ts'
import { useQuery } from '@tanstack/react-query'
import { getProfileImageSrc } from '@/lib/Images/userImageUrls.ts'
import { DEFAULT_IMAGE_SRC } from '@/lib/Images/imageFallbacks.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import useLocalProfileImageVersion from '@/shared/Images/Hooks/useLocalProfileImageVersion.ts'

export default function useAccountSettingsLogic(): AccountSettingsLogicReturn {
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())

    const userId = sessionData?.user?.id ?? ''

    const sessionProfileImageVersion =
        sessionData?.user?.profileImageVersion ?? 0

    const localProfileImageVersion = useLocalProfileImageVersion(userId, null)

    const profileImageVersion =
        localProfileImageVersion ?? sessionProfileImageVersion

    const profileImageSrc = userId
        ? getProfileImageSrc(userId, profileImageVersion)
        : DEFAULT_IMAGE_SRC

    return {
        state: {
            profileImageSrc,
            userId,
            username: sessionData?.user?.username ?? '',
            firstName: sessionData?.user?.firstName ?? '',
            lastName: sessionData?.user?.lastName ?? '',
            street: sessionData?.user?.street ?? '',
            houseNumber: sessionData?.user?.houseNumber ?? '',
            postalCode: sessionData?.user?.postalCode ?? '',
            city: sessionData?.user?.city ?? '',
        },
    }
}
