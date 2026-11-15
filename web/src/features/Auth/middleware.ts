import { createServerFn } from '@tanstack/react-start'
import { logoutService } from '@/server/Auth/logout.service.ts'
import { validateSessionService } from '@/server/Auth/validate.service.ts'
import { touchCurrentSessionActivityService } from '@/server/Auth/session-activity.service.ts'

export const validateSessionHandler = createServerFn({ method: 'GET' }).handler(
    async function () {
        return validateSessionService()
    },
)

export const touchSessionActivityHandler = createServerFn({
    method: 'POST',
}).handler(async function () {
    return touchCurrentSessionActivityService()
})

export const logoutHandler = createServerFn({ method: 'POST' }).handler(
    async function () {
        return logoutService()
    },
)
