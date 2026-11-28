import { z } from 'zod'
import { USER_PROFILE_TABS } from '@/config/user-profile.config.ts'

export const userProfileSearchSchema = z.object({
    tab: z.enum(USER_PROFILE_TABS).optional().catch(undefined),
})
