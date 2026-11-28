import type { ReactNode } from 'react'
import type {
    ProfileApp,
    ProfileFollowList,
    ProfileSummary,
} from './social.types.ts'

export type FollowButtonProps = {
    profile: ProfileSummary
    isSignedIn: boolean
}

export type FollowButtonLogicReturn = {
    state: { isPending: boolean }
    handler: { handleToggleFollow: () => void }
}

export type ProfileStatsProps = {
    appCount: number
    starCount: number
}

export type ProfileCardProps = {
    profile: ProfileSummary
    isSignedIn: boolean
}

export type ProfileFollowListProps = {
    username: string
    list: ProfileFollowList
    isSignedIn: boolean
}

export type ProfileFollowListLogicReturn = {
    state: {
        profiles: Array<ProfileSummary>
        isLoading: boolean
        hasMore: boolean
        isLoadingMore: boolean
    }
    handler: { handleLoadMore: () => void }
}

export type ProfileAppsListProps = {
    username: string
    isSignedIn: boolean
    canEdit?: boolean
    emptyState: ReactNode
}

export type ProfileAppsListLogicReturn = {
    state: {
        apps: Array<ProfileApp>
        isLoading: boolean
    }
}

export type ProfileAppCardProps = {
    app: ProfileApp
    isSignedIn: boolean
    canEdit?: boolean
    /** Publisher username, shown in the catalog where cards mix publishers. */
    publisher?: string | null
}

export type StarButtonProps = {
    app: ProfileApp
    isSignedIn: boolean
}

export type StarButtonLogicReturn = {
    state: { isPending: boolean }
    handler: { handleToggleStar: () => void }
}
