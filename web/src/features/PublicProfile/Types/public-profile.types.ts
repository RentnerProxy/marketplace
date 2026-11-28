import type {
    ProfileFollowList,
    PublicProfile,
} from '@/features/Social/Types/social.types.ts'

export type PublicProfileTab = 'apps' | ProfileFollowList

export type PublicProfilePageProps = {
    username: string
}

export type PublicProfilePageLogicReturn = {
    state: {
        activeTab: PublicProfileTab
        bannerSrc: string | null
        isSignedIn: boolean
        joinedLabel: string
        profile: PublicProfile | null
        profileImageSrc: string
    }
    handler: {
        handleTabChange: (tab: PublicProfileTab) => void
    }
}

export type PublicProfileHeroProps = {
    bannerSrc: string | null
    isSignedIn: boolean
    joinedLabel: string
    profile: PublicProfile
    profileImageSrc: string
    onShowList: (tab: ProfileFollowList) => void
}
