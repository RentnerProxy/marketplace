import type { USER_PROFILE_TABS } from '@/config/user-profile.config.ts'
import type { ImageCropSelection } from '@/shared/Images/Types/image-crop-selection.types.ts'

export type UserProfileTab = (typeof USER_PROFILE_TABS)[number]

export type UserProfilePageLogicReturn = {
    state: {
        activeTab: UserProfileTab
        appCount: number
        starCount: number
        bannerSrc: string | null
        bio: string
        followerCount: number
        followingCount: number
        profileImageSrc: string
        userId: string
        username: string
    }
    handler: {
        handleTabChange: (tab: UserProfileTab) => void
    }
}

export type ProfileHeroProps = {
    appCount: number
    starCount: number
    bannerSrc: string | null
    bio: string
    followerCount: number
    followingCount: number
    profileImageSrc: string
    userId: string
    username: string
}

export type ProfileAppsSectionProps = {
    username: string
}

export type ProfileBannerProps = {
    bannerSrc: string | null
    username: string
}

export type ProfileAvatarProps = {
    profileImageSrc: string
    userId: string
    username: string
}

export type ProfileBannerLogicReturn = {
    state: Pick<ImageCropSelection['state'], 'crop' | 'imageSrc' | 'zoom'> & {
        isRemoveDialogOpen: boolean
        isRemovingBanner: boolean
        isSavingBanner: boolean
    }
    handler: Pick<
        ImageCropSelection['handler'],
        'handleCropComplete' | 'handleSelectImage'
    > & {
        handleCancelBanner: () => void
        handleCloseRemoveBanner: () => void
        handleConfirmRemoveBanner: () => void
        handleCropChange: (crop: ImageCropSelection['state']['crop']) => void
        handleOpenRemoveBanner: () => void
        handleSaveBanner: () => void
        handleZoomChange: (zoom: number) => void
    }
}

export type ProfileBioProps = {
    bio: string
}

export type ProfileBioLogicReturn = {
    state: {
        bioValue: string
        hasBioChanged: boolean
        isEditingBio: boolean
        isSavingBio: boolean
    }
    handler: {
        handleBioChange: (value: string) => void
        handleCancelEditingBio: () => void
        handleSaveBio: () => void
        handleStartEditingBio: () => void
    }
}
