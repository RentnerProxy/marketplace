import { fileURLToPath } from 'node:url'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import {
    applyProjectIdentitySync,
    planProjectIdentitySync,
} from '@/scripts/Project/identity-sync.ts'

async function main() {
    const args = process.argv.slice(2)
    if (
        args.length > 1 ||
        args.some((arg) => !['--check', '--dry-run'].includes(arg))
    ) {
        throw new Error(
            'Verwendung: bun run project:sync [--check | --dry-run]',
        )
    }
    const plan = await planProjectIdentitySync(
        fileURLToPath(new URL('../../../', import.meta.url)),
        PROJECT_CONFIG,
    )
    if (plan.changes.length === 0) {
        console.log('Projektdateien entsprechen der zentralen Konfiguration.')
        return
    }
    console.log(plan.changes.map(({ file }) => `- ${file}`).join('\n'))
    if (args.includes('--check')) {
        throw new Error(
            'Projektdateien sind veraltet. Bitte bun run project:sync ausführen und die Änderungen committen.',
        )
    }
    if (args.includes('--dry-run')) return
    await applyProjectIdentitySync(plan)
    console.log(
        'Projektdateien aktualisiert. Es wurden keine Datenbanken, Container oder externen Dienste geändert.',
    )
}

await main().catch((error: unknown) => {
    console.error(
        error instanceof Error
            ? error.message
            : 'Projektkonfiguration konnte nicht synchronisiert werden.',
    )
    process.exitCode = 1
})
