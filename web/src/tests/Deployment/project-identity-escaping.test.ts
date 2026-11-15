import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { renderProjectIdentityFile } from '@/scripts/Project/static-identity.ts'

const repository = new URL('../../../../', import.meta.url)
const renamed = {
    ...PROJECT_CONFIG,
    defaultName: `O'Neil "Portal" $PROJECT_ENV_EXPANSION \\ Daten`,
    id: 'kundenportal',
    packageName: 'kundenportal_web',
    databaseName: 'kundendaten',
    databaseSchema: 'kundenbereich',
    databaseRole: 'kunden_runtime',
    repositoryUrl: 'https://git.example.test/team/Kundenportal',
    imageRepository: 'registry.example.test/team/kundenportal',
}

async function source(path: string) {
    return readFile(new URL(path, repository), 'utf8')
}

function doubleQuoted(value: string) {
    return value
        .replace(/\\/gu, '\\\\')
        .replace(/"/gu, '\\"')
        .replace(/\$/gu, '\\$')
}

async function readWithBunEnvFile(content: string) {
    const directory = await mkdtemp(join(tmpdir(), 'project-identity-dotenv-'))
    if (
        !resolve(directory).startsWith(
            resolve(tmpdir()) + sep + 'project-identity-dotenv-',
        )
    )
        throw new Error('Unsafe test cleanup')
    const envPath = join(directory, '.env.synthetic')
    await writeFile(envPath, content)
    try {
        const result = Bun.spawnSync({
            cmd: [
                process.execPath,
                '--env-file',
                envPath,
                '-e',
                'process.stdout.write(process.env.MAIL_FROM_NAME ?? "")',
            ],
            cwd: directory,
            env: { PROJECT_ENV_EXPANSION: 'must-not-expand' },
            stdout: 'pipe',
            stderr: 'pipe',
        })
        expect(result.exitCode).toBe(0)
        expect(result.stderr.toString()).toBe('')
        return result.stdout.toString()
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

describe('project identity escaping', function () {
    it('keeps JSON and Dockerfile values valid over repeated renames', async function () {
        const manifest = await source('web/public/manifest.json')
        const dockerfile = await source('Dockerfile')
        const nextIdentity = { ...renamed, defaultName: 'Neues "Portal"' }

        const renderedManifest = renderProjectIdentityFile(
            'web/public/manifest.json',
            manifest,
            renamed,
        )
        const renderedDockerfile = renderProjectIdentityFile(
            'Dockerfile',
            dockerfile,
            renamed,
        )

        expect(JSON.parse(renderedManifest)).toMatchObject({
            name: renamed.defaultName,
            short_name: renamed.defaultName,
        })
        expect(renderedDockerfile).toContain(
            `LABEL org.opencontainers.image.title="${doubleQuoted(renamed.defaultName)}"`,
        )
        expect(renderedDockerfile).toContain(
            `MAIL_FROM_NAME="${doubleQuoted(renamed.defaultName)}"`,
        )
        expect(
            renderProjectIdentityFile(
                'web/public/manifest.json',
                renderedManifest,
                nextIdentity,
            ),
        ).toBe(
            renderProjectIdentityFile(
                'web/public/manifest.json',
                manifest,
                nextIdentity,
            ),
        )
        expect(
            renderProjectIdentityFile(
                'Dockerfile',
                renderedDockerfile,
                nextIdentity,
            ),
        ).toBe(
            renderProjectIdentityFile('Dockerfile', dockerfile, nextIdentity),
        )
    })

    it('quotes Compose and dotenv values and protects automation files', async function () {
        const compose = renderProjectIdentityFile(
            'docker-compose.yml',
            await source('docker-compose.yml'),
            renamed,
        )
        const parsed = Bun.YAML.parse(compose) as {
            services: {
                kundenportal: { volumes: string[] }
            }
            volumes: Record<string, unknown>
        }

        expect(parsed.services.kundenportal.volumes).toEqual([
            'kundenportal_data:/data',
            '${BACKUP_PATH:-./backups}:/data/backups',
        ])
        expect(parsed.volumes).toHaveProperty('kundenportal_data')
        expect(compose).not.toContain('_internal_credentials')

        const dotenv = renderProjectIdentityFile(
            '.env.dev.example',
            await source('.env.dev.example'),
            renamed,
        )
        const parsedDotenv = await readWithBunEnvFile(dotenv)
        expect(parsedDotenv).toBe('')

        expect(() =>
            renderProjectIdentityFile(
                '.github/workflows/release.yml',
                'name: Release',
                renamed,
            ),
        ).toThrow('nicht für Identitätssync freigegeben')
    })

    it.each([
        'Portal\\',
        'Portal\\\\',
        'Portal` mit Backtick',
        'Portal\\` mit Backslash und Backtick',
        'Portal\\$PROJECT_ENV_EXPANSION',
        'Portal\\\\$PROJECT_ENV_EXPANSION',
        'Portal\\n mit literaler Sequenz',
        'Portal # Kommentarzeichen',
        '"Portal mit führendem Anführungszeichen',
        "'Portal mit führendem Apostroph",
        '`Portal mit führendem Backtick',
        'Portal "mit" allen \'drei\' `Zeichen` # und Backslash\\',
        'Portal ${PROJECT_ENV_EXPANSION:-anderer Name} und $PROJECT_ENV_EXPANSION',
    ])(
        'keeps the literal name %s out of dotenv across renames',
        async function (defaultName) {
            const original = await source('.env.dev.example')
            const identity = { ...renamed, defaultName }
            const rendered = renderProjectIdentityFile(
                '.env.dev.example',
                original,
                identity,
            )
            expect(await readWithBunEnvFile(rendered)).toBe('')
            expect(rendered).not.toContain(defaultName)
            expect(rendered).not.toContain('MAIL_FROM_NAME=')
            const manifest = renderProjectIdentityFile(
                'web/public/manifest.json',
                await source('web/public/manifest.json'),
                identity,
            )
            expect(JSON.parse(manifest)).toMatchObject({
                name: defaultName,
                short_name: defaultName,
            })
            const dockerfile = renderProjectIdentityFile(
                'Dockerfile',
                await source('Dockerfile'),
                identity,
            )
            expect(dockerfile).toContain(
                `MAIL_FROM_NAME="${doubleQuoted(defaultName)}"`,
            )
            expect(
                renderProjectIdentityFile(
                    '.env.dev.example',
                    rendered,
                    identity,
                ),
            ).toBe(rendered)
            const restored = renderProjectIdentityFile(
                '.env.dev.example',
                rendered,
                renamed,
            )
            expect(await readWithBunEnvFile(restored)).toBe('')
            expect(restored).toBe(
                renderProjectIdentityFile(
                    '.env.dev.example',
                    original,
                    renamed,
                ),
            )
        },
    )
})
