import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { MANAGED_PROJECT_FILES } from '@/scripts/Project/static-identity.ts'
import {
    findStarterAuditMatches,
    shouldIgnoreStarterAuditDirectory,
    shouldIgnoreStarterAuditFile,
} from '@/scripts/starter-audit-patterns.ts'

async function collectFiles(
    directory: string,
    projectRoot = directory,
): Promise<Array<string>> {
    const entries = await readdir(directory, { withFileTypes: true })
    const nestedFiles = await Promise.all(
        entries.map(async function (entry) {
            if (
                entry.isDirectory() &&
                shouldIgnoreStarterAuditDirectory(
                    entry.name,
                    directory === projectRoot,
                )
            ) {
                return []
            }

            const absolutePath = join(directory, entry.name)

            if (entry.isDirectory()) {
                return collectFiles(absolutePath, projectRoot)
            }

            if (entry.isFile() && !shouldIgnoreStarterAuditFile(entry.name)) {
                return [absolutePath]
            }

            return []
        }),
    )

    return nestedFiles.flat()
}

async function main() {
    const root = process.cwd()
    const centrallyManagedFiles = new Set<string>([
        ...MANAGED_PROJECT_FILES,
        'web/src/config/app.config.ts',
    ])
    const files = (await collectFiles(root)).filter(
        (file) =>
            !centrallyManagedFiles.has(
                relative(root, file).replaceAll('\\', '/'),
            ),
    )
    const findings = (
        await Promise.all(
            files.map(async function (file) {
                const fileStats = await stat(file)

                if (fileStats.size > 512_000) {
                    return null
                }

                const content = await readFile(file, 'utf8').catch(() => null)

                if (!content) {
                    return null
                }

                const matches = findStarterAuditMatches(content)

                if (matches.length === 0) {
                    return null
                }

                return `${relative(root, file)}: ${Array.from(new Set(matches)).join(', ')}`
            }),
        )
    ).filter((finding): finding is string => finding !== null)

    if (findings.length === 0) {
        console.log('Keine unverwalteten Starter-Namen gefunden.')
        return
    }

    console.log('Starter-Audit: Bitte diese Fork-Reste prüfen:')
    console.log(findings.map((finding) => `- ${finding}`).join('\n'))
}

await main()
