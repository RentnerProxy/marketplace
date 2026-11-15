import { afterEach, describe, expect, it } from 'bun:test'
import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'
import {
    readValkeyPasswordFileService,
    waitForValkeyPasswordFileService,
} from '@/server/Runtime/valkey-password-file.service.ts'
import { resolveValkeyUrlEnvironment } from '@/server/Runtime/valkey-environment.service.ts'
import {
    validateAppProductionEnvironment,
    validateBackupWorkerEnvironment,
    validateMailWorkerEnvironment,
} from '@/server/Runtime/environment.service.ts'

const temporaryBase = resolve(tmpdir())
const directories: string[] = []

function fixture(contents?: string | Buffer) {
    const directory = mkdtempSync(
        join(temporaryBase, 'valkey-password-file-test-'),
    )
    directories.push(directory)
    const file = join(directory, 'valkey-password')
    if (contents !== undefined) writeFileSync(file, contents, { mode: 0o600 })
    return { directory, file }
}

afterEach(function () {
    for (const directory of directories.splice(0)) {
        if (
            !resolve(directory).startsWith(
                temporaryBase + sep + 'valkey-password-file-test-',
            )
        ) {
            throw new Error('Unsafe credential fixture cleanup')
        }
        rmSync(directory, { recursive: true, force: true })
    }
})

describe('Valkey credential file', function () {
    it.each([undefined, '', '   '])(
        'leaves an absent path optional',
        function (path) {
            expect(readValkeyPasswordFileService(path)).toBeUndefined()
        },
    )

    it.each(['synthetic-ä-漢字 @:/?#%+\\"', ' synthetic boundary spaces '])(
        'encodes a file password exactly once and accepts one final newline',
        function (password) {
            const { file } = fixture(password + '\n')
            const resolved = z.object({ VALKEY_URL: z.string() }).parse(
                resolveValkeyUrlEnvironment({
                    VALKEY_URL: 'rediss://synthetic-user@localhost:6380/4',
                    VALKEY_PASSWORD_FILE: file,
                }),
            )
            expect(new URL(resolved.VALKEY_URL).password).toBe(
                encodeURIComponent(password),
            )
            expect(new URL(resolved.VALKEY_URL).username).toBe('synthetic-user')
            expect(new URL(resolved.VALKEY_URL).pathname).toBe('/4')
        },
    )

    it('preserves raw overrides and does not require the internal file for legacy configurations', function () {
        const { file } = fixture()
        const resolved = z.object({ VALKEY_URL: z.string() }).parse(
            resolveValkeyUrlEnvironment({
                VALKEY_URL: 'redis://:embedded-password@localhost:6379',
                VALKEY_PASSWORD: 'synthetic-override',
                VALKEY_PASSWORD_FILE: file,
            }),
        )
        expect(decodeURIComponent(new URL(resolved.VALKEY_URL).password)).toBe(
            'synthetic-override',
        )
    })

    it('uses the file before embedded credentials when a raw override is absent', function () {
        const { file } = fixture('synthetic-file-password')
        const resolved = z.object({ VALKEY_URL: z.string() }).parse(
            resolveValkeyUrlEnvironment({
                VALKEY_URL: 'redis://:embedded-password@localhost:6379',
                VALKEY_PASSWORD: '',
                VALKEY_PASSWORD_FILE: file,
            }),
        )
        expect(decodeURIComponent(new URL(resolved.VALKEY_URL).password)).toBe(
            'synthetic-file-password',
        )
    })

    it.each([
        '',
        '   ',
        'synthetic\npassword',
        'synthetic\u0000password',
        'x'.repeat(4097),
    ])(
        'fails closed for invalid file contents even with valid embedded credentials',
        function (password) {
            const { file } = fixture(password)
            expect(() =>
                resolveValkeyUrlEnvironment({
                    VALKEY_URL: 'redis://:embedded-password@localhost:6379',
                    VALKEY_PASSWORD_FILE: file,
                }),
            ).toThrow()
        },
    )

    it.each([Buffer.alloc(16_387, 7), Buffer.from([0xff])])(
        'rejects oversized or invalid UTF-8 files without exposing their contents',
        function (contents) {
            const { file } = fixture(contents)
            expect(() => readValkeyPasswordFileService(file)).toThrow(
                /VALKEY_PASSWORD_FILE/,
            )
        },
    )

    it('rejects missing files, directories and relative paths', function () {
        const { directory, file } = fixture()
        expect(() => readValkeyPasswordFileService(file)).toThrow(
            /VALKEY_PASSWORD_FILE/,
        )
        expect(() => readValkeyPasswordFileService(directory)).toThrow(
            /VALKEY_PASSWORD_FILE/,
        )
        expect(() =>
            readValkeyPasswordFileService('relative-password'),
        ).toThrow(/VALKEY_PASSWORD_FILE/)
    })

    it.skipIf(process.platform === 'win32')(
        'rejects symlinks instead of following them',
        function () {
            const { directory, file } = fixture('synthetic-password')
            const link = join(directory, 'password-link')
            symlinkSync(file, link)
            expect(() => readValkeyPasswordFileService(link)).toThrow(
                /VALKEY_PASSWORD_FILE/,
            )
        },
    )

    it('waits for atomic initial publication without connecting to Valkey', async function () {
        const { file } = fixture()
        const writer = (async function () {
            await Bun.sleep(20)
            writeFileSync(file, 'synthetic-bootstrap-password', { mode: 0o600 })
        })()
        await waitForValkeyPasswordFileService(
            { VALKEY_PASSWORD_FILE: file },
            1_000,
        )
        await writer
        expect(readValkeyPasswordFileService(file)).toBe(
            'synthetic-bootstrap-password',
        )
    })

    it('bounds the wait for a missing file and rejects invalid existing entries immediately', async function () {
        const { file } = fixture()
        await expect(
            waitForValkeyPasswordFileService({ VALKEY_PASSWORD_FILE: file }, 1),
        ).rejects.toThrow(/rechtzeitig/)
        mkdirSync(file)
        await expect(
            waitForValkeyPasswordFileService({ VALKEY_PASSWORD_FILE: file }),
        ).rejects.toThrow(/geladen/)
    })

    it('does not wait for a file when legacy credentials are supplied', async function () {
        const { file } = fixture()
        await expect(
            waitForValkeyPasswordFileService({
                VALKEY_PASSWORD: 'synthetic-override',
                VALKEY_PASSWORD_FILE: file,
            }),
        ).resolves.toBeUndefined()
    })
})

describe.each([
    ['app', validateAppProductionEnvironment],
    ['mail worker', validateMailWorkerEnvironment],
    ['backup worker', validateBackupWorkerEnvironment],
] as const)('%s file credential boundary', function (_, validate) {
    it('resolves the same private credential before validating the runtime', function () {
        const { file } = fixture('synthetic-file-password')
        const environment = {
            APP_STORAGE_DIR: '/app/storage/public',
            BACKUP_DIR: '/app/backups',
            AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
            DATABASE_URL: 'postgresql://app:synthetic@db/app_test',
            ORIGIN: 'https://app.example.test',
            TRUST_PROXY_HEADERS: 'true',
            TRUSTED_PROXY_RANGES: '192.0.2.10/32',
            VITE_APP_VERSION: '1.2.3',
            VALKEY_URL: 'redis://valkey:6379',
            VALKEY_PASSWORD_FILE: file,
            SMTP_HOST: 'smtp.example.test',
            SMTP_USER: 'no-reply@example.test',
            SMTP_PASSWORD: 'synthetic',
            MAIL_FROM: 'no-reply@example.test',
        }
        expect(
            decodeURIComponent(
                new URL(validate(environment).VALKEY_URL).password,
            ),
        ).toBe('synthetic-file-password')
        expect(environment.VALKEY_URL).toBe('redis://valkey:6379')
    })
})
