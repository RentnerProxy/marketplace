import type { ProjectIdentity } from '@/scripts/Types/project-identity.types.ts'

export const PROJECT_DOCUMENTATION_FILES = ['README.md'] as const

function htmlText(value: string) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
}

export function renderProjectDocumentation(
    content: string,
    config: ProjectIdentity,
) {
    const values: Record<string, string> = {
        defaultName: htmlText(config.defaultName),
        dataVolume: `\`${config.id}_data\``,
        applianceService: `\`${config.id}\``,
        databaseVolume: `\`${config.id}_db_data\``,
        storageVolume: `\`${config.id}_app_storage\``,
        databaseRole: `\`${config.databaseRole}\``,
        databaseSchema: `\`${config.databaseSchema}\``,
        databaseNameAssignment: `\`POSTGRES_DB=${config.databaseName}\``,
        runtimeRoleAssignment: '`POSTGRES_USER=postgres`',
        mailQueue: '`rentnerproxy-marketplace-mail-v2`',
        mailQuiescenceKey: '`rentnerproxy-marketplace:mail:restore-quiescence:v1`',
        rolePasswordCommand: `\`docker compose exec ${config.id} appliance-psql\``,
        rolePassword: `\`\\password ${config.databaseRole}\``,
    }
    let next = content.replace(
        /[<]!-- project:(\w+) -->[\s\S]*?[<]!-- \/project -->/g,
        (_match, key: string) => {
            const value = values[key]
            if (value === undefined)
                throw new Error(
                    `Unbekanntes Projektfeld in der Dokumentation: ${key}`,
                )
            return `<!-- project:${key} -->${value}<!-- /project -->`
        },
    )
    next = next.replace(
        /(^[ \t]*-t )[a-z][a-z0-9_-]*(:local \.)$/gm,
        (_match, prefix: string, suffix: string) => prefix + config.id + suffix,
    )
    next = next.replace(
        /(^[ \t]*-U postgres -d )[a-z][a-z0-9_]*( \\)$/gm,
        (_match, prefix: string, suffix: string) =>
            prefix + config.databaseName + suffix,
    )
    next = next.replace(
        /(^[ \t]*-v runtime_role=)[a-z][a-z0-9_]*( \\)$/gm,
        (_match, prefix: string, suffix: string) =>
            prefix + config.databaseRole + suffix,
    )
    return next
}
