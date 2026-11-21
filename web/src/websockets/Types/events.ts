import { z } from 'zod'

const permissionKeySchema = z.string().min(1)
const eventTimestampSchema = z.string().min(1)
const notificationSchema = z.object({
    id: z.uuidv7(),
    title: z.string().min(1),
    message: z.string().min(1),
    type: z.string().min(1),
    referenceId: z.uuidv7().nullable(),
    isRead: z.boolean(),
    readAt: eventTimestampSchema.nullable(),
    createdAt: eventTimestampSchema,
})

const systemSettingsUpdatedPayloadSchema = z.object({
    companyName: z.string().min(1),
    logoSrc: z.string().optional(),
    logoSrc64: z.string().optional(),
    faviconSrc: z.string().optional(),
    isPublicRegistrationEnabled: z.boolean().optional(),
    isMaintenanceModeEnabled: z.boolean().optional(),
    maintenanceStartsAt: z.string().optional(),
    updatedAt: eventTimestampSchema,
})

const maintenanceModeChangedPayloadSchema = z.object({
    isMaintenanceModeEnabled: z.boolean(),
    isMaintenanceModeActive: z.boolean(),
    isMaintenanceModeScheduled: z.boolean(),
    maintenanceStartsAt: z.string().nullable(),
    updatedAt: eventTimestampSchema,
})

const maintenanceExtensionResolvedPayloadSchema = z.object({
    requestId: z.uuid(),
    userId: z.uuidv7(),
    status: z.enum(['approved', 'rejected']),
    maintenanceStartsAt: z.string().nullable(),
    resolvedAt: eventTimestampSchema,
})

const maintenanceExtensionRequestedPayloadSchema = z.object({
    request: z.object({
        id: z.uuid(),
        reason: z.string().min(10).max(500),
        requestedAt: eventTimestampSchema,
        user: z.object({
            id: z.uuidv7(),
            username: z.string().min(1),
        }),
    }),
})

const userUpdatedPayloadSchema = z.object({
    userId: z.uuidv7(),
    username: z.string().min(1),
    previousUsername: z.string().min(1),
    permissionKeys: z.array(permissionKeySchema),
    previousPermissionKeys: z.array(permissionKeySchema),
    addedPermissionKeys: z.array(permissionKeySchema),
    removedPermissionKeys: z.array(permissionKeySchema),
    updatedAt: eventTimestampSchema,
})

const notificationCreatedPayloadSchema = z.object({
    userId: z.uuidv7(),
    notification: notificationSchema,
})

const userAccessRevokedPayloadSchema = z.object({
    userId: z.uuidv7(),
    reason: z.enum(['deleted', 'deactivated']),
    updatedAt: eventTimestampSchema,
})

const sessionRevokedPayloadSchema = z.object({
    userId: z.uuidv7(),
    sessionHash: z.string().regex(/^[a-f\d]{64}$/i),
    revokedAt: eventTimestampSchema,
})

const userSessionsRevokedPayloadSchema = z.object({
    userId: z.uuidv7(),
    revokedAt: eventTimestampSchema,
})

const realtimeReauthenticationRequiredPayloadSchema = z.object({
    reason: z.literal('restore'),
    requestedAt: eventTimestampSchema,
})

const systemRestoreChangedPayloadSchema = z
    .object({
        version: z.literal(1),
        status: z.enum(['running', 'completed', 'failed', 'recovery-required']),
        phase: z.enum([
            'preparing',
            'validating',
            'creating-recovery',
            'replacing-storage',
            'restoring-database',
            'finalizing',
            'rolling-back',
        ]),
        percent: z.number().int().min(0).max(100).nullable(),
        processedBytes: z.number().int().nonnegative().safe(),
        totalBytes: z.number().int().nonnegative().safe(),
        startedAt: eventTimestampSchema,
        updatedAt: eventTimestampSchema,
    })
    .strict()

const auditLogCreatedPayloadSchema = z.object({
    auditLogId: z.uuidv7(),
    createdAt: eventTimestampSchema,
})

const permissionManagementUpdatedPayloadSchema = z.object({
    scope: z.enum(['defaults', 'presets', 'staff-invitations']),
    updatedAt: eventTimestampSchema,
})

export const realtimeEventSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('connection.ready'),
        payload: z.object({ connectedAt: eventTimestampSchema }),
    }),
    z.object({
        type: z.literal('system-settings.updated'),
        payload: systemSettingsUpdatedPayloadSchema,
    }),
    z.object({
        type: z.literal('maintenance-mode.changed'),
        payload: maintenanceModeChangedPayloadSchema,
    }),
    z.object({
        type: z.literal('maintenance-extension.resolved'),
        payload: maintenanceExtensionResolvedPayloadSchema,
    }),
    z.object({
        type: z.literal('maintenance-extension.requested'),
        payload: maintenanceExtensionRequestedPayloadSchema,
    }),
    z.object({
        type: z.literal('user.updated'),
        payload: userUpdatedPayloadSchema,
    }),
    z.object({
        type: z.literal('notification.created'),
        payload: notificationCreatedPayloadSchema,
    }),
    z.object({
        type: z.literal('user.access-revoked'),
        payload: userAccessRevokedPayloadSchema,
    }),
    z.object({
        type: z.literal('session.revoked'),
        payload: sessionRevokedPayloadSchema,
    }),
    z.object({
        type: z.literal('user.sessions-revoked'),
        payload: userSessionsRevokedPayloadSchema,
    }),
    z.object({
        type: z.literal('realtime.reauthentication-required'),
        payload: realtimeReauthenticationRequiredPayloadSchema,
    }),
    z.object({
        type: z.literal('system-restore.changed'),
        payload: systemRestoreChangedPayloadSchema,
    }),
    z.object({
        type: z.literal('admin-user.updated'),
        payload: userUpdatedPayloadSchema,
    }),
    z.object({
        type: z.literal('admin-user.access-revoked'),
        payload: userAccessRevokedPayloadSchema,
    }),
    z.object({
        type: z.literal('admin-permissions.updated'),
        payload: permissionManagementUpdatedPayloadSchema,
    }),
    z.object({
        type: z.literal('audit-log.created'),
        payload: auditLogCreatedPayloadSchema,
    }),
    z.object({
        type: z.literal('admin-backups.changed'),
        payload: z.object({ updatedAt: eventTimestampSchema }).strict(),
    }),
])

export type RealtimeEvent = z.infer<typeof realtimeEventSchema>

export const realtimeEventEnvelopeSchema = z.object({
    topic: z.string(),
    event: realtimeEventSchema,
})

type RealtimeEventByType<Type extends RealtimeEvent['type']> = Extract<
    RealtimeEvent,
    { type: Type }
>

export type SystemSettingsUpdatedEvent =
    RealtimeEventByType<'system-settings.updated'>
export type MaintenanceModeChangedEvent =
    RealtimeEventByType<'maintenance-mode.changed'>
export type MaintenanceExtensionResolvedEvent =
    RealtimeEventByType<'maintenance-extension.resolved'>
export type MaintenanceExtensionRequestedEvent =
    RealtimeEventByType<'maintenance-extension.requested'>
export type UserUpdatedEvent = RealtimeEventByType<'user.updated'>
export type NotificationCreatedEvent =
    RealtimeEventByType<'notification.created'>
export type UserAccessRevokedEvent = RealtimeEventByType<'user.access-revoked'>
export type SessionRevokedEvent = RealtimeEventByType<'session.revoked'>
export type UserSessionsRevokedEvent =
    RealtimeEventByType<'user.sessions-revoked'>
export type RealtimeReauthenticationRequiredEvent =
    RealtimeEventByType<'realtime.reauthentication-required'>
export type SystemRestoreChangedEvent =
    RealtimeEventByType<'system-restore.changed'>
export type AdminUserUpdatedEvent = RealtimeEventByType<'admin-user.updated'>
export type AdminUserAccessRevokedEvent =
    RealtimeEventByType<'admin-user.access-revoked'>
export type AdminPermissionsUpdatedEvent =
    RealtimeEventByType<'admin-permissions.updated'>
export type AuditLogCreatedEvent = RealtimeEventByType<'audit-log.created'>
