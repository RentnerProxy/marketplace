import type { ProfileApp } from '@/features/Social/Types/social.types.ts'

export type PublishedAppsLogicReturn = {
    state: { apps: Array<ProfileApp>; isSignedIn: boolean }
}
