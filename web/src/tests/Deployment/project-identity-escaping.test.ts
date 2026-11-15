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

function dotenvQuoted(value: string) {
    return value.replace(/`/gu, '\\`').replace(/\$/gu, '\\$')
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
        expect(dotenv).toContain(
            `MAIL_FROM_NAME=\`${dotenvQuoted(renamed.defaultName)}\``,
        )
        const parsedDotenv = await readWithBunEnvFile(dotenv)
        expect(parsedDotenv).toBe(renamed.defaultName)

        expect(() =>
            renderProjectIdentityFile(
                '.github/workflows/release.yml',
                'name: Release',
                renamed,
            ),
        ).toThrow('nicht für Identitätssync freigegeben')
    })
})
