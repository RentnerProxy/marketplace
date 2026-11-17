import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import {
    SYSTEM_SETTINGS_ACTOR_ID,
    SYSTEM_SETTINGS_REVOCATIONS,
    installSystemSettingsTestMocks,
    maintenanceRequest,
    resetSystemSettingsTestState,
    revokeSystemSettingsActor,
    systemSettingsDb,
    systemSettingsExternal,
} from '@/tests/server/Admin/SystemSettings/update.test.helpers.ts'
import type { SystemSettingsTestHandlerContext } from '@/tests/server/Admin/SystemSettings/update.test.types.ts'

installSystemSettingsTestMocks()

const permission = vi.fn(async function (_key: string) {
    const actor = systemSettingsDb.state.rows.users.find(
        (user) => user.id === SYSTEM_SETTINGS_ACTOR_ID,
    )
    expect(actor?.isActive).toBe(true)
    expect(actor?.isDeleted).toBe(false)
    expect(
        systemSettingsDb.state.rows.staffUserPermissions.some(
            (entry) =>
                entry.userId === SYSTEM_SETTINGS_ACTOR_ID &&
                entry.permissionId ===
                    'permission:' + PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        ),
    ).toBe(true)
    return { userId: SYSTEM_SETTINGS_ACTOR_ID }
})
const rateLimit = vi.fn(async function () {})

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => ({
        handler: (run: () => Promise<unknown>) => run,
        validator: (parse: (input: unknown) => unknown) => ({
            handler:
                (
                    run: (
                        context: SystemSettingsTestHandlerContext,
                    ) => Promise<unknown>,
                ) =>
                async (input: SystemSettingsTestHandlerContext) =>
                    run({ data: parse(input.data) }),
        }),
    }),
}))
vi.mock('@/server/Auth/authorization.service.ts', () => ({
    requirePermissionService: permission,
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: rateLimit,
}))

const handlers = await import('@/features/Admin/SystemSettings/middleware.ts')
const mutations = [
    {
        name: 'company',
        run: () =>
            handlers.updateCompanyNameHandler({
                data: { companyName: 'Synthetic company' },
            }),
    },
    {
        name: 'logo',
        run: () =>
            handlers.updateSystemLogoHandler({
                data: {
                    imageDataUrl: 'data:image/png;base64,AAAA',
                    crop: { x: 0, y: 0, width: 8, height: 8 },
                },
            }),
    },
    {
        name: 'mode',
        run: () =>
            handlers.updateMaintenanceModeHandler({
                data: { isEnabled: false },
            }),
    },
    {
        name: 'extension',
        run: () =>
            handlers.resolveMaintenanceExtensionRequestHandler({
                data: {
                    requestId: maintenanceRequest().id,
                    status: 'rejected',
                },
            }),
    },
]

describe('system settings handlers recheck their actor at mutation time', function () {
    beforeEach(function () {
        resetSystemSettingsTestState()
        rateLimit.mockReset()
        rateLimit.mockImplementation(async function () {})
        const request = maintenanceRequest()
        systemSettingsExternal.getRequest.mockResolvedValue(request)
        systemSettingsExternal.clearRequest.mockResolvedValue(request)
    })

    it.each(
        mutations.flatMap((mutation) =>
            SYSTEM_SETTINGS_REVOCATIONS.map((revocation) => ({
                mutation,
                revocation,
            })),
        ),
    )(
        'rejects $mutation.name after $revocation changes during the quota await',
        async function ({ mutation, revocation }) {
            const before = structuredClone(
                systemSettingsDb.state.rows.systemSettings,
            )
            rateLimit.mockImplementationOnce(async function () {
                revokeSystemSettingsActor(revocation)
            })
            await expect(mutation.run()).rejects.toBeInstanceOf(
                PermissionDeniedError,
            )
            expect(permission).toHaveBeenCalledTimes(1)
            expect(permission).toHaveBeenCalledWith(
                PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
            )
            expect(rateLimit).toHaveBeenCalledTimes(
                mutation.name === 'logo' ? 3 : 2,
            )
            expect(systemSettingsDb.state.rows.systemSettings).toEqual(before)
            expect(systemSettingsDb.state.rows.auditLogs).toHaveLength(0)
            expect(
                systemSettingsDb.state.events.some(
                    (event) =>
                        event.operation === 'lock:update' &&
                        event.table === 'users' &&
                        event.ids?.includes(SYSTEM_SETTINGS_ACTOR_ID),
                ),
            ).toBe(true)
            expect(
                systemSettingsDb.state.events.filter((event) =>
                    ['insert', 'update', 'delete'].includes(event.operation),
                ),
            ).toHaveLength(0)
            expect(systemSettingsExternal.clearRequest).not.toHaveBeenCalled()
            expect(systemSettingsExternal.setRequest).not.toHaveBeenCalled()
            expect(
                systemSettingsExternal.publishBranding,
            ).not.toHaveBeenCalled()
            expect(systemSettingsExternal.publishAudit).not.toHaveBeenCalled()
            expect(
                systemSettingsExternal.publishSettings,
            ).not.toHaveBeenCalled()
            expect(systemSettingsExternal.publishState).not.toHaveBeenCalled()
            expect(
                systemSettingsExternal.publishResolution,
            ).not.toHaveBeenCalled()
        },
    )
})
