export const LEGACY_MANIFEST_NEEDLES = [
    '"short_name": "TanStack App"',
    'Create TanStack App Sample',
    'logo192.png',
    'logo512.png',
]

const STARTER_AUDIT_NEEDLES = [
    'TanStack Dummy',
    'TanstackDummy',
    'tanstackdummy',
    'tanstack_dummy',
    'git.straessler.dev/kstraessler/tanstackdummy',
    ...LEGACY_MANIFEST_NEEDLES,
]

const ignoredFileNames = new Set([
    'bun.lock',
    'starter-audit-patterns.ts',
    'starter-audit.ts',
])

const ignoredDirectoryNames = new Set([
    '.git',
    '.idea',
    '.nitro',
    '.output',
    '.tanstack',
    '.vinxi',
    '.wrangler',
    'build',
    'dist',
    'drizzle',
    'node_modules',
    'target',
])

const ignoredRootDataDirectoryNames = new Set([
    'backups',
    'backups-nas',
    'storage',
    'storage-data',
])

export function findStarterAuditMatches(content: string) {
    return STARTER_AUDIT_NEEDLES.filter((needle) => content.includes(needle))
}

export function shouldIgnoreStarterAuditFile(fileName: string) {
    if (ignoredFileNames.has(fileName)) {
        return true
    }

    if (fileName === '.env.dev.example' || fileName === '.env.example') {
        return false
    }

    return (
        fileName === '.env' ||
        fileName === '.envrc' ||
        fileName.startsWith('.env.')
    )
}

export function shouldIgnoreStarterAuditDirectory(
    directoryName: string,
    isProjectRootEntry = false,
) {
    return (
        ignoredDirectoryNames.has(directoryName) ||
        (isProjectRootEntry && ignoredRootDataDirectoryNames.has(directoryName))
    )
}
