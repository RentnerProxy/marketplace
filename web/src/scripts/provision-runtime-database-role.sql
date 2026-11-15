






\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
-- @project:databaseRole
\set runtime_role marketplace_runtime
\endif

BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_catalog.set_config('app.runtime_role', :'runtime_role', true) AS provisioning_role
\gset

DO $provision$
DECLARE
    application_schema constant text := 'marketplace'; -- @project:databaseSchema
    runtime_name text := pg_catalog.current_setting('app.runtime_role');
    runtime_oid oid;
    administrator_oid oid;
    database_oid oid;
    database_owner oid;
    owner_oids oid[];
    schema_name text;
    object_kind text;
    object_row record;
BEGIN

    IF pg_catalog.current_setting('server_version_num')::integer < 150000 THEN
        RAISE EXCEPTION 'Runtime provisioning requires PostgreSQL 15 or newer.';
    END IF;
    IF runtime_name !~ '^[a-z][a-z0-9_]{0,62}$'
        OR pg_catalog.left(runtime_name, 3) = 'pg_'
        OR runtime_name IN ('public', 'none', 'all', 'current_user', 'session_user')
        OR runtime_name = session_user
    THEN
        RAISE EXCEPTION 'Choose a separate, non-reserved lowercase runtime role name.';
    END IF;
    SELECT r.oid INTO administrator_oid
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = session_user AND r.rolsuper AND r.rolcanlogin;
    IF administrator_oid IS NULL OR current_user <> session_user THEN
        RAISE EXCEPTION 'Connect directly as the bootstrap database superuser.';
    END IF;
    SELECT d.oid, d.datdba INTO database_oid, database_owner
    FROM pg_catalog.pg_database AS d
    WHERE d.datname = pg_catalog.current_database()
        AND NOT d.datistemplate AND d.datallowconn
        AND d.datname NOT IN ('postgres', 'template0', 'template1')
        AND pg_catalog.left(d.datname, 3) <> 'pg_';
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_database AS d
        JOIN pg_catalog.pg_tablespace AS t ON t.oid = d.dattablespace
        WHERE d.oid = database_oid AND t.spcname <> 'pg_default'
    ) THEN
        RAISE EXCEPTION 'Custom database tablespaces require a dedicated restore/privilege review.';
    END IF;
    IF database_oid IS NULL THEN
        RAISE EXCEPTION 'Connect to the dedicated application database, never a system database.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_stat_activity AS a
        WHERE a.datid = database_oid AND a.pid <> pg_catalog.pg_backend_pid()
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_prepared_xacts AS x
        WHERE x.database = pg_catalog.current_database()
    ) THEN
        RAISE EXCEPTION 'Stop other database connections and resolve prepared transactions first.';
    END IF;

    SELECT r.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS r WHERE r.rolname = runtime_name;
    owner_oids := ARRAY[administrator_oid, COALESCE(runtime_oid, 0)]::oid[];
    IF database_owner <> ALL(owner_oids) THEN
        RAISE EXCEPTION 'The database has an unexpected owner; no ownership was changed.';
    END IF;
    IF runtime_oid IS NOT NULL AND (
        EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.oid = runtime_oid
                AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
                    OR r.rolreplication OR r.rolbypassrls)
        ) OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_auth_members AS m
            WHERE m.member = runtime_oid OR m.roleid = runtime_oid
        ) OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_db_role_setting AS s
            WHERE s.setrole = runtime_oid
        ) OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_shdepend AS d
            WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass
                AND d.refobjid = runtime_oid AND d.dbid <> database_oid
                AND NOT (d.dbid = 0
                    AND d.classid = 'pg_catalog.pg_database'::regclass
                    AND d.objid = database_oid AND d.deptype IN ('o', 'a'))
        )
    ) THEN
        RAISE EXCEPTION 'Existing runtime role has elevated, shared or customized privileges; use a dedicated role.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace AS n
        WHERE n.nspname NOT IN ('pg_catalog', 'pg_toast', 'information_schema',
            'public', application_schema, 'drizzle')
            AND n.nspname !~ '^pg_(toast_)?temp_[0-9]+$'
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace AS n
        WHERE n.nspname IN (application_schema, 'drizzle')
            AND n.nspowner <> ALL(owner_oids)
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace AS n
        WHERE n.nspname = 'public' AND n.nspowner <> ALL(owner_oids)
            AND n.nspowner <> 'pg_database_owner'::regrole
    ) THEN
        RAISE EXCEPTION 'Unexpected schema or schema owner; this script only supports a dedicated starter database.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_extension AS e
        WHERE e.extname <> 'plpgsql' OR e.extnamespace <> 'pg_catalog'::regnamespace
            OR e.extowner <> administrator_oid OR e.oid >= 16384
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_event_trigger
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_language WHERE oid >= 16384
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_am WHERE oid >= 16384
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_cast WHERE oid >= 16384
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_transform
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_seclabel
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_foreign_server
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_largeobject_metadata
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_publication
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_subscription WHERE subdbid = database_oid
    ) THEN
        RAISE EXCEPTION 'Extensions or unsupported database objects require a dedicated operator review.';
    END IF;




    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS d
        JOIN pg_catalog.pg_namespace AS n ON n.oid = d.refobjid
        WHERE d.refclassid = 'pg_catalog.pg_namespace'::regclass
            AND n.nspname IN ('public', application_schema, 'drizzle')
            AND (n.nspname = 'public' OR d.classid NOT IN (
                'pg_catalog.pg_class'::regclass, 'pg_catalog.pg_type'::regclass,
                'pg_catalog.pg_default_acl'::regclass
            ))
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS d
        JOIN pg_catalog.pg_namespace AS n ON n.oid = d.refobjid
        WHERE d.refclassid = 'pg_catalog.pg_namespace'::regclass
            AND n.nspname IN ('pg_catalog', 'information_schema') AND d.objid >= 16384
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', application_schema, 'drizzle')
            AND (n.nspname = 'public' OR c.relkind NOT IN ('r', 'i', 'S')
                OR c.relpersistence <> 'p' OR c.reltablespace <> 0 OR c.relowner <> ALL(owner_oids)
                OR c.relrowsecurity OR c.relforcerowsecurity)
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_inherits
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE NOT t.tgisinternal
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_statistic_ext
    ) THEN
        RAISE EXCEPTION 'Only ordinary starter tables, indexes and sequences are supported.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_type AS t
        JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
        WHERE n.nspname IN ('public', application_schema, 'drizzle')
            AND (n.nspname = 'public' OR t.typowner <> ALL(owner_oids) OR NOT (
                (t.typtype = 'c' AND EXISTS (
                    SELECT 1 FROM pg_catalog.pg_class AS c
                    WHERE c.oid = t.typrelid AND c.reltype = t.oid
                        AND c.relkind = 'r' AND c.relnamespace = t.typnamespace
                )) OR (t.typcategory = 'A' AND EXISTS (
                    SELECT 1 FROM pg_catalog.pg_type AS e
                    JOIN pg_catalog.pg_class AS c ON c.oid = e.typrelid
                    WHERE e.oid = t.typelem AND e.typarray = t.oid
                        AND e.typtype = 'c' AND c.reltype = e.oid
                        AND c.relkind = 'r' AND e.typnamespace = t.typnamespace
                ))
            ))
    ) THEN
        RAISE EXCEPTION 'Only automatic table row and array types are supported.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname IN (application_schema, 'drizzle') AND a.attacl IS NOT NULL
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_default_acl AS d
        WHERE d.defaclrole <> ALL(owner_oids)
    ) OR EXISTS (
        SELECT 1
        FROM (
            SELECT d.datacl AS acl, false AS public_schema_owner_acl
            FROM pg_catalog.pg_database AS d WHERE d.oid = database_oid
            UNION ALL
            SELECT n.nspacl, n.nspname = 'public' AND n.nspowner = 'pg_database_owner'::regrole
            FROM pg_catalog.pg_namespace AS n
            WHERE n.nspname IN ('public', application_schema, 'drizzle')
            UNION ALL
            SELECT c.relacl, false FROM pg_catalog.pg_class AS c
            JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname IN (application_schema, 'drizzle')
            UNION ALL
            SELECT t.typacl, false FROM pg_catalog.pg_type AS t
            JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
            WHERE n.nspname IN (application_schema, 'drizzle')
            UNION ALL
            SELECT d.defaclacl, false FROM pg_catalog.pg_default_acl AS d
        ) AS entries
        CROSS JOIN LATERAL pg_catalog.aclexplode(entries.acl) AS a
        WHERE a.grantee <> ALL(owner_oids || 0::oid)
            AND NOT (entries.public_schema_owner_acl
                AND a.grantee = 'pg_database_owner'::regrole
                AND a.grantor = 'pg_database_owner'::regrole
                AND a.privilege_type IN ('USAGE', 'CREATE') AND NOT a.is_grantable)
    ) THEN
        RAISE EXCEPTION 'Column privileges or grants to other roles require an explicit operator review.';
    END IF;




    IF runtime_oid IS NULL THEN
        EXECUTE pg_catalog.format(
            'CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT',
            runtime_name
        );
    ELSE
        EXECUTE pg_catalog.format(
            'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT',
            runtime_name
        );
    END IF;
    SELECT r.oid INTO STRICT runtime_oid
    FROM pg_catalog.pg_roles AS r WHERE r.rolname = runtime_name;

    EXECUTE pg_catalog.format('ALTER DATABASE %I OWNER TO %I',
        pg_catalog.current_database(), runtime_name);
    EXECUTE pg_catalog.format('REVOKE ALL ON DATABASE %I FROM PUBLIC',
        pg_catalog.current_database());
    FOREACH object_kind IN ARRAY ARRAY['TABLES', 'SEQUENCES', 'FUNCTIONS', 'TYPES', 'SCHEMAS']
    LOOP

        EXECUTE pg_catalog.format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON %s FROM PUBLIC',
            runtime_name, object_kind
        );
    END LOOP;
    FOREACH schema_name IN ARRAY ARRAY[application_schema, 'drizzle']
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_namespace AS n WHERE n.nspname = schema_name
        ) THEN
            EXECUTE pg_catalog.format('CREATE SCHEMA %I AUTHORIZATION %I', schema_name, runtime_name);
        ELSE
            EXECUTE pg_catalog.format('ALTER SCHEMA %I OWNER TO %I', schema_name, runtime_name);
        END IF;
        EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', schema_name);
        FOREACH object_kind IN ARRAY ARRAY['TABLES', 'SEQUENCES', 'FUNCTIONS', 'TYPES']
        LOOP
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON %s FROM PUBLIC',
                runtime_name, schema_name, object_kind
            );
        END LOOP;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'public') THEN

        ALTER SCHEMA public OWNER TO pg_database_owner;
        REVOKE ALL ON SCHEMA public FROM PUBLIC;
    END IF;


    FOR object_row IN
        SELECT n.nspname, c.relname FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname IN (application_schema, 'drizzle') AND c.relkind = 'r'
        ORDER BY n.nspname, c.relname
    LOOP
        EXECUTE pg_catalog.format('ALTER TABLE %I.%I OWNER TO %I',
            object_row.nspname, object_row.relname, runtime_name);
    END LOOP;

    FOR object_row IN
        SELECT n.nspname, c.relname FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname IN (application_schema, 'drizzle') AND c.relkind = 'S'
        ORDER BY n.nspname, c.relname
    LOOP
        EXECUTE pg_catalog.format('ALTER SEQUENCE %I.%I OWNER TO %I',
            object_row.nspname, object_row.relname, runtime_name);
    END LOOP;
    FOREACH schema_name IN ARRAY ARRAY[application_schema, 'drizzle']
    LOOP
        EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', schema_name);
        EXECUTE pg_catalog.format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', schema_name);
    END LOOP;

    FOR object_row IN
        SELECT n.nspname, t.typname FROM pg_catalog.pg_type AS t
        JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
        WHERE n.nspname IN (application_schema, 'drizzle') AND t.typtype = 'c'
    LOOP
        EXECUTE pg_catalog.format('REVOKE ALL ON TYPE %I.%I FROM PUBLIC',
            object_row.nspname, object_row.typname);
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace AS n
        WHERE n.nspname IN (application_schema, 'drizzle') AND n.nspowner <> runtime_oid
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS d
        JOIN pg_catalog.pg_namespace AS n ON n.oid = d.refobjid
        WHERE d.refclassid = 'pg_catalog.pg_namespace'::regclass
            AND n.nspname IN ('pg_catalog', 'information_schema') AND d.objid >= 16384
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname IN (application_schema, 'drizzle') AND c.relowner <> runtime_oid
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_type AS t
        JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
        WHERE n.nspname IN (application_schema, 'drizzle') AND t.typowner <> runtime_oid
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members AS m
        WHERE m.member = runtime_oid OR m.roleid = runtime_oid
    ) THEN
        RAISE EXCEPTION 'Runtime ownership postcondition failed; all changes are rolled back.';
    END IF;
END;
$provision$;
COMMIT;
\unset provisioning_role
\echo 'Runtime role provisioned. Set its password interactively before application startup.'
