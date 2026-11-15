import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { RateLimitError } from '@/server/RateLimit/rateLimit.service.ts'
import { createAccountRateLimitTestHarness } from '../../UserSettings/account-rate-limit.test.helpers.ts'

const events: Array<string> = []
const rateLimits = createAccountRateLimitTestHarness(() =>
    events.push('rate-limit'),
)
const actor = '11111111-1111-4111-8111-111111111111'
const clientActor = '22222222-2222-4222-8222-222222222222'
const untrustedActor = { actorUserId: clientActor }
const permission = vi.fn(async function (_key: string) {
    return { userId: actor }
})
const rateLimit = rateLimits.enforce
function operation() {
    return vi.fn(async function (_data: unknown, _actor: string) {
        events.push('domain')
        return { success: true as const }
    })
}
const services = {
    company: operation(),
    logo: operation(),
    mode: operation(),
    extension: operation(),
}
const reads = {
    public: vi.fn(async () => ({ companyName: 'Public' })),
    admin: vi.fn(async () => ({ companyName: 'Admin' })),
}
vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => ({
        handler: (run: () => Promise<unknown>) => run,
        validator: (parse: (input: unknown) => unknown) => ({
            handler:
                (run: (context: { data: unknown }) => Promise<unknown>) =>
                async (input: { data: unknown }) =>
                    run({ data: parse(input.data) }),
        }),
    }),
}))
vi.mock('@/server/Auth/authorization.service.ts', () => ({
    requirePermissionService: permission,
}))
rateLimits.install()
vi.mock('@/server/Admin/SystemSettings/get.service.ts', () => ({
    getPublicSystemSettingsService: reads.public,
    getSystemSettingsService: reads.admin,
}))
vi.mock('@/server/Admin/SystemSettings/branding.service.ts', () => ({
    updateCompanyNameService: services.company,
    updateSystemLogoService: services.logo,
}))
vi.mock('@/server/Admin/SystemSettings/maintenance-mode.service.ts', () => ({
    updateMaintenanceModeService: services.mode,
}))
vi.mock(
    '@/server/Admin/SystemSettings/maintenance-extension.service.ts',
    () => ({
        resolveMaintenanceExtensionRequestService: services.extension,
    }),
)
const handlers = await import('@/features/Admin/SystemSettings/middleware.ts')
const company = { companyName: 'Acme' }
const logo = {
    imageDataUrl: 'data:image/webp;base64,dGVzdA==',
    crop: { x: 0, y: 0, width: 8, height: 8 },
}
const mode = { isEnabled: false as const }
const extension = { requestId: actor, status: 'rejected' as const }
const cases = [
    {
        name: 'company',
        service: services.company,
        data: company,
        run: () =>
            handlers.updateCompanyNameHandler({
                data: { ...company, ...untrustedActor },
            }),
    },
    {
        name: 'logo',
        service: services.logo,
        data: logo,
        run: () =>
            handlers.updateSystemLogoHandler({
                data: { ...logo, ...untrustedActor },
            }),
    },
    {
        name: 'mode',
        service: services.mode,
        data: mode,
        run: () =>
            handlers.updateMaintenanceModeHandler({
                data: { ...mode, ...untrustedActor },
            }),
    },
    {
        name: 'extension',
        service: services.extension,
        data: extension,
        run: () =>
            handlers.resolveMaintenanceExtensionRequestHandler({
                data: { ...extension, ...untrustedActor },
            }),
    },
]

describe('System settings verified audit actor contract', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        events.length = 0
        rateLimits.reset()
        permission.mockImplementation(async function () {
            events.push('permission')
            return { userId: actor }
        })
    })
    it.each(cases)(
        'uses the same two account-only budgets for $name',
        async function (entry) {
            await entry.run()
            expect(rateLimit).toHaveBeenNthCalledWith(1, {
                scope: 'system-settings-mutation-burst',
                identifiers: [actor],
                includeClientIp: false,
                limit: 30,
                windowMs: 60_000,
            })
            expect(rateLimit).toHaveBeenNthCalledWith(2, {
                scope: 'system-settings-mutation-daily',
                identifiers: [actor],
                includeClientIp: false,
                limit: 200,
                windowMs: 86_400_000,
            })
            expect(events.slice(0, 3)).toEqual([
                'permission',
                'rate-limit',
                'rate-limit',
            ])
            expect(rateLimit.mock.invocationCallOrder[1]).toBeLessThan(
                entry.service.mock.invocationCallOrder[0] ?? 0,
            )
            expect(rateLimit).toHaveBeenCalledTimes(
                entry.name === 'logo' ? 3 : 2,
            )
            if (entry.name === 'logo')
                expect(rateLimit).toHaveBeenNthCalledWith(3, {
                    scope: 'system-logo-upload',
                    limit: 20,
                    windowMs: 3_600_000,
                })
        },
    )

    it.each(
        cases.flatMap((entry) => [
            {
                entry,
                stage: 'burst',
                blockedCall: 1,
                error: new RateLimitError(60),
            },
            {
                entry,
                stage: 'daily',
                blockedCall: 2,
                error: new RateLimitError(3600),
            },
            {
                entry,
                stage: 'Valkey',
                blockedCall: 1,
                error: new Error('synthetic Valkey failure'),
            },
        ]),
    )(
        'stops $entry.name after a $stage error without fallback',
        async function ({ entry, blockedCall, error }) {
            if (blockedCall === 2) rateLimit.mockResolvedValueOnce(undefined)
            rateLimit.mockRejectedValueOnce(error)
            await expect(entry.run()).rejects.toBe(error)
            expect(permission).toHaveBeenCalledTimes(1)
            expect(rateLimit).toHaveBeenCalledTimes(blockedCall)
            for (const service of Object.values(services))
                expect(service).not.toHaveBeenCalled()
        },
    )

    it('shares the burst budget across actions and IP changes and separates verified actors', async function () {
        rateLimits.state.runRealLimiter = true
        await forEachSequentially(
            Array.from({ length: 30 }, (_, index) => index),
            async function (index) {
                await (index % 2 === 0
                    ? handlers.updateCompanyNameHandler({ data: company })
                    : handlers.updateMaintenanceModeHandler({ data: mode }))
            },
        )
        rateLimits.state.clientIp = '203.0.113.11'
        await expect(
            handlers.resolveMaintenanceExtensionRequestHandler({
                data: { ...extension, ...untrustedActor },
            }),
        ).rejects.toBeInstanceOf(RateLimitError)
        expect(services.extension).not.toHaveBeenCalled()
        expect(rateLimits.state.counters.size).toBe(2)
        expect(rateLimits.getClientIp).not.toHaveBeenCalled()

        permission.mockResolvedValueOnce({ userId: clientActor })
        await expect(
            handlers.resolveMaintenanceExtensionRequestHandler({
                data: extension,
            }),
        ).resolves.toEqual({ success: true })
        expect(services.extension).toHaveBeenCalledWith(extension, clientActor)
        expect(rateLimits.state.counters.size).toBe(4)
    })

    it('rejects the 201st daily mutation after several burst windows', async function () {
        rateLimits.state.runRealLimiter = true
        await forEachSequentially(
            Array.from({ length: 200 }, (_, index) => index),
            async function (index) {
                rateLimits.state.now = Math.floor(index / 30) * 60_001

                await (index % 2 === 0
                    ? handlers.updateCompanyNameHandler({ data: company })
                    : handlers.updateMaintenanceModeHandler({ data: mode }))
            },
        )
        rateLimits.state.now += 60_001
        await expect(
            handlers.resolveMaintenanceExtensionRequestHandler({
                data: extension,
            }),
        ).rejects.toMatchObject({
            name: 'RateLimitError',
            retryAfterSeconds: 85_980,
        })
        expect(services.company).toHaveBeenCalledTimes(100)
        expect(services.mode).toHaveBeenCalledTimes(100)
        expect(services.extension).not.toHaveBeenCalled()
    })

    it('does not charge either read and retains the admin permission guard', async function () {
        const publicResult: unknown = await handlers.getSystemSettingsHandler()
        expect(publicResult).toEqual({ companyName: 'Public' })
        expect(permission).not.toHaveBeenCalled()
        const adminResult: unknown =
            await handlers.getAdminSystemSettingsHandler()
        expect(adminResult).toEqual({ companyName: 'Admin' })
        expect(permission).toHaveBeenCalledTimes(1)
        expect(permission).toHaveBeenCalledWith(
            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        )
        expect(rateLimit).not.toHaveBeenCalled()
        expect(reads.public).toHaveBeenCalledTimes(1)
        expect(reads.admin).toHaveBeenCalledTimes(1)
    })

    it('preserves a domain exception after successful quota admission', async function () {
        const error = new Error('synthetic domain failure')
        services.company.mockRejectedValueOnce(error)
        await expect(
            handlers.updateCompanyNameHandler({ data: company }),
        ).rejects.toBe(error)
        expect(rateLimit).toHaveBeenCalledTimes(2)
    })

    for (const entry of cases) {
        it(
            entry.name +
                ' passes only the server-verified actor after permission validation',
            async function () {
                const result: unknown = await entry.run()
                expect(result).toEqual({ success: true })
                expect(permission).toHaveBeenCalledWith(
                    PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
                )
                expect(entry.service).toHaveBeenCalledWith(entry.data, actor)
                expect(permission.mock.invocationCallOrder[0]).toBeLessThan(
                    entry.service.mock.invocationCallOrder[0] ?? 0,
                )
                if (entry.name === 'logo') {
                    expect(rateLimit).toHaveBeenCalledTimes(3)
                    expect(rateLimit.mock.invocationCallOrder[0]).toBeLessThan(
                        entry.service.mock.invocationCallOrder[0] ?? 0,
                    )
                }
            },
        )
        it(
            entry.name + ' never calls the service when authorization fails',
            async function () {
                permission.mockRejectedValueOnce(new Error('denied'))
                await expect(entry.run()).rejects.toThrow('denied')
                expect(entry.service).not.toHaveBeenCalled()
                expect(rateLimit).not.toHaveBeenCalled()
            },
        )
    }
})
