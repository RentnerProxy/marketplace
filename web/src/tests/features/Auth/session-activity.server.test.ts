import { beforeEach, describe, expect, it, vi } from 'bun:test'

const serviceMocks = {
    touch: vi.fn(async () => ({
        active: true,
        expiresAt: '2026-09-06T04:15:00.000Z',
    })),
    validate: vi.fn(async () => ({ user: null })),
    logout: vi.fn(async () => ({ success: true })),
}
vi.mock('@tanstack/react-start', () => ({
    createServerFn: (options: { method: string }) => ({
        handler: (handler: () => Promise<unknown>) =>
            Object.assign(handler, { method: options.method }),
    }),
}))
vi.mock('@/server/Auth/session-activity.service.ts', () => ({
    touchCurrentSessionActivityService: serviceMocks.touch,
}))
vi.mock('@/server/Auth/validate.service.ts', () => ({
    validateSessionService: serviceMocks.validate,
}))
vi.mock('@/server/Auth/logout.service.ts', () => ({
    logoutService: serviceMocks.logout,
}))

const { logoutHandler, touchSessionActivityHandler, validateSessionHandler } =
    await import('@/features/Auth/middleware.ts')

describe('session activity server adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('uses POST and delegates without accepting a selectable session identity', async () => {
        expect(Reflect.get(touchSessionActivityHandler, 'method')).toBe('POST')
        expect(await touchSessionActivityHandler()).toEqual({
            active: true,
            expiresAt: '2026-09-06T04:15:00.000Z',
        })
        expect(serviceMocks.touch.mock.calls).toEqual([[]])
    })

    it('keeps GET validation passive', async () => {
        expect(Reflect.get(validateSessionHandler, 'method')).toBe('GET')
        await validateSessionHandler()
        expect(serviceMocks.validate).toHaveBeenCalledTimes(1)
        expect(serviceMocks.touch).not.toHaveBeenCalled()
    })

    it('keeps explicit logout separate and on POST', async () => {
        expect(Reflect.get(logoutHandler, 'method')).toBe('POST')
        await logoutHandler()
        expect(serviceMocks.logout).toHaveBeenCalledTimes(1)
        expect(serviceMocks.touch).not.toHaveBeenCalled()
    })

    it('propagates touch rate-limit or storage failures', async () => {
        const error = new Error('Synthetic unavailable')
        serviceMocks.touch.mockRejectedValueOnce(error)
        await expect(touchSessionActivityHandler()).rejects.toBe(error)
        expect(serviceMocks.touch).toHaveBeenCalledTimes(1)
    })
})
