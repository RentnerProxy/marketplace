import { z } from 'zod'
import { PROFILE_FOLLOW_LISTS, SOCIAL_CONFIG } from '@/config/social.config.ts'
import { appId } from '../../../../contracts/v1/primitives.ts'

const profileUsernameSchema = z.string().trim().min(1).max(50)

export const getPublicProfileInputSchema = z.object({
    username: profileUsernameSchema,
})

export const searchProfilesInputSchema = z.object({
    query: z.string().trim().min(SOCIAL_CONFIG.searchMinLength).max(50),
})

export const getProfileFollowsInputSchema = z.object({
    username: profileUsernameSchema,
    list: z.enum(PROFILE_FOLLOW_LISTS),
    offset: z.number().int().min(0).max(10_000).default(0),
})

export const followUserInputSchema = z.object({
    userId: z.uuidv7(),
})

export const getProfileAppsInputSchema = z.object({
    username: profileUsernameSchema,
})

export const starAppInputSchema = z.object({
    appId,
})

export const publicProfileSearchSchema = z.object({
    tab: z
        .enum(['apps', ...PROFILE_FOLLOW_LISTS])
        .optional()
        .catch(undefined),
})
