import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

const source = await readFile(
    new URL(
        '../../scripts/provision-runtime-database-role.sql',
        import.meta.url,
    ),
    'utf8',
)
const executable = source.replace(/--[^\r\n]*/gu, '')
const preflight = executable.slice(
    executable.indexOf('DO $provision$'),
    executable.indexOf("'CREATE ROLE %I"),
)
const application = executable.slice(executable.indexOf("'CREATE ROLE %I"))

describe('manual runtime role provisioning source policy', function () {
    test('limits provisioning to the centrally configured application schema', function () {
        expect(executable).toContain(
            `application_schema constant text := '${PROJECT_CONFIG.databaseSchema}';`,
        )
        expect(executable).toContain('\\set runtime_role marketplace_runtime')
    })
    test('keeps every ownership operation within one transaction and stops on errors', function () {
        expect(executable).toContain('\\set ON_ERROR_STOP on')
        expect(executable.match(/^BEGIN;$/gmu)).toHaveLength(1)
        expect(executable.match(/^COMMIT;$/gmu)).toHaveLength(1)
        expect(executable.indexOf('BEGIN;')).toBeLessThan(
            executable.indexOf('DO $provision$'),
        )
        expect(executable.indexOf('$provision$;')).toBeLessThan(
            executable.indexOf('COMMIT;'),
        )
        expect(executable).not.toMatch(/\bEXCEPTION\s+WHEN\b/iu)
        expect(preflight).not.toMatch(
            /\b(?:CREATE|ALTER|REVOKE|GRANT)\s+(?:ROLE|DATABASE|SCHEMA|TABLE|SEQUENCE|DEFAULT)\b/iu,
        )
    })

    test('accepts only a quoted role literal and never transports a password or connection URL', function () {
        expect(executable).toContain(
            "pg_catalog.set_config('app.runtime_role', :'runtime_role', true)",
        )
        expect(executable).toContain("runtime_name !~ '^[a-z][a-z0-9_]{0,62}$'")
        expect(executable).toContain("pg_catalog.left(runtime_name, 3) = 'pg_'")
        expect(executable).not.toMatch(
            /PGPASSWORD|DATABASE_URL|conninfo|rolpassword|pg_authid\s+AS/iu,
        )
        expect(executable).not.toMatch(
            /(?:CREATE|ALTER) ROLE[^\r\n]*\bPASSWORD\b/iu,
        )
        expect(executable).not.toMatch(/:(?:runtime_role|provisioning_role)\b/u)
        expect(executable).not.toMatch(
            /\\(?:connect|include|i|password|!|copy)\b/u,
        )
    })

    test('requires a direct bootstrap superuser and an isolated, non-template application database', function () {
        expect(preflight).toContain(
            'r.rolname = session_user AND r.rolsuper AND r.rolcanlogin',
        )
        expect(preflight).toContain('current_user <> session_user')
        expect(preflight).toContain('NOT d.datistemplate AND d.datallowconn')
        expect(preflight).toContain(
            "d.datname NOT IN ('postgres', 'template0', 'template1')",
        )
        expect(preflight).toContain('database_owner <> ALL(owner_oids)')
        expect(preflight).toContain(
            'a.datid = database_oid AND a.pid <> pg_catalog.pg_backend_pid()',
        )
        expect(preflight).toContain('pg_catalog.pg_prepared_xacts')
        expect(preflight).toContain('COALESCE(runtime_oid, 0)')
    })

    test('does not reuse privileged or shared roles and never grants a membership', function () {
        for (const flag of [
            'rolsuper',
            'rolcreatedb',
            'rolcreaterole',
            'rolreplication',
            'rolbypassrls',
        ]) {
            expect(preflight).toContain('r.' + flag)
        }
        expect(preflight).toContain(
            'm.member = runtime_oid OR m.roleid = runtime_oid',
        )
        expect(preflight).toContain('s.setrole = runtime_oid')
        expect(preflight).toContain(
            'd.refobjid = runtime_oid AND d.dbid <> database_oid',
        )
        expect(preflight).toContain('d.objid = database_oid')
        expect(application).toContain(
            'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT',
        )
        expect(executable).not.toMatch(/\bGRANT\s+/u)
    })

    test('refuses custom schemas and objects before ownership can change', function () {
        expect(preflight).toContain("'public', application_schema, 'drizzle'")
        expect(preflight).toContain("c.relkind NOT IN ('r', 'i', 'S')")
        expect(preflight).toContain("c.relpersistence <> 'p'")
        expect(preflight).toContain('c.reltablespace <> 0')
        expect(preflight).toContain(
            "d.oid = database_oid AND t.spcname <> 'pg_default'",
        )
        expect(preflight).toContain('c.relrowsecurity OR c.relforcerowsecurity')
        expect(preflight).toContain("e.extname <> 'plpgsql'")
        expect(preflight).toContain(
            'e.extowner <> administrator_oid OR e.oid >= 16384',
        )
        expect(preflight).toContain(
            "n.nspname IN ('pg_catalog', 'information_schema') AND d.objid >= 16384",
        )
        for (const catalog of [
            'pg_inherits',
            'pg_event_trigger',
            'pg_foreign_server',
            'pg_largeobject_metadata',
            'pg_publication',
            'pg_subscription',
            'pg_statistic_ext',
            'pg_transform',
            'pg_seclabel',
        ]) {
            expect(preflight).toContain('pg_catalog.' + catalog)
        }
        expect(preflight).toContain("t.typtype = 'c'")
        expect(preflight).toContain('c.reltype = t.oid')
        expect(preflight).toContain('e.oid = t.typelem AND e.typarray = t.oid')
    })

    test('refuses column grants and privileges granted to unrelated roles', function () {
        expect(preflight).toContain('a.attacl IS NOT NULL')
        expect(preflight).toContain('d.defaclrole <> ALL(owner_oids)')
        expect(preflight).toContain('pg_catalog.aclexplode(entries.acl)')
        expect(preflight).toContain('a.grantee <> ALL(owner_oids || 0::oid)')
    })

    test('permits only the built-in public schema owner ACL without allowing that role on app objects', function () {
        expect(preflight).toContain(
            'SELECT d.datacl AS acl, false AS public_schema_owner_acl',
        )
        expect(preflight).toContain(
            "SELECT n.nspacl, n.nspname = 'public' AND n.nspowner = 'pg_database_owner'::regrole",
        )
        for (const statement of [
            'SELECT c.relacl, false',
            'SELECT t.typacl, false',
            'SELECT d.defaclacl, false',
        ]) {
            expect(preflight).toContain(statement)
        }
        expect(preflight).toContain('AND NOT (entries.public_schema_owner_acl')
        expect(preflight).toContain(
            "AND a.grantee = 'pg_database_owner'::regrole",
        )
        expect(preflight).toContain(
            "AND a.grantor = 'pg_database_owner'::regrole",
        )
        expect(preflight).toContain(
            "AND a.privilege_type IN ('USAGE', 'CREATE') AND NOT a.is_grantable",
        )
    })

    test('revokes only row-type privileges so dependent array types cannot abort the transaction', function () {
        const typeLoop = application.match(
            /FOR object_row IN\s+SELECT n\.nspname, t\.typname[\s\S]+?END LOOP;/u,
        )?.[0]
        expect(typeLoop).toBeDefined()
        expect(typeLoop).toContain(
            "WHERE n.nspname IN (application_schema, 'drizzle') AND t.typtype = 'c'",
        )
        expect(typeLoop).toContain("'REVOKE ALL ON TYPE %I.%I FROM PUBLIC'")
    })

    test('limits identifier interpolation and avoids cross-database reassignment or deletion', function () {
        expect(application).toContain("'ALTER DATABASE %I OWNER TO %I'")
        expect(application).toContain(
            'pg_catalog.current_database(), runtime_name',
        )
        expect(application).toContain("ARRAY[application_schema, 'drizzle']")
        expect(application).toContain("'ALTER SCHEMA %I OWNER TO %I'")
        expect(application).toContain("'ALTER TABLE %I.%I OWNER TO %I'")
        expect(application).toContain("'ALTER SEQUENCE %I.%I OWNER TO %I'")
        expect(executable).not.toMatch(
            /\b(?:REASSIGN\s+OWNED|DROP\s|ALTER\s+SYSTEM|COPY\s|TRUNCATE\s|DELETE\s+FROM|UPDATE\s+pg_catalog)\b/iu,
        )
        const stringInterpolations = [
            ...executable.matchAll(/'([^'\r\n]*%s[^'\r\n]*)'/gu),
        ]
        expect(stringInterpolations).toHaveLength(2)
        for (const match of stringInterpolations) {
            expect(match[1]).toMatch(
                /^ALTER DEFAULT PRIVILEGES FOR ROLE %I(?: IN SCHEMA %I)? REVOKE ALL ON %s FROM PUBLIC$/u,
            )
        }
    })

    test('changes table ownership before sequences and verifies automatic child ownership', function () {
        const tablePosition = application.indexOf(
            "'ALTER TABLE %I.%I OWNER TO %I'",
        )
        const sequencePosition = application.indexOf(
            "'ALTER SEQUENCE %I.%I OWNER TO %I'",
        )
        expect(tablePosition).toBeGreaterThan(0)
        expect(sequencePosition).toBeGreaterThan(tablePosition)
        expect(application).toContain('n.nspowner <> runtime_oid')
        expect(application).toContain('c.relowner <> runtime_oid')
        expect(application).toContain('t.typowner <> runtime_oid')
    })

    test('restricts both existing PUBLIC access and global plus schema-local future defaults', function () {
        for (const statement of [
            'REVOKE ALL ON DATABASE %I FROM PUBLIC',
            'REVOKE ALL ON SCHEMA %I FROM PUBLIC',
            'REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC',
            'REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC',
            'REVOKE ALL ON TYPE %I.%I FROM PUBLIC',
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON %s FROM PUBLIC',
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON %s FROM PUBLIC',
        ]) {
            expect(application).toContain(statement)
        }
        expect(application).toContain(
            "ARRAY['TABLES', 'SEQUENCES', 'FUNCTIONS', 'TYPES', 'SCHEMAS']",
        )
        expect(application).toContain(
            'ALTER SCHEMA public OWNER TO pg_database_owner;',
        )
        expect(application).toContain(
            'REVOKE ALL ON SCHEMA public FROM PUBLIC;',
        )
    })
})
