import { vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    ADMIN_ACTOR_ID,
    adminAuditDb,
    adminAuditExternal,
    installAdminAuditTestMocks,
} from '../UserManagement/admin-audit.test.helpers.ts'
import type {
    SystemSettingsRevocation,
    SystemSettingsTestEffect,
} from './update.test.types.ts'

export const SYSTEM_SETTINGS_ACTOR_ID = ADMIN_ACTOR_ID
export const systemSettingsDb = adminAuditDb
export const effects: SystemSettingsTestEffect[] = []
function recordEffect(kind: string) {
    effects.push({
        kind,
        activeTransaction: systemSettingsDb.state.activeTransaction,
        actorLocked: systemSettingsDb.state.events.some(
            (event) =>
                event.transaction ===
                    systemSettingsDb.state.activeTransaction &&
                event.operation === 'lock:update' &&
                event.table === 'users' &&
                event.ids?.includes(SYSTEM_SETTINGS_ACTOR_ID),
        ),
        committedAuditActions: systemSettingsDb.state.rows.auditLogs.map(
            (row) => String(row.action),
        ),
    })
}

export const imageMocks = {
    createIco: vi.fn(() => Buffer.from('ico')),
    getBuffer: vi.fn(async () => ({
        buffer: Buffer.from('image'),
        width: 100,
        height: 100,
    })),
    getCrop: vi.fn(() => ({ left: 0, top: 0, width: 100, height: 100 })),
    paths: {
        absoluteDir: 'C:/safe/public/images',
        absoluteLarge: 'C:/safe/public/images/logo.webp',
        absoluteSmall: 'C:/safe/public/images/logo-64.webp',
        absoluteFavicon: 'C:/safe/public/favicon.ico',
        relativeLarge: '/images/logo.webp',
        relativeSmall: '/images/logo-64.webp',
        relativeFavicon: '/favicon.ico',
    },
}
function createImageChain() {
    const chain = {
        extract: vi.fn(),
        resize: vi.fn(),
        webp: vi.fn(),
        png: vi.fn(),

        toBuffer: vi.fn(async function () {
            recordEffect('image-buffer')
            return Buffer.from('png')
        }),
    }
    chain.extract.mockReturnValue(chain)
    chain.resize.mockReturnValue(chain)
    chain.webp.mockReturnValue(chain)
    chain.png.mockReturnValue(chain)
    return chain
}
export const imageInstances: Array<ReturnType<typeof createImageChain>> = []
export const systemSettingsExternal = {
    sharp: vi.fn(function () {
        const chain = createImageChain()
        imageInstances.push(chain)
        return chain
    }),
    publishBranding: vi.fn(async function () {
        recordEffect('branding-files')
    }),
    withShared: vi.fn(async function <Result>(
        operation: () => Promise<Result>,
    ) {
        return operation()
    }),
    publishSettings: vi.fn(async function () {
        recordEffect('publish:settings')
    }),
    publishResolution: vi.fn(async function () {
        recordEffect('publish:resolution')
    }),
    publishState: vi.fn(async function () {
        recordEffect('publish:state')
    }),
    getRequest: vi.fn(async function () {
        return null as Record<string, unknown> | null
    }),
    clearRequest: vi.fn(async function () {
        return null as Record<string, unknown> | null
    }),
    setRequest: vi.fn(async function () {
        return true
    }),
    publishAudit: adminAuditExternal.publishAudit,
    logError: adminAuditExternal.logError,
}

function defaultSystemSettings() {
    return {
        id: 'default',
        companyName: 'Alte Firma',
        isMaintenanceModeEnabled: false,
        maintenanceStartsAt: null as Date | null,
        logoUpdatedAt: null as Date | null,
        updatedAt: new Date('2025-12-01T00:00:00.000Z'),
    }
}
export function maintenanceRequest() {
    return {
        id: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
        username: 'kevin',
        reason: 'Mehr Zeit',
        requestedAt: new Date('2026-01-01T11:55:00.000Z'),
    }
}
export function resetSystemSettingsTestState() {
    vi.clearAllMocks()
    systemSettingsDb.reset()
    systemSettingsDb.state.rows.userPermissions.push({
        userId: SYSTEM_SETTINGS_ACTOR_ID,
        permissionId: 'permission:' + PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
    })
    systemSettingsDb.state.rows.systemSettings = [defaultSystemSettings()]
    effects.length = 0
    imageInstances.length = 0
    systemSettingsExternal.publishAudit.mockImplementation(async function () {
        recordEffect('publish:audit')
    })
    systemSettingsExternal.publishSettings.mockImplementation(
        async function () {
            recordEffect('publish:settings')
        },
    )
    systemSettingsExternal.publishResolution.mockImplementation(
        async function () {
            recordEffect('publish:resolution')
        },
    )
    systemSettingsExternal.publishState.mockImplementation(async function () {
        recordEffect('publish:state')
    })
    systemSettingsExternal.getRequest.mockResolvedValue(null)
    systemSettingsExternal.clearRequest.mockResolvedValue(null)
    systemSettingsExternal.setRequest.mockResolvedValue(true)
}

export function installSystemSettingsTestMocks() {
    installAdminAuditTestMocks()
    vi.mock(
        '@/server/Admin/SystemSettings/branding-storage.service.ts',
        () => ({
            publishSystemBrandingStorageService:
                systemSettingsExternal.publishBranding,
        }),
    )
    vi.mock('sharp', () => ({ default: systemSettingsExternal.sharp }))
    vi.mock('@/lib/Images/imageDataUrl.ts', () => ({
        getImageBufferFromDataUrl: imageMocks.getBuffer,
        getSafeImageCrop: imageMocks.getCrop,
    }))
    vi.mock('@/lib/Images/ico.ts', () => ({
        createIcoFromPngBuffer: imageMocks.createIco,
    }))
    vi.mock('@/lib/Images/publicImagePaths.ts', () => ({
        getSystemLogoPublicImagePaths: () => imageMocks.paths,
    }))
    vi.mock('@/server/Realtime/publish.service.ts', () => ({
        publishAuditLogCreatedService: systemSettingsExternal.publishAudit,
        publishSystemSettingsUpdatedService:
            systemSettingsExternal.publishSettings,
        publishMaintenanceExtensionResolvedService:
            systemSettingsExternal.publishResolution,
    }))
    vi.mock('@/server/Maintenance/requestStore.ts', () => ({
        clearPendingMaintenanceExtensionRequest:
            systemSettingsExternal.clearRequest,
        getPendingMaintenanceExtensionRequest:
            systemSettingsExternal.getRequest,
        setPendingMaintenanceExtensionRequest:
            systemSettingsExternal.setRequest,
    }))
    vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', () => ({
        withSharedStorageMutationBarrier: systemSettingsExternal.withShared,
    }))
    vi.mock('@/server/Admin/SystemSettings/get.service.ts', () => ({
        getVersion: () => 'version-1',
        getPublicSystemSettingsService: async () => defaultSystemSettings(),
        getSystemSettingsService: async () => defaultSystemSettings(),
    }))
    vi.mock('@/server/Maintenance/state.service.ts', () => ({
        publishMaintenanceStateService: systemSettingsExternal.publishState,
    }))
}

export const SYSTEM_SETTINGS_REVOCATIONS = [
    'permission',
    'inactive',
    'deleted',
] as const

export function revokeSystemSettingsActor(
    revocation: SystemSettingsRevocation,
) {
    const actor = systemSettingsDb.state.rows.users.find(
        (user) => user.id === SYSTEM_SETTINGS_ACTOR_ID,
    )
    if (!actor) throw new Error('Synthetic actor is unavailable')
    if (revocation === 'permission') {
        systemSettingsDb.state.rows.userPermissions =
            systemSettingsDb.state.rows.userPermissions.filter(
                (permission) =>
                    permission.userId !== SYSTEM_SETTINGS_ACTOR_ID ||
                    permission.permissionId !==
                        'permission:' + PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
            )
        return
    }
    if (revocation === 'inactive') actor.isActive = false
    else actor.isDeleted = true
}
