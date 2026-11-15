import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { validateProjectIdentity } from '@/scripts/Project/identity-validation.ts'
import { readComposeFixture } from './compose-fixture.ts'

const project = validateProjectIdentity(PROJECT_CONFIG)
const compose = await readComposeFixture()
const example = await readFile(
    new URL('../../../../.env.example', import.meta.url),
    'utf8',
)
const dockerfile = await readFile(
    new URL('../../../../Dockerfile', import.meta.url),
    'utf8',
)

describe('self-contained appliance deployment', function () {
    test('requires only one image, one env file and the two requested mounts', function () {
        expect(compose).toEqual({
            services: {
                [project.id]: {
                    image: project.imageRepository + ':latest',
                    restart: 'unless-stopped',
                    init: true,
                    stop_grace_period: '4h10m',
                    ports: ['${APP_PORT:-6600}:3000'],
                    env_file: ['.env'],
                    volumes: [
                        project.id + '_data:/data',
                        '${BACKUP_PATH:-./backups}:/data/backups',
                    ],
                },
            },
            volumes: { [project.id + '_data']: null },
        })
    })

    test('keeps exactly the requested public configuration', function () {
        const keys = Array.from(
            example.matchAll(/^([A-Z_]+)=/gmu),
            ([, key]) => key,
        )
        expect(keys.toSorted()).toEqual([
            'APP_PORT',
            'AUTH_ENCRYPTION_KEY',
            'BACKUP_PATH',
            'MAIL_FROM',
            'ORIGIN',
            'POSTGRES_PASSWORD',
            'POSTGRES_USER',
            'SMTP_HOST',
            'SMTP_PASSWORD',
            'SMTP_PORT',
            'SMTP_SECURE',
            'SMTP_USER',
        ])
        expect(example).toContain('BACKUP_PATH=./backups')
        expect(example).not.toContain('APP_ORIGIN')
    })

    test('packages the server, tools and fixed private targets without a host control socket', function () {
        expect(dockerfile).toContain(
            'apk add --no-cache postgresql18 postgresql18-client su-exec',
        )
        for (const assignment of [
            'POSTGRES_HOST=127.0.0.1',
            'POSTGRES_PORT=5432',
            'POSTGRES_DB=' + project.databaseName,
            'BACKUP_DIR=/data/backups',
            'APP_STORAGE_DIR=/data/storage/public',
            'APP_PRIVATE_STORAGE_DIR=/data/storage/private',
            'VALKEY_URL=redis://127.0.0.1:6379',
        ])
            expect(dockerfile).toContain(assignment)
        expect(JSON.stringify(compose)).not.toContain('docker.sock')
        expect(dockerfile).toContain('--start-period=5m')
    })
})
