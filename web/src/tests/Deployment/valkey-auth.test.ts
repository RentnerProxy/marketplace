import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { resolveValkeyUrlEnvironment } from '@/server/Runtime/valkey-environment.service.ts'
import {
    readValkeyHealthcheckFixture,
    readValkeyStartupFixture,
} from './compose-fixture.ts'

const startupSource = await readValkeyStartupFixture()
const healthcheckSource = await readValkeyHealthcheckFixture()
const shell =
    process.platform === 'win32'
        ? 'C:\\Program Files\\Git\\bin\\bash.exe'
        : existsSync('/bin/bash')
          ? '/bin/bash'
          : '/usr/bin/bash'
const shellTest = it.skipIf(!existsSync(shell))
const temporaryBase = resolve(tmpdir())
let fixtureDirectory: string | undefined

function shellPath(path: string) {
    const normalized = path.replaceAll('\\', '/')
    return process.platform === 'win32'
        ? normalized.replace(
              /^([a-z]):/iu,
              (_, drive: string) => '/' + drive.toLowerCase(),
          )
        : normalized
}

function ownedDirectory() {
    if (!fixtureDirectory) throw new Error('Missing synthetic shell fixture')
    const contained = relative(temporaryBase, fixtureDirectory)
    if (
        !contained ||
        contained === '..' ||
        contained.startsWith('..' + sep) ||
        isAbsolute(contained)
    ) {
        throw new Error('Unsafe synthetic shell fixture path')
    }
    return fixtureDirectory
}

beforeEach(async function () {
    if (!existsSync(shell)) return
    fixtureDirectory = await mkdtemp(join(temporaryBase, 'valkey-auth-test-'))
    const directory = ownedDirectory()
    await Promise.all(
        Object.entries({
            'valkey-server':
                '#!/bin/sh\nset -eu\n[ "$#" -eq 9 ] || exit 81\n[ -z "${VALKEY_PASSWORD:-}" ] || exit 82\ncmp -s "$1" "$EXPECTED_CONFIG" || exit 83\nshift\n[ "$*" = "--bind 127.0.0.1 --protected-mode yes --save  --maxmemory 256mb" ] || exit 86\nprintf "SERVER_STUB_CALLED\\n"\n',
            'valkey-cli':
                '#!/bin/sh\nset -eu\n[ "$VALKEYCLI_AUTH" = "$EXPECTED_VALKEY_AUTH" ] || exit 84\n[ "$*" = "--raw ping" ] || exit 85\nprintf "CLI_STUB_CALLED\\n" >&2\nprintf "%s" "$SYNTHETIC_REPLY"\nexit "$SYNTHETIC_CLI_STATUS"\n',
        }).map(([name, source]) =>
            writeFile(join(directory, name), source, { mode: 0o700 }),
        ),
    )
})

afterEach(async function () {
    if (!fixtureDirectory) return
    const directory = ownedDirectory()
    fixtureDirectory = undefined
    await rm(directory, { recursive: true, force: false })
})

async function executeSyntheticCommand(options: {
    password: string
    healthcheck?: boolean
    reply?: string
    cliStatus?: number
}) {
    const directory = ownedDirectory()
    const configuration = join(directory, 'valkey.conf')
    const expected = join(directory, 'expected.conf')
    const scriptPath = join(directory, 'startup.sh')
    const digest = createHash('sha256').update(options.password).digest('hex')
    await writeFile(
        expected,
        [`user default reset on #${digest} ~* &* +@all`, ''].join('\n'),
    )
    const source = options.healthcheck ? healthcheckSource : startupSource
    await writeFile(
        scriptPath,
        'export PATH="$SYNTHETIC_PATH"\n' +
            source.replaceAll(
                '/run/marketplace/valkey/valkey.conf',
                shellPath(configuration),
            ),
    )
    const result = spawnSync(
        shell,
        [
            '--noprofile',
            '--norc',
            shellPath(scriptPath),
            ...(options.healthcheck ? [] : ['valkey-server']),
        ],
        {
            cwd: directory,
            env: {
                VALKEY_PASSWORD: options.password,
                EXPECTED_VALKEY_AUTH: options.password,
                EXPECTED_CONFIG: shellPath(expected),
                SYNTHETIC_PATH:
                    shellPath(directory) +
                    ':' +
                    (process.platform === 'win32'
                        ? shellPath(join(dirname(shell), '..', 'usr', 'bin'))
                        : '/usr/bin:/bin'),
                SYNTHETIC_REPLY: options.reply ?? 'PONG\n',
                SYNTHETIC_CLI_STATUS: String(options.cliStatus ?? 0),
            },
            encoding: 'utf8',
            timeout: 5_000,
            maxBuffer: 8_192,
            windowsHide: true,
        },
    )
    if (result.error) throw result.error
    return {
        exitCode: result.status,
        serverCalled: result.stdout.includes('SERVER_STUB_CALLED'),
        cliCalled: result.stderr.includes('CLI_STUB_CALLED'),
        leakedCredential:
            Boolean(options.password) &&
            (result.stdout.includes(options.password) ||
                result.stderr.includes(options.password)),
        configuration: existsSync(configuration)
            ? await readFile(configuration, 'utf8')
            : undefined,
    }
}

describe('embedded Valkey authentication', function () {
    shellTest.each([
        'synthetic-password',
        'synthetic $() ; % "\' \\ unicode-ä-only',
    ])(
        'hashes the password exactly without shell injection, secret arguments or logging',
        async function (password) {
            const result = await executeSyntheticCommand({ password })
            expect(result.exitCode).toBe(0)
            expect(result.serverCalled).toBe(true)
            expect(result.leakedCredential).toBe(false)
            expect(result.configuration).not.toContain(password)
            const resolved = z.object({ VALKEY_URL: z.string() }).parse(
                resolveValkeyUrlEnvironment({
                    VALKEY_URL: 'redis://valkey:6379',
                    VALKEY_PASSWORD: password,
                }),
            )
            expect(
                decodeURIComponent(new URL(resolved.VALKEY_URL).password),
            ).toBe(password)
        },
    )

    shellTest(
        'rejects an absent password before starting the server',
        async function () {
            const result = await executeSyntheticCommand({ password: '' })
            expect(result.exitCode).not.toBe(0)
            expect(result.serverCalled).toBe(false)
        },
    )

    shellTest(
        'accepts only an authenticated PONG healthcheck',
        async function () {
            const result = await executeSyntheticCommand({
                password: 'synthetic-password',
                healthcheck: true,
            })
            expect(result.exitCode).toBe(0)
            expect(result.cliCalled).toBe(true)
            expect(result.leakedCredential).toBe(false)
        },
    )

    shellTest.each([
        { reply: '', cliStatus: 0 },
        { reply: 'NOAUTH Authentication required.\n', cliStatus: 0 },
        { reply: 'WRONGPASS Invalid credentials.\n', cliStatus: 0 },
        { reply: ' PONG\n', cliStatus: 0 },
        { reply: 'PONG \n', cliStatus: 0 },
        { reply: 'PONG\nNOAUTH\n', cliStatus: 0 },
        { reply: 'PONG\n', cliStatus: 1 },
    ])(
        'rejects unsuccessful CLI calls and non-PONG healthcheck replies',
        async function ({ reply, cliStatus }) {
            const result = await executeSyntheticCommand({
                password: 'synthetic-password',
                healthcheck: true,
                reply,
                cliStatus,
            })
            expect(result.exitCode).not.toBe(0)
            expect(result.cliCalled).toBe(true)
            expect(result.leakedCredential).toBe(false)
        },
    )
})
