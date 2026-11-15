import { describe, expect, it } from 'bun:test'
import { DATABASE_ROLE_POLICY } from '@/config/database-role-policy.config.ts'
import type { DatabaseRolePolicyRow } from '@/server/Runtime/Types/database-role-policy.types.ts'
import {
    databaseRolePolicyRowsSchema,
    hasRequiredDatabaseRolePolicyService,
} from '@/server/Runtime/database-role-policy.validation.ts'

function role(
    overrides: Partial<DatabaseRolePolicyRow> = {},
): DatabaseRolePolicyRow {
    return {
        currentRoleId: '16384',
        sessionRoleId: '16384',
        databaseOwnerId: '16384',
        roleId: '16384',
        roleName: 'marketplace_runtime',
        canLogin: true,
        isSuperuser: false,
        canCreateDatabase: false,
        canCreateRole: false,
        canReplicate: false,
        canBypassRls: false,
        ownsOtherDatabase: false,
        ...overrides,
    }
}

function accepts(value: unknown) {
    const parsed = databaseRolePolicyRowsSchema.safeParse(value)
    return parsed.success && hasRequiredDatabaseRolePolicyService(parsed.data)
}

function administrator(
    overrides: Partial<DatabaseRolePolicyRow> = {},
): DatabaseRolePolicyRow {
    return role({
        currentRoleId: '10',
        sessionRoleId: '10',
        databaseOwnerId: '10',
        roleId: '10',
        roleName: 'postgres',
        isSuperuser: true,
        canCreateDatabase: true,
        canCreateRole: true,
        canReplicate: true,
        canBypassRls: true,
        ownsOtherDatabase: true,
        ...overrides,
    })
}

describe('Database role policy validation', function () {
    it('accepts a directly authenticated administrator for new and previously provisioned databases', function () {
        expect(accepts([administrator()])).toBe(true)
        expect(accepts([administrator({ databaseOwnerId: '16384' })])).toBe(
            true,
        )
    })

    it('accepts administrator memberships regardless of catalog ordering', function () {
        expect(
            accepts([
                administrator({
                    roleId: '17000',
                    roleName: 'pg_read_server_files',
                    canLogin: false,
                    isSuperuser: false,
                }),
                administrator(),
            ]),
        ).toBe(true)
    })

    it('does not grant the administrator exception to switched roles or non-login roles', function () {
        expect(accepts([administrator({ sessionRoleId: '16384' })])).toBe(false)
        expect(accepts([administrator({ canLogin: false })])).toBe(false)
    })

    it('rejects administrator results with inconsistent or duplicate identities', function () {
        expect(
            accepts([
                administrator(),
                administrator({ roleName: 'duplicate_id' }),
            ]),
        ).toBe(false)
        expect(
            accepts([administrator(), administrator({ roleId: '17000' })]),
        ).toBe(false)
        expect(
            accepts([
                administrator(),
                administrator({
                    roleId: '17000',
                    roleName: 'group',
                    databaseOwnerId: '18000',
                }),
            ]),
        ).toBe(false)
    })

    it('rejects an indirect superuser membership for an ordinary login role', function () {
        expect(
            accepts([
                role(),
                role({
                    roleId: '10',
                    roleName: 'postgres',
                    isSuperuser: true,
                }),
            ]),
        ).toBe(false)
    })

    it('accepts one dedicated login and database owner without global privileges', function () {
        expect(accepts([role()])).toBe(true)
        expect(accepts([role({ roleName: 'deployment-specific owner' })])).toBe(
            true,
        )
    })

    it('accepts harmless group memberships and the implicit database-owner role', function () {
        expect(
            accepts([
                role(),
                role({
                    roleId: '16400',
                    roleName: 'application_readers',
                    canLogin: false,
                }),
                role({
                    roleId: '6171',
                    roleName: 'pg_database_owner',
                    canLogin: false,
                }),
            ]),
        ).toBe(true)
    })

    it('does not depend on catalog result ordering', function () {
        expect(
            accepts([
                role({
                    roleId: '6171',
                    roleName: 'pg_database_owner',
                    canLogin: false,
                }),
                role(),
            ]),
        ).toBe(true)
    })

    it.each([
        'canCreateDatabase',
        'canCreateRole',
        'canReplicate',
        'canBypassRls',
        'ownsOtherDatabase',
    ] as const)(
        'rejects %s on both the login role and any reachable ancestor',
        function (privilege) {
            expect(accepts([role({ [privilege]: true })])).toBe(false)
            expect(
                accepts([
                    role(),
                    role({
                        roleId: '17000',
                        roleName: 'indirect_ancestor',
                        canLogin: false,
                        [privilege]: true,
                    }),
                ]),
            ).toBe(false)
        },
    )

    it.each([
        'pg_read_server_files',
        'pg_write_server_files',
        'pg_execute_server_program',
        'pg_read_all_data',
        'pg_write_all_data',
        'pg_monitor',
        'pg_read_all_settings',
        'pg_read_all_stats',
        'pg_stat_scan_tables',
        'pg_signal_backend',
        'pg_checkpoint',
        'pg_create_subscription',
        'pg_maintain',
        'pg_use_reserved_connections',
        'pg_future_privilege',
    ])(
        'rejects reachable system role %s even if all attribute flags are false',
        function (roleName) {
            expect(
                accepts([
                    role(),
                    role({ roleId: '17000', roleName, canLogin: false }),
                ]),
            ).toBe(false)
        },
    )

    it('rejects a switched current role even when the login and current roles are harmless', function () {
        expect(
            accepts([
                role({ currentRoleId: '17000', databaseOwnerId: '17000' }),
                role({
                    currentRoleId: '17000',
                    databaseOwnerId: '17000',
                    roleId: '17000',
                    roleName: 'switched',
                }),
            ]),
        ).toBe(false)
    })

    it('requires actual current database ownership and the login owner row', function () {
        expect(accepts([role({ databaseOwnerId: '17000' })])).toBe(false)
        expect(accepts([role({ canLogin: false })])).toBe(false)
        expect(
            accepts([role({ roleId: '17000', roleName: 'only_group' })]),
        ).toBe(false)
    })

    it.each(['currentRoleId', 'sessionRoleId', 'databaseOwnerId'] as const)(
        'rejects inconsistent %s across result rows',
        function (contextKey) {
            expect(
                accepts([
                    role(),
                    role({
                        roleId: '17000',
                        roleName: 'group',
                        [contextKey]: '18000',
                    }),
                ]),
            ).toBe(false)
        },
    )

    it('rejects duplicate role IDs and names instead of accepting ambiguous metadata', function () {
        expect(accepts([role(), role({ roleName: 'duplicate_id' })])).toBe(
            false,
        )
        expect(accepts([role(), role({ roleId: '17000' })])).toBe(false)
    })

    it('accepts exactly the role limit and fails closed when the graph exceeds it', function () {
        const roles = Array.from(
            { length: DATABASE_ROLE_POLICY.maximumRoles },
            (_, index) =>
                role({
                    roleId: String(16384 + index),
                    roleName: `application_role_${index}`,
                }),
        )
        expect(accepts(roles)).toBe(true)
        expect(
            accepts([...roles, role({ roleId: '19000', roleName: 'excess' })]),
        ).toBe(false)
    })

    it('rejects missing or malformed result containers', function () {
        for (const value of [
            undefined,
            null,
            {},
            false,
            'rows',
            [],
            [null],
            [false],
            [{}],
            [[role()]],
        ]) {
            expect(accepts(value)).toBe(false)
        }
    })

    it('requires every column and rejects extra columns', function () {
        const validRow = role()
        for (const key of Object.keys(validRow)) {
            const partialRow: Record<string, unknown> = { ...validRow }
            delete partialRow[key]
            expect(accepts([partialRow])).toBe(false)
        }
        expect(accepts([{ ...validRow, unrelated: 'unexpected' }])).toBe(false)
    })

    it.each([
        '',
        '0',
        '01',
        '-1',
        '+1',
        ' 1',
        '1 ',
        '1\n',
        '1\r',
        '1\r\n',
        '1\t',
        '1.0',
        '1e3',
        '0x10',
        '4294967296',
        '9999999999',
        '12345678901',
        16384,
        16384n,
        null,
        undefined,
    ])(
        'rejects noncanonical or out-of-range OID %s in every OID column',
        function (invalidOid) {
            for (const key of [
                'currentRoleId',
                'sessionRoleId',
                'databaseOwnerId',
                'roleId',
            ]) {
                expect(accepts([{ ...role(), [key]: invalidOid }])).toBe(false)
            }
        },
    )

    it('accepts exact positive uint32 OID boundaries', function () {
        for (const roleId of ['1', '4294967295']) {
            expect(
                accepts([
                    role({
                        currentRoleId: roleId,
                        sessionRoleId: roleId,
                        databaseOwnerId: roleId,
                        roleId,
                    }),
                ]),
            ).toBe(true)
        }
    })

    it.each(['true', 'false', 0, 1, null, undefined, {}])(
        'does not coerce PostgreSQL booleans from %j',
        function (value) {
            for (const key of [
                'canLogin',
                'isSuperuser',
                'canCreateDatabase',
                'canCreateRole',
                'canReplicate',
                'canBypassRls',
                'ownsOtherDatabase',
            ]) {
                expect(accepts([{ ...role(), [key]: value }])).toBe(false)
            }
        },
    )

    it('validates the actual PostgreSQL identifier byte bound and forbids NUL', function () {
        expect(accepts([role({ roleName: 'a'.repeat(63) })])).toBe(true)
        expect(accepts([role({ roleName: 'a'.repeat(64) })])).toBe(false)
        expect(accepts([role({ roleName: 'ä'.repeat(31) })])).toBe(true)
        expect(accepts([role({ roleName: 'ä'.repeat(32) })])).toBe(false)
        expect(accepts([role({ roleName: '' })])).toBe(false)
        expect(accepts([role({ roleName: 'runtime\0hidden' })])).toBe(false)
    })
})
