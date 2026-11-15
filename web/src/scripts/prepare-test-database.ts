import { SQL } from 'bun'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import {
    getTestDatabaseUrl,
    isTestDatabaseName,
} from '@/scripts/test-database-url.ts'

function quoteIdentifier(identifier: string) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
        throw new Error(`Ungültiger PostgreSQL-Identifier: ${identifier}`)
    }

    return `"${identifier}"`
}

const schemaIdentifier = quoteIdentifier(PROJECT_CONFIG.databaseSchema)
const tableIdentifier = (tableName: string) =>
    `${schemaIdentifier}.${quoteIdentifier(tableName)}`

const schemaStatements = [
    `CREATE SCHEMA IF NOT EXISTS ${schemaIdentifier}`,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier('users')} (
        "id" uuid PRIMARY KEY,
        "username" varchar(50) NOT NULL,
        "email" varchar(255) NOT NULL,
        "passwordHash" text NOT NULL,
        "isTwoFactorEnabled" boolean NOT NULL DEFAULT false,
        "isActive" boolean NOT NULL DEFAULT true,
        "isDeleted" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "createdByUserId" uuid REFERENCES ${tableIdentifier('users')}("id") ON DELETE SET NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS users_username_active_unique_idx
        ON ${tableIdentifier('users')} ("username") WHERE "isDeleted" = false`,
    `CREATE UNIQUE INDEX IF NOT EXISTS users_email_active_unique_idx
        ON ${tableIdentifier('users')} ("email") WHERE "isDeleted" = false`,
    `CREATE INDEX IF NOT EXISTS users_created_by_user_id_idx
        ON ${tableIdentifier('users')} ("createdByUserId")`,
    `CREATE INDEX IF NOT EXISTS users_is_deleted_idx
        ON ${tableIdentifier('users')} ("isDeleted")`,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier('user_profiles')} (
        "userId" uuid PRIMARY KEY REFERENCES ${tableIdentifier('users')}("id") ON DELETE CASCADE,
        "firstName" varchar(100),
        "lastName" varchar(100),
        "street" varchar(100),
        "houseNumber" varchar(20),
        "postalCode" varchar(20),
        "city" varchar(100),
        "profileImageUpdatedAt" timestamptz
    )`,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier('user_settings')} (
        "userId" uuid PRIMARY KEY REFERENCES ${tableIdentifier('users')}("id") ON DELETE CASCADE,
        "primaryColor" varchar(20),
        "themeMode" varchar(20) NOT NULL DEFAULT 'dark',
        "fontFamily" varchar(20) NOT NULL DEFAULT 'inter',
        "fontSize" integer NOT NULL DEFAULT 16,
        "customBackgroundUpdatedAt" timestamptz,
        "customBackgroundDarkness" integer,
        CONSTRAINT user_settings_theme_mode_check CHECK ("themeMode" IN ('dark', 'light')),
        CONSTRAINT user_settings_font_family_check CHECK ("fontFamily" IN ('inter', 'system', 'serif', 'mono')),
        CONSTRAINT user_settings_font_size_check CHECK ("fontSize" IN (14, 15, 16, 17, 18)),
        CONSTRAINT user_settings_custom_background_darkness_check CHECK (
            "customBackgroundDarkness" IS NULL OR
            ("customBackgroundDarkness" >= 0 AND "customBackgroundDarkness" <= 100)
        )
    )`,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier('system_settings')} (
        "id" varchar(50) PRIMARY KEY,
        "companyName" varchar(100) NOT NULL,
        "logoUpdatedAt" timestamptz,
        "isMaintenanceModeEnabled" boolean NOT NULL DEFAULT false,
        "maintenanceStartsAt" timestamptz,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier('trusted_devices')} (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES ${tableIdentifier('users')}("id") ON DELETE CASCADE,
        "deviceTokenHash" varchar(64) NOT NULL UNIQUE,
        "ip" varchar(45),
        "location" varchar(255),
        "device" varchar(255),
        "browser" varchar(255),
        "expiresAt" timestamptz NOT NULL,
        "lastUsedAt" timestamptz NOT NULL DEFAULT now(),
        "createdAt" timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS trusted_devices_user_id_idx
        ON ${tableIdentifier('trusted_devices')} ("userId")`,
    `CREATE INDEX IF NOT EXISTS trusted_devices_expires_at_idx
        ON ${tableIdentifier('trusted_devices')} ("expiresAt")`,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier('password_reset_tokens')} (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES ${tableIdentifier('users')}("id") ON DELETE CASCADE,
        "tokenHash" varchar(64) NOT NULL UNIQUE,
        "expiresAt" timestamptz NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
        ON ${tableIdentifier('password_reset_tokens')} ("userId")`,
    `CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
        ON ${tableIdentifier('password_reset_tokens')} ("expiresAt")`,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier('sessions')} (
        "id" varchar(255) PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES ${tableIdentifier('users')}("id") ON DELETE CASCADE,
        "ip" varchar(45),
        "location" varchar(255),
        "device" varchar(255),
        "browser" varchar(255),
        "expiresAt" timestamptz NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS sessions_user_id_idx
        ON ${tableIdentifier('sessions')} ("userId")`,
    `CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
        ON ${tableIdentifier('sessions')} ("expiresAt")`,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier('permissions')} (
        "id" uuid PRIMARY KEY,
        "key" varchar(100) NOT NULL UNIQUE,
        "name" varchar(100) NOT NULL,
        "description" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier('user_permissions')} (
        "userId" uuid NOT NULL REFERENCES ${tableIdentifier('users')}("id") ON DELETE CASCADE,
        "permissionId" uuid NOT NULL REFERENCES ${tableIdentifier('permissions')}("id") ON DELETE CASCADE,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("userId", "permissionId")
    )`,
] as const

async function executeSchemaStatements(
    client: SQL,
    statements: ReadonlyArray<string>,
): Promise<void> {
    for (const statement of statements) {
        if (!statement) {
            return
        }

        // oxlint-disable-next-line no-await-in-loop -- Die Schema-Statements müssen nacheinander ausgeführt werden.
        await client.unsafe(statement)
    }
}

async function prepareTestDatabase() {
    const { databaseName, value } = getTestDatabaseUrl()
    const client = new SQL(value)

    try {
        const databaseRows = await client`
            SELECT current_database() AS "databaseName"
        `
        const connectedDatabaseName = databaseRows.at(0)?.databaseName

        if (
            connectedDatabaseName !== databaseName ||
            !isTestDatabaseName(String(connectedDatabaseName))
        ) {
            throw new Error(
                'Die verbundene Datenbank stimmt nicht mit der freigegebenen Testdatenbank überein.',
            )
        }

        await client.unsafe("SET lock_timeout = '5s'")
        await client.unsafe("SET statement_timeout = '30s'")

        await executeSchemaStatements(client, schemaStatements)
    } finally {
        await client.close()
    }
}

await prepareTestDatabase()
console.log('Isolierte PostgreSQL-Testdatenbank ist vorbereitet.')
