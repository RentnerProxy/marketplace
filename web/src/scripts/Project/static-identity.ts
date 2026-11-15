import type { ProjectIdentity } from '@/scripts/Types/project-identity.types.ts'
import {
    PROJECT_DOCUMENTATION_FILES,
    renderProjectDocumentation,
} from './documentation-identity.ts'

export const MANAGED_PROJECT_FILES = [
    'package.json',
    'bun.lock',
    'web/public/manifest.json',
    'Dockerfile',
    'docker-compose.yml',
    '.env.dev.example',
    '.env.example',
    'web/src/scripts/provision-runtime-database-role.sql',
    ...PROJECT_DOCUMENTATION_FILES,
] as const

function escapeReplacement(value: string) {
    return value.replace(/\$/gu, '$$$$')
}

function jsonString(value: string) {
    return escapeReplacement(JSON.stringify(value))
}

function dockerfileString(value: string) {
    const escaped = value
        .replace(/\\/gu, '\\\\')
        .replace(/"/gu, '\\"')
        .replace(/\$/gu, '\\$')
    return escapeReplacement(`"${escaped}"`)
}

function countMatches(content: string, pattern: RegExp) {
    if (!pattern.global) {
        throw new Error('Statische Projektmuster müssen global sein.')
    }

    pattern.lastIndex = 0
    let count = 0
    try {
        while (pattern.exec(content)) {
            count += 1
            if (pattern.lastIndex === 0) pattern.lastIndex += 1
        }
    } finally {
        pattern.lastIndex = 0
    }
    return count
}

function replaceOnce(
    content: string,
    pattern: RegExp,
    replacement: string,
    field: string,
) {
    if (countMatches(content, pattern) !== 1) {
        throw new Error(
            `Statische Projektidentität benötigt genau einen Treffer für ${field}.`,
        )
    }
    return content.replace(pattern, replacement)
}

function replaceMany(
    content: string,
    pattern: RegExp,
    replacement: string,
    field: string,
    expectedCount: number,
) {
    if (countMatches(content, pattern) !== expectedCount) {
        throw new Error(
            `Statische Projektidentität benötigt ${expectedCount} Treffer für ${field}.`,
        )
    }
    return content.replace(pattern, replacement)
}

function replacePackageJson(content: string, config: ProjectIdentity) {
    return replaceOnce(
        content,
        /("name"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*"/gu,
        `$1${jsonString(config.packageName)}`,
        'packageName',
    )
}

function replaceLockfile(content: string, config: ProjectIdentity) {
    return replaceOnce(
        content,
        /(""\s*:\s*\{\s*\r?\n\s*"name"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*"/gu,
        `$1${jsonString(config.packageName)}`,
        'packageName in bun.lock',
    )
}

function replaceManifest(content: string, config: ProjectIdentity) {
    let next = replaceOnce(
        content,
        /("short_name"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*"/gu,
        `$1${jsonString(config.defaultName)}`,
        'manifest short_name',
    )
    next = replaceOnce(
        next,
        /("name"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*"/gu,
        `$1${jsonString(config.defaultName)}`,
        'manifest name',
    )
    return next
}

function replaceDockerfile(content: string, config: ProjectIdentity) {
    let next = replaceOnce(
        content,
        /^(LABEL[ \t]+org\.opencontainers\.image\.title=)"(?:\\[\s\S]|[^"\\\r\n])*"/gmu,
        `$1${dockerfileString(config.defaultName)}`,
        'OCI title',
    )
    next = replaceOnce(
        next,
        /^([ \t]+MAIL_FROM_NAME=)"(?:\\[\s\S]|[^"\\\r\n])*"/gmu,
        `$1${dockerfileString(config.defaultName)}`,
        'mail sender name',
    )
    return replaceOnce(
        next,
        /^([ \t]+POSTGRES_DB=)[a-z][a-z0-9_]*([ \t]+\\)[ \t]*$/gmu,
        `$1${escapeReplacement(config.databaseName)}$2`,
        'runtime databaseName',
    )
}

function replaceProvisioningSql(content: string, config: ProjectIdentity) {
    let next = replaceOnce(
        content,
        /^(\\set runtime_role\s+)[a-z][a-z0-9_]{0,62}(\s*)$/gmu,
        `$1${escapeReplacement(config.databaseRole)}$2`,
        'SQL databaseRole',
    )
    return replaceOnce(
        next,
        /^(\s*application_schema constant text := ')[^']+(';\s*-- @project:databaseSchema\s*)$/gmu,
        `$1${escapeReplacement(config.databaseSchema)}$2`,
        'SQL databaseSchema',
    )
}

function replaceCompose(content: string, config: ProjectIdentity) {
    const replacements: Array<readonly [RegExp, string, string, number]> = [
        [
            /^(\s*image:\s*)[^\r\n]+:latest[ \t]*$/gmu,
            `$1${escapeReplacement(config.imageRepository)}:latest`,
            'production imageRepository',
            1,
        ],
        [
            /^(    )[a-z][a-z0-9_-]*:(?=\r?\n        image:)/gmu,
            `$1${escapeReplacement(config.id)}:`,
            'appliance service',
            1,
        ],
        [
            /^(\s*-\s+)[a-z][a-z0-9_-]*_data:(\/data\s*)$/gmu,
            `$1${escapeReplacement(config.id)}_data:$2`,
            'appliance data volume',
            1,
        ],
        [
            /^([ \t]+)[a-z][a-z0-9_-]*_data:[ \t]*$/gmu,
            `$1${escapeReplacement(config.id)}_data:`,
            'appliance data volume definition',
            1,
        ],
    ]
    return replacements.reduce(
        (next, [pattern, replacement, field, expectedCount]) =>
            replaceMany(next, pattern, replacement, field, expectedCount),
        content,
    )
}

function replaceEnvDev(content: string, config: ProjectIdentity) {
    let next = replaceOnce(
        content,
        /^(DATABASE_URL=.*\/)[^\r\n]+$/gmu,
        `$1${escapeReplacement(config.databaseName)}`,
        'development databaseName',
    )
    next = replaceOnce(
        next,
        /^(MAIL_FROM_NAME=)[^\r\n]*$/gmu,
        '$1',
        'development mail sender name',
    )
    return next
}

function replaceEnvProduction(content: string, config: ProjectIdentity) {
    return replaceOnce(
        content,
        /^(# @project:defaultName\r?\n# )".*("\. Passkey-Werte erben ORIGIN und die App-Defaults\.)$/gmu,
        `$1"${escapeReplacement(config.defaultName)}$2`,
        'production mail sender documentation',
    )
}

export function renderProjectIdentityFile(
    filePath: string,
    content: string,
    config: ProjectIdentity,
) {
    const managedFile = MANAGED_PROJECT_FILES.find((file) => file === filePath)
    if (!managedFile) {
        throw new Error(
            `Datei ist nicht für Identitätssync freigegeben: ${filePath}`,
        )
    }

    switch (managedFile) {
        case 'package.json':
            return replacePackageJson(content, config)
        case 'bun.lock':
            return replaceLockfile(content, config)
        case 'web/public/manifest.json':
            return replaceManifest(content, config)
        case 'Dockerfile':
            return replaceDockerfile(content, config)
        case 'docker-compose.yml':
            return replaceCompose(content, config)
        case '.env.dev.example':
            return replaceEnvDev(content, config)
        case '.env.example':
            return replaceEnvProduction(content, config)
        case 'web/src/scripts/provision-runtime-database-role.sql':
            return replaceProvisioningSql(content, config)
        case 'README.md':
            return renderProjectDocumentation(content, config)
    }
    throw new Error(
        `Für die Projektdatei fehlt eine Identitätsvorlage: ${filePath}`,
    )
}
