import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
    findStarterAuditMatches,
    LEGACY_MANIFEST_NEEDLES,
    shouldIgnoreStarterAuditDirectory,
    shouldIgnoreStarterAuditFile,
} from '@/scripts/starter-audit-patterns.ts'

describe('Starter-Audit', function () {
    it('erkennt alle bekannten Manifest-Altlasten', function () {
        for (const needle of LEGACY_MANIFEST_NEEDLES) {
            expect(
                findStarterAuditMatches(`prefix ${needle} suffix`),
            ).toContain(needle)
        }
    })

    it('findet im aktuellen Manifest keine bekannten Manifest-Altlasten', async function () {
        const manifest = await readFile(
            resolve(process.cwd(), 'web', 'public', 'manifest.json'),
            'utf8',
        )
        const legacyMatches = findStarterAuditMatches(manifest).filter(
            (match) => LEGACY_MANIFEST_NEEDLES.includes(match),
        )

        expect(legacyMatches).toEqual([])
    })

    it('ignoriert private Env-Dateien, aber prüft das sichere Beispiel', function () {
        expect(shouldIgnoreStarterAuditFile('.env')).toBe(true)
        expect(shouldIgnoreStarterAuditFile('.env.local')).toBe(true)
        expect(shouldIgnoreStarterAuditFile('.env.production')).toBe(true)
        expect(shouldIgnoreStarterAuditFile('.envrc')).toBe(true)
        expect(shouldIgnoreStarterAuditFile('.env.dev.example')).toBe(false)
        expect(shouldIgnoreStarterAuditFile('.env.example')).toBe(false)
    })

    it.each(['.nitro', '.vinxi', '.wrangler'])(
        'ignoriert die generierte Ausgabe %s',
        function (directoryName) {
            expect(shouldIgnoreStarterAuditDirectory(directoryName)).toBe(true)
        },
    )

    it.each(['backups', 'backups-nas', 'storage', 'storage-data'])(
        'ignoriert den lokalen Root-Datenordner %s, aber keinen Fachordner gleichen Namens',
        function (directoryName) {
            expect(shouldIgnoreStarterAuditDirectory(directoryName, true)).toBe(
                true,
            )
            expect(
                shouldIgnoreStarterAuditDirectory(directoryName, false),
            ).toBe(false)
        },
    )
})
