import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { validateProjectIdentity } from '@/scripts/Project/identity-validation.ts'
import {
    MANAGED_PROJECT_FILES,
    renderProjectIdentityFile,
} from '@/scripts/Project/static-identity.ts'
import {
    applyProjectIdentitySync,
    planProjectIdentitySync,
} from '@/scripts/Project/identity-sync.ts'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const temporaryBase = resolve(tmpdir())
const directories: string[] = []
const renamed = {
    ...PROJECT_CONFIG,
    defaultName: 'Kundenportal Süd',
    id: 'kundenportal',
    packageName: 'kundenportal_web',
    databaseName: 'kundendaten',
    databaseSchema: 'kundenbereich',
    databaseRole: 'kunden_runtime',
    repositoryUrl: 'https://git.example.test/team/Kundenportal',
    imageRepository: 'registry.example.test/team/kundenportal',
}

async function fixture() {
    const root = await mkdtemp(join(temporaryBase, 'project-identity-test-'))
    directories.push(root)
    await Promise.all(
        MANAGED_PROJECT_FILES.map(async (file) => {
            await mkdir(dirname(join(root, file)), { recursive: true })
            await writeFile(
                join(root, file),
                await readFile(join(repository, file)),
            )
        }),
    )
    return root
}

afterEach(async () => {
    await Promise.all(
        directories.splice(0).map(async (directory) => {
            if (
                !resolve(directory).startsWith(
                    temporaryBase + sep + 'project-identity-test-',
                )
            )
                throw new Error('Unsafe test cleanup')
            await rm(directory, { recursive: true, force: true })
        }),
    )
})

describe('central project identity', () => {
    it('derives deployment names from the image repository without extra configuration', () => {
        expect(
            validateProjectIdentity({
                ...PROJECT_CONFIG,
                imageRepository: 'registry.example.test/team/kundenportal',
            }),
        ).toMatchObject({
            id: 'kundenportal',
            databaseRole: 'kundenportal_runtime',
        })
    })

    it('rejects derived names that cannot be used as database roles', () => {
        expect(() =>
            validateProjectIdentity({
                ...PROJECT_CONFIG,
                imageRepository: 'registry.example.test/team/kunden-portal',
            }),
        ).toThrow('databaseRole')
    })

    it('accepts the existing identity and an independent database/schema rename', () => {
        expect(validateProjectIdentity(PROJECT_CONFIG)).toEqual({
            ...PROJECT_CONFIG,
            id: 'marketplace',
            databaseRole: 'marketplace_runtime',
        })
        expect(validateProjectIdentity(renamed).databaseName).not.toBe(
            renamed.databaseSchema,
        )
    })

    it.each([
        'public',
        'drizzle',
        'pg_catalog',
        'postgres',
        'app; DROP SCHEMA public',
        '../app',
        '',
    ])('rejects unsafe or reserved database schemas: %s', (databaseSchema) => {
        expect(() =>
            validateProjectIdentity({ ...renamed, databaseSchema }),
        ).toThrow('databaseSchema')
    })

    it.each([
        'https://user:password@git.example.test/app',
        'file:///etc/passwd',
        'https://git.example.test/app?token=secret',
    ])(
        'rejects credential-bearing or noncanonical repository URLs',
        (repositoryUrl) => {
            expect(() =>
                validateProjectIdentity({ ...renamed, repositoryUrl }),
            ).toThrow('repositoryUrl')
        },
    )

    it('plans without modifying files and then synchronizes idempotently', async () => {
        const root = await fixture()
        const packageBefore = await readFile(join(root, 'package.json'), 'utf8')
        const plan = await planProjectIdentitySync(root, renamed)
        expect(plan.changes.length).toBeGreaterThan(0)
        expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(
            packageBefore,
        )
        await applyProjectIdentitySync(plan)
        expect((await planProjectIdentitySync(root, renamed)).changes).toEqual(
            [],
        )
        const packageAfter = JSON.parse(
            await readFile(join(root, 'package.json'), 'utf8'),
        )
        expect(packageAfter.name).toBe(renamed.packageName)
        expect(packageAfter.dependencies).toEqual(
            JSON.parse(packageBefore).dependencies,
        )
    })

    it('keeps database names, schemas, roles and image repositories distinct', async () => {
        const root = await fixture()
        await applyProjectIdentitySync(
            await planProjectIdentitySync(root, renamed),
        )
        const compose = await readFile(join(root, 'docker-compose.yml'), 'utf8')
        const sql = await readFile(
            join(root, 'web/src/scripts/provision-runtime-database-role.sql'),
            'utf8',
        )
        expect(compose).not.toContain(renamed.databaseName)
        expect(compose).not.toContain(renamed.databaseRole)
        expect(compose).toContain('env_file:')
        expect(compose).not.toContain(renamed.databaseSchema)
        expect(sql).toContain(
            `application_schema constant text := '${renamed.databaseSchema}'`,
        )
        expect(sql).not.toContain(renamed.databaseName)
        expect(sql).toContain(renamed.databaseRole)
        expect(compose).toContain(`image: ${renamed.imageRepository}:latest`)
        const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8')
        expect(dockerfile).toContain('POSTGRES_DB=' + renamed.databaseName)
        const productionEnvironment = await readFile(
            join(root, '.env.example'),
            'utf8',
        )
        expect(productionEnvironment).toContain(renamed.defaultName)
        expect(productionEnvironment).not.toMatch(/^(APP_IMAGE|POSTGRES_DB)=/mu)
    })

    it('supports repeated renames without replacing unrelated occurrences of a short project id', async () => {
        const root = await fixture()
        const short = { ...renamed, id: 'app' }
        const next = { ...renamed, id: 'next' }
        await Promise.all(
            MANAGED_PROJECT_FILES.map(async (file) => {
                const source = await readFile(join(root, file), 'utf8')
                const first = renderProjectIdentityFile(file, source, short)
                const second = renderProjectIdentityFile(file, first, next)
                expect(second).toBe(
                    renderProjectIdentityFile(file, source, next),
                )
            }),
        )
    })

    it('refuses concurrent edits before applying any planned file', async () => {
        const root = await fixture()
        const plan = await planProjectIdentitySync(root, renamed)
        const change = plan.changes.at(-1)
        if (!change) throw new Error('Expected pending changes')
        await writeFile(change.path, change.before + '\n# concurrent edit\n')
        await expect(applyProjectIdentitySync(plan)).rejects.toThrow(
            'zwischenzeitlich',
        )
        const first = plan.changes[0]
        if (!first || first === change)
            throw new Error('Expected multiple planned changes')
        expect(await readFile(first.path, 'utf8')).toBe(first.before)
    })

    it('rejects a changed target path before writing the plan', async () => {
        const root = await fixture()
        const plan = await planProjectIdentitySync(root, renamed)
        const first = plan.changes[0]
        if (!first) throw new Error('Expected a pending change')
        first.path = join(root, 'unmanaged.txt')
        await expect(applyProjectIdentitySync(plan)).rejects.toThrow(
            'Projektdateipfad',
        )
        expect(await readFile(join(root, first.file), 'utf8')).toBe(
            first.before,
        )
    })

    it('rejects ambiguous static fields during planning without touching earlier files', async () => {
        const root = await fixture()
        const manifestPath = join(root, 'web/public/manifest.json')
        await writeFile(
            manifestPath,
            '{"name":"First","short_name":"Short","name":"Second"}',
        )
        const packageBefore = await readFile(join(root, 'package.json'), 'utf8')
        await expect(planProjectIdentitySync(root, renamed)).rejects.toThrow(
            'manifest name',
        )
        expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(
            packageBefore,
        )
    })
})
