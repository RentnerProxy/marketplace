import type { z } from 'zod'
import type { PROFILE_FOLLOW_LISTS } from '@/config/social.config.ts'
import type {
    followUserInputSchema,
    getProfileAppsInputSchema,
    getProfileFollowsInputSchema,
    getPublicProfileInputSchema,
    searchProfilesInputSchema,
    starAppInputSchema,
} from '../validation.ts'

export type ProfileFollowList = (typeof PROFILE_FOLLOW_LISTS)[number]

export type GetPublicProfileInput = z.infer<typeof getPublicProfileInputSchema>
export type SearchProfilesInput = z.infer<typeof searchProfilesInputSchema>
export type GetProfileFollowsInput = z.infer<
    typeof getProfileFollowsInputSchema
>
export type FollowUserInput = z.infer<typeof followUserInputSchema>
export type GetProfileAppsInput = z.infer<typeof getProfileAppsInputSchema>
export type StarAppInput = z.infer<typeof starAppInputSchema>

/** Account card shown in search results and follower lists. */
export type ProfileSummary = {
    id: string
    username: string
    bio: string | null
    isTeam: boolean
    profileImageVersion: number | null
    isFollowing: boolean
    isSelf: boolean
}

export type PublicProfile = ProfileSummary & {
    bannerVersion: string | null
    followerCount: number
    followingCount: number
    appCount: number
    starCount: number
    joinedAt: string
}

export type ProfileFollowsPage = {
    profiles: Array<ProfileSummary>
    nextOffset: number | null
}

export type FollowResult =
    | { success: true; isFollowing: boolean; followerCount: number }
    | { success: false; error: string }

/** Latest published version of an app, as listed on its publisher's profile. */
export type ProfileApp = {
    appId: string
    name: string
    summary: string
    license: string
    version: string
    publishedAt: string
    logoSrc: string | null
    starCount: number
    isStarred: boolean
}

export type StarResult =
    | { success: true; isStarred: boolean; starCount: number }
    | { success: false; error: string }
