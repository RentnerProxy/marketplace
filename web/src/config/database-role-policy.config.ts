export const DATABASE_ROLE_POLICY = {
    maximumRoles: 256,
    connectionTimeoutSeconds: 5,
    queryTimeoutMs: 5000,
    cleanupTimeoutMs: 1000,
    idleTimeoutSeconds: 1,
    allowedSystemRoles: ['pg_database_owner'],
    errorCode: 'DATABASE_ROLE_POLICY_FAILED',
    errorMessage:
        'Die Datenbank-Rollenrichtlinie konnte nicht bestätigt werden.',
} as const
