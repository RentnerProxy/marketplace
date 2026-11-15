import { SQL } from 'bun'
import { DATABASE_ROLE_POLICY } from '@/config/database-role-policy.config.ts'
import { databaseUrlSchema } from './database-environment.service.ts'
import {
    databaseRolePolicyRowsSchema,
    hasRequiredDatabaseRolePolicyService,
} from './database-role-policy.validation.ts'

const rolePolicyQuery = `
WITH RECURSIVE reachable_roles(role_oid) AS (
    SELECT role.oid
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname OPERATOR(pg_catalog.=) CURRENT_USER
       OR role.rolname OPERATOR(pg_catalog.=) SESSION_USER
    UNION
    SELECT membership.roleid
    FROM pg_catalog.pg_auth_members AS membership
    JOIN reachable_roles AS reachable
      ON membership.member OPERATOR(pg_catalog.=) reachable.role_oid
), role_context AS (
    SELECT active_role.oid AS current_role_oid,
           session_role.oid AS session_role_oid,
           database.datdba AS database_owner_oid,
           database.oid AS database_oid
    FROM pg_catalog.pg_roles AS active_role
    CROSS JOIN pg_catalog.pg_roles AS session_role
    CROSS JOIN pg_catalog.pg_database AS database
    WHERE active_role.rolname OPERATOR(pg_catalog.=) CURRENT_USER
      AND session_role.rolname OPERATOR(pg_catalog.=) SESSION_USER
      AND database.datname OPERATOR(pg_catalog.=) pg_catalog.current_database()
)
SELECT context.current_role_oid::pg_catalog.text AS "currentRoleId",
       context.session_role_oid::pg_catalog.text AS "sessionRoleId",
       context.database_owner_oid::pg_catalog.text AS "databaseOwnerId",
       role.oid::pg_catalog.text AS "roleId",
       role.rolname::pg_catalog.text AS "roleName",
       role.rolcanlogin AS "canLogin",
       role.rolsuper AS "isSuperuser",
       role.rolcreatedb AS "canCreateDatabase",
       role.rolcreaterole AS "canCreateRole",
       role.rolreplication AS "canReplicate",
       role.rolbypassrls AS "canBypassRls",
       EXISTS (
           SELECT 1
           FROM pg_catalog.pg_database AS other_database
           WHERE other_database.datdba OPERATOR(pg_catalog.=) role.oid
             AND other_database.oid OPERATOR(pg_catalog.<>) context.database_oid
       ) AS "ownsOtherDatabase"
FROM reachable_roles AS reachable
JOIN pg_catalog.pg_roles AS role
  ON role.oid OPERATOR(pg_catalog.=) reachable.role_oid
CROSS JOIN role_context AS context
ORDER BY role.oid
LIMIT ${DATABASE_ROLE_POLICY.maximumRoles + 1}
`

function createRolePolicyError() {
    const error = new Error(DATABASE_ROLE_POLICY.errorMessage)
    error.name = 'DatabaseRolePolicyError'
    Object.defineProperty(error, 'code', {
        value: DATABASE_ROLE_POLICY.errorCode,
        enumerable: true,
    })
    return error
}

async function waitForRolePolicyDeadlineService<T>(
    operation: Promise<T>,
    timeoutMs: number,
    onTimeout?: () => void,
): Promise<T> {
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            operation,
            new Promise<never>(function (_resolve, reject) {
                deadline = setTimeout(function () {
                    reject(createRolePolicyError())
                    try {
                        onTimeout?.()
                    } catch {}
                }, timeoutMs)
            }),
        ])
    } finally {
        if (deadline !== undefined) clearTimeout(deadline)
    }
}

async function closeRolePolicyConnectionService(
    client: SQL,
    queryResult: Promise<unknown> | null,
) {
    const closed = Promise.resolve().then(() => client.close({ timeout: 0 }))
    const drained = queryResult?.then(
        () => undefined,
        () => undefined,
    )
    await waitForRolePolicyDeadlineService(
        Promise.all([closed, drained]),
        DATABASE_ROLE_POLICY.cleanupTimeoutMs,
    )
}

export async function assertRuntimeDatabaseRolePolicyService(
    databaseUrl: string,
): Promise<void> {
    let client: SQL | null = null
    let queryResult: Promise<unknown> | null = null
    try {
        try {
            const validatedUrl = databaseUrlSchema.parse(databaseUrl)
            client = new SQL(validatedUrl, {
                adapter: 'postgres',
                max: 1,
                connectionTimeout:
                    DATABASE_ROLE_POLICY.connectionTimeoutSeconds,
                idleTimeout: DATABASE_ROLE_POLICY.idleTimeoutSeconds,
            })
            const query = client.unsafe<unknown>(rolePolicyQuery)
            queryResult = Promise.resolve(query)
            const result = await waitForRolePolicyDeadlineService(
                queryResult,
                DATABASE_ROLE_POLICY.queryTimeoutMs,
                () => {
                    void query.cancel().catch(() => undefined)
                },
            )
            const rows = databaseRolePolicyRowsSchema.parse(result)
            if (!hasRequiredDatabaseRolePolicyService(rows)) {
                throw createRolePolicyError()
            }
        } finally {
            if (client) {
                await closeRolePolicyConnectionService(client, queryResult)
            }
        }
    } catch {
        throw createRolePolicyError()
    }
}
