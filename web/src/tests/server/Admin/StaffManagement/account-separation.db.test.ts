import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'bun:test'
import { eq, inArray, like } from 'drizzle-orm'
import { db } from '@/db'
import {
    permissions,
    publicAccounts,
    publicUserPermissions,
    staffAccounts,
    staffInvitations,
    staffUserPermissions,
    sessions,
    user_profiles,
    users,
} from '@/db/schema.ts'
import {
    DEFAULT_PUBLIC_PERMISSION_KEYS,
    PERMISSIONS,
} from '@/config/permissions.config.ts'
import type { AuthMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'

const sendInvitation = vi.fn(async (_input: AuthMailInput) => {})
const writeAudit = vi.fn(async () => ({
    id: Bun.randomUUIDv7(),
    createdAt: new Date(),
}))
vi.mock('@/server/Queues/mail.queue.ts', () => ({
    enqueuePasswordSetupMail: sendInvitation,
}))
vi.mock('@/lib/AuditLogs/auditLogs.ts', () => ({
    prepareAuditContextService: (actorUserId: string | null) => ({
        actorUserId,
    }),
    publishCommittedAuditLogService: vi.fn(async () => {}),
    writeAuditLogInTransactionService: writeAudit,
}))
vi.mock('@/server/Realtime/publish.service.ts', () => ({
    publishUserUpdatedService: vi.fn(async () => {}),
    publishUserAccountConvertedService: vi.fn(async () => {}),
    publishUserSessionsRevokedService: vi.fn(async () => {}),
    publishNotificationCreatedService: vi.fn(async () => {}),
    publishPermissionManagementUpdatedService: vi.fn(async () => {}),
}))

const { getStaffInvitationsService, inviteStaffService } =
    await import('@/server/Admin/StaffManagement/invitations.service.ts')
const { manageStaffInvitationService } =
    await import('@/server/Admin/StaffManagement/manageInvitation.service.ts')
const { convertAccountTypeService } =
    await import('@/server/Admin/UserManagement/accountConversion.service.ts')
const { acceptStaffInvitationService } =
    await import('@/server/Auth/StaffInvitation/accept.service.ts')
const { createPublicAccountInTransactionService } =
    await import('@/server/Auth/Registration/account.service.ts')
const { replaceManagedUserPermissionsService } =
    await import('@/server/Admin/PermissionManagement/managed-user-permissions.service.ts')
const { getPermissionManagementUsersService } =
    await import('@/server/Admin/PermissionManagement/users.service.ts')
const { getUsersService } =
    await import('@/server/Admin/UserManagement/get.service.ts')

const runPrefix = `split-${crypto.randomUUID().slice(0, 8)}-`
const password = 'synthetic-staff-password'
const permissionIds = new Map<string, string>()
const insertedPermissionIds: Array<string> = []
let superUserId: string
let moderatorId: string

function permissionId(key: string) {
    const id = permissionIds.get(key)
    if (!id) throw new Error(`Missing test permission ${key}`)
    return id
}

function identity(suffix: string) {
    return {
        username: runPrefix + suffix,
        email: `${runPrefix}${suffix}@example.test`,
    }
}

function inviteInput(suffix: string) {
    return {
        ...identity(suffix),
        permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
    }
}

async function createStaffFixture(suffix: string, ...keys: Array<string>) {
    const userId = Bun.randomUUIDv7()
    await db.transaction(async (tx) => {
        await tx.insert(users).values({
            ...identity(suffix),
            id: userId,
            accountType: 'staff',
            passwordHash: 'fixture',
        })
        await tx.insert(staffAccounts).values({ userId })
        await tx.insert(staffUserPermissions).values(
            keys.map((key) => ({
                userId,
                permissionId: permissionId(key),
            })),
        )
    })
    return userId
}

function getInvitationToken() {
    const payload = sendInvitation.mock.lastCall?.[0]
    if (!payload) throw new Error('Expected a queued staff invitation')
    const link = new URL(payload.resetLink)
    expect(link.pathname).toBe('/staff-invitation')
    expect(link.search).toBe('')
    expect(link.hash).toMatch(/^#invite=[A-Za-z0-9_-]{43}$/u)
    return link.hash.slice(8)
}

beforeAll(async () => {
    const keys = [
        PERMISSIONS.ADMIN_SUPER_USER,
        PERMISSIONS.ADMIN_DASHBOARD,
        PERMISSIONS.ADMIN_USER_MANAGEMENT,
        PERMISSIONS.ADMIN_ACCOUNT_CONVERSION,
        PERMISSIONS.USER_DASHBOARD,
    ]
    const added = await db
        .insert(permissions)
        .values(
            keys.map((key) => ({
                key,
                name: key,
                description: 'synthetic fixture',
            })),
        )
        .onConflictDoNothing()
        .returning({ id: permissions.id })
    insertedPermissionIds.push(...added.map(({ id }) => id))
    const catalog = await db
        .select()
        .from(permissions)
        .where(inArray(permissions.key, keys))
    for (const { id, key } of catalog) permissionIds.set(key, id)
    superUserId = await createStaffFixture(
        'owner',
        PERMISSIONS.ADMIN_SUPER_USER,
        PERMISSIONS.ADMIN_ACCOUNT_CONVERSION,
    )
    moderatorId = await createStaffFixture(
        'moderator',
        PERMISSIONS.ADMIN_USER_MANAGEMENT,
    )
})

beforeEach(() => {
    vi.clearAllMocks()
})

afterAll(async () => {
    await db
        .delete(staffInvitations)
        .where(like(staffInvitations.username, runPrefix + '%'))
    await db.delete(users).where(like(users.username, runPrefix + '%'))
    if (insertedPermissionIds.length > 0)
        await db
            .delete(permissions)
            .where(inArray(permissions.id, insertedPermissionIds))
})

describe('public and staff account separation in PostgreSQL', () => {
    it('uses the configured registration permissions and blocks cross-scope assignments', async () => {
        const registered = await db.transaction((tx) =>
            createPublicAccountInTransactionService(tx, {
                ...identity('public'),
                passwordHash: 'fixture',
            }),
        )
        if (!registered) throw new Error('Expected a public account')
        expect(await getUserPermissionKeys(registered.userId)).toEqual([
            ...DEFAULT_PUBLIC_PERMISSION_KEYS,
        ])
        await expect(
            db
                .insert(staffAccounts)
                .values({ userId: registered.userId })
                .execute(),
        ).rejects.toThrow()
        await expect(
            db.insert(publicAccounts).values({ userId: superUserId }).execute(),
        ).rejects.toThrow()
        await expect(
            db
                .insert(staffUserPermissions)
                .values({
                    userId: registered.userId,
                    permissionId: permissionId(PERMISSIONS.ADMIN_DASHBOARD),
                })
                .execute(),
        ).rejects.toThrow()
        await expect(
            db
                .insert(publicUserPermissions)
                .values({
                    userId: registered.userId,
                    permissionId: permissionId(PERMISSIONS.ADMIN_DASHBOARD),
                })
                .execute(),
        ).rejects.toThrow()
        await expect(
            replaceManagedUserPermissionsService(
                {
                    userId: registered.userId,
                    permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
                },
                superUserId,
            ),
        ).resolves.toMatchObject({ success: false })
        const publicList = await getUsersService('public', moderatorId)
        expect(publicList.map(({ id }) => id)).toContain(registered.userId)
        expect(publicList.map(({ id }) => id)).not.toContain(superUserId)
        expect(
            publicList.find(({ id }) => id === registered.userId),
        ).not.toHaveProperty('passwordHash')
        const staffList = await getPermissionManagementUsersService(superUserId)
        expect(staffList.map(({ id }) => id)).not.toContain(registered.userId)
        expect(staffList.map(({ id }) => id)).toContain(superUserId)
    })

    it('reserves an invited identity, stores a hash, and consumes the token once with explicit staff permissions', async () => {
        const input = inviteInput('invited')
        await expect(inviteStaffService(input, moderatorId)).rejects.toThrow()
        expect(sendInvitation).not.toHaveBeenCalled()
        await expect(inviteStaffService(input, superUserId)).resolves.toEqual({
            success: true,
        })
        const token = getInvitationToken()
        const [invitation] = await db
            .select()
            .from(staffInvitations)
            .where(eq(staffInvitations.email, input.email))
        expect(invitation.tokenHash).toBe(await createTokenHash(token))
        expect(invitation.tokenHash).not.toBe(token)
        expect(
            await db.select().from(users).where(eq(users.email, input.email)),
        ).toEqual([])
        await expect(
            db.transaction((tx) =>
                createPublicAccountInTransactionService(tx, {
                    ...input,
                    email: input.email.toUpperCase(),
                    passwordHash: 'fixture',
                }),
            ),
        ).resolves.toBeNull()
        await expect(inviteStaffService(input, superUserId)).resolves.toEqual({
            success: false,
            error: 'invitationExists',
        })

        const accepted = await Promise.all([
            acceptStaffInvitationService({ token, password }),
            acceptStaffInvitationService({ token, password }),
        ])
        expect(accepted.filter((result) => result.success)).toHaveLength(1)
        const [account] = await db
            .select()
            .from(users)
            .where(eq(users.email, input.email))
        expect(account.accountType).toBe('staff')
        expect(await Bun.password.verify(password, account.passwordHash)).toBe(
            true,
        )
        expect(await getUserPermissionKeys(account.id)).toEqual([
            PERMISSIONS.ADMIN_DASHBOARD,
        ])
        expect(
            await db
                .select()
                .from(staffInvitations)
                .where(eq(staffInvitations.email, input.email)),
        ).toEqual([])
    })

    it('rejects revoked and expired tokens and cleans up a failed mail enqueue', async () => {
        const input = inviteInput('retry')
        sendInvitation.mockRejectedValueOnce(
            new Error('isolated queue failure'),
        )
        await expect(inviteStaffService(input, superUserId)).resolves.toEqual({
            success: false,
            error: 'deliveryFailed',
        })
        expect(
            await db
                .select()
                .from(staffInvitations)
                .where(eq(staffInvitations.email, input.email)),
        ).toEqual([])

        await inviteStaffService(input, superUserId)
        const token = getInvitationToken()
        const [invitation] = await db
            .select()
            .from(staffInvitations)
            .where(eq(staffInvitations.email, input.email))
        await manageStaffInvitationService(
            { id: invitation.id, action: 'revoke' },
            superUserId,
        )
        await expect(
            acceptStaffInvitationService({ token, password }),
        ).resolves.toEqual({ success: false })

        await inviteStaffService(input, superUserId)
        const expired = getInvitationToken()
        await db
            .update(staffInvitations)
            .set({ expiresAt: new Date(0) })
            .where(eq(staffInvitations.email, input.email))
        await expect(
            acceptStaffInvitationService({ token: expired, password }),
        ).resolves.toEqual({ success: false })
        expect(
            await db.select().from(users).where(eq(users.email, input.email)),
        ).toEqual([])
    })

    it('releases a disabled reservation and blocks reactivation after the identity is registered', async () => {
        const input = inviteInput('disabled-reservation')
        await expect(inviteStaffService(input, superUserId)).resolves.toEqual({
            success: true,
        })
        const [invitation] = await db
            .select()
            .from(staffInvitations)
            .where(eq(staffInvitations.email, input.email))
        const action = { id: invitation.id, action: 'setActive' as const }
        await expect(
            manageStaffInvitationService(
                { ...action, isActive: false },
                superUserId,
            ),
        ).resolves.toEqual({ success: true })
        await expect(
            db.transaction((tx) =>
                createPublicAccountInTransactionService(tx, {
                    ...input,
                    passwordHash: 'fixture',
                }),
            ),
        ).resolves.toMatchObject({ userId: expect.any(String) })
        await expect(
            manageStaffInvitationService(
                { ...action, isActive: true },
                superUserId,
            ),
        ).resolves.toEqual({ success: false, error: 'identityInUse' })
    })

    it('moves accounts across scopes atomically and revokes sessions, including on superuser demotion', async () => {
        const converter = await createStaffFixture(
            'converter',
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
            PERMISSIONS.ADMIN_ACCOUNT_CONVERSION,
        )
        const registered = await db.transaction((tx) =>
            createPublicAccountInTransactionService(tx, {
                ...identity('convert'),
                passwordHash: 'fixture',
            }),
        )
        if (!registered) throw new Error('Expected a public account')
        const id = registered.userId
        const promotion = { id, accountType: 'public' as const }
        await db
            .update(user_profiles)
            .set({ firstName: 'Test profile' })
            .where(eq(user_profiles.userId, id))
        await db.insert(sessions).values({
            id: crypto.randomUUID(),
            userId: id,
            expiresAt: new Date(Date.now() + 60_000),
        })
        await expect(
            convertAccountTypeService(promotion, moderatorId),
        ).rejects.toThrow()
        writeAudit.mockRejectedValueOnce(new Error('Injected audit failure'))
        await expect(
            convertAccountTypeService(promotion, converter),
        ).rejects.toThrow('Injected audit failure')
        expect(
            await db
                .select()
                .from(publicAccounts)
                .where(eq(publicAccounts.userId, id)),
        ).toHaveLength(1)
        expect(
            await db.select().from(sessions).where(eq(sessions.userId, id)),
        ).toHaveLength(1)

        await expect(
            convertAccountTypeService(promotion, converter),
        ).resolves.toEqual({ success: true })
        await expect(
            convertAccountTypeService(promotion, converter),
        ).resolves.toEqual({ success: false, error: 'notFound' })
        expect(
            await db
                .select()
                .from(publicAccounts)
                .where(eq(publicAccounts.userId, id)),
        ).toEqual([])
        expect(
            await db
                .select()
                .from(staffAccounts)
                .where(eq(staffAccounts.userId, id)),
        ).toHaveLength(1)
        expect(
            await db.select().from(sessions).where(eq(sessions.userId, id)),
        ).toEqual([])
        expect(
            await db
                .select()
                .from(user_profiles)
                .where(eq(user_profiles.userId, id)),
        ).toMatchObject([{ firstName: 'Test profile' }])
        expect(await getUserPermissionKeys(id)).toEqual([
            ...DEFAULT_PUBLIC_PERMISSION_KEYS,
        ])

        const otherSuperUser = await createStaffFixture(
            'other-owner',
            PERMISSIONS.ADMIN_SUPER_USER,
            PERMISSIONS.ADMIN_DASHBOARD,
        )
        const demotion = { id: otherSuperUser, accountType: 'staff' as const }
        await expect(
            convertAccountTypeService(demotion, converter),
        ).rejects.toThrow()
        await expect(
            convertAccountTypeService(
                { ...demotion, id: superUserId.toUpperCase() },
                superUserId,
            ),
        ).resolves.toEqual({ success: false, error: 'self' })

        const invitationInput = inviteInput('from-other-owner')
        await expect(
            inviteStaffService(invitationInput, otherSuperUser),
        ).resolves.toEqual({ success: true })
        const oldToken = getInvitationToken()
        await expect(
            convertAccountTypeService(demotion, superUserId),
        ).resolves.toEqual({ success: true })
        expect(await getUserPermissionKeys(otherSuperUser)).toEqual([
            ...DEFAULT_PUBLIC_PERMISSION_KEYS,
        ])
        expect(await getStaffInvitationsService(superUserId)).toContainEqual(
            expect.objectContaining({
                email: invitationInput.email,
                status: 'disabled',
            }),
        )
        expect(
            await db
                .select()
                .from(staffInvitations)
                .where(eq(staffInvitations.email, invitationInput.email)),
        ).toMatchObject([{ invitedByUserId: null, isActive: false }])
        await expect(
            acceptStaffInvitationService({ token: oldToken, password }),
        ).resolves.toEqual({ success: false })
    })
})
