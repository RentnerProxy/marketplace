import { describe, expect, it, vi } from 'bun:test'
import {
    validateAppProductionEnvironment,
    validateBackupWorkerEnvironment,
    validateMailWorkerEnvironment,
} from '@/server/Runtime/environment.service.ts'

function createValidAppEnvironment() {
    return {
        APP_STORAGE_DIR: '/app/storage/public',
        AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        BACKUP_DIR: '/app/backups',
        DATABASE_URL: 'postgresql://app:secret@db/app',
        MAIL_FROM: 'no-reply@example.com',
        ORIGIN: 'https://app.example.com',
        VALKEY_URL: 'rediss://:synthetic-runtime-password@localhost:6380/0',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PASSWORD: 'secret',
        SMTP_PORT: '587',
        SMTP_SECURE: 'false',
        SMTP_USER: 'mailer@example.com',
        TRUST_PROXY_HEADERS: 'true',
        TRUSTED_PROXY_RANGES: '192.0.2.10/32',
        VITE_APP_VERSION: '1.2.3',
    }
}

function createValidMailWorkerEnvironmentWithoutSmtpDefaults() {
    return {
        AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        MAIL_FROM: 'no-reply@example.com',
        VALKEY_URL: 'rediss://:synthetic-runtime-password@localhost:6380/0',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PASSWORD: 'secret',
        SMTP_USER: 'mailer@example.com',
    }
}

describe('Production-Environment', function () {
    it('validates provider credentials as complete optional groups at startup', () => {
        const environment = createValidAppEnvironment()
        const configured = validateAppProductionEnvironment({
            ...environment,
            OAUTH_GOOGLE_CLIENT_ID: 'fixture-client',
            OAUTH_GOOGLE_CLIENT_SECRET: 'fixture-secret',
        })
        expect(configured.OAUTH_GOOGLE_CLIENT_ID).toBe('fixture-client')
        for (const provider of ['GOOGLE', 'GITHUB', 'DISCORD']) {
            expect(() =>
                validateAppProductionEnvironment({
                    ...environment,
                    [`OAUTH_${provider}_CLIENT_ID`]: 'fixture-client',
                }),
            ).toThrow(new RegExp(`OAUTH_${provider}_CLIENT_SECRET`))
        }
    })

    it('verwirft ungültige Origins ohne rohe Fehler oder Eingaben zu protokollieren', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
        try {
            expect(() =>
                validateAppProductionEnvironment({
                    ...createValidAppEnvironment(),
                    ORIGIN: 'invalid-person@example.test',
                }),
            ).toThrow(/ORIGIN/)
            expect(spy).not.toHaveBeenCalled()
        } finally {
            spy.mockRestore()
        }
    })

    it.each([
        undefined,
        '',
        'invalid-key',
        Buffer.alloc(31, 7).toString('base64'),
    ])(
        'verlangt auch für den Backup-Worker einen gültigen Herkunftsschlüssel (%s)',
        function (key) {
            expect(() =>
                validateBackupWorkerEnvironment({
                    ...createValidAppEnvironment(),
                    AUTH_ENCRYPTION_KEY: key,
                }),
            ).toThrow(/AUTH_ENCRYPTION_KEY/)
        },
    )

    it('akzeptiert eine vollständige App-Konfiguration', function () {
        expect(() =>
            validateAppProductionEnvironment(createValidAppEnvironment()),
        ).not.toThrow()
    })

    it.each([
        ['wss://realtime.example.test/ws', 'wss://realtime.example.test/ws'],
        [
            'WSS://REALTIME.EXAMPLE.TEST:443/ws',
            'wss://realtime.example.test/ws',
        ],
    ])(
        'validiert die öffentliche WebSocket-Konfiguration auch vor dem Produktionsstart',
        function (configuredUrl, expected) {
            const validated = validateAppProductionEnvironment({
                ...createValidAppEnvironment(),
                VITE_REALTIME_WS_URL: configuredUrl,
            })
            expect(validated.VITE_REALTIME_WS_URL).toBe(expected)
        },
    )

    it.each([
        'ws://realtime.example.test/ws',
        'wss://user:synthetic@realtime.example.test/ws',
        'wss://realtime.example.test/ws?synthetic=value',
        'wss://*.example.test/ws',
        'wss://realtime.example.test/ws;script-src',
        ' wss://realtime.example.test/ws',
    ])(
        'verweigert unsichere öffentliche WebSocket-Werte an der Runtimegrenze',
        function (configuredUrl) {
            expect(() =>
                validateAppProductionEnvironment({
                    ...createValidAppEnvironment(),
                    VITE_REALTIME_WS_URL: configuredUrl,
                }),
            ).toThrow(/VITE_REALTIME_WS_URL/)
        },
    )

    it.each([undefined, ''])(
        'erhält den optionalen leeren Docker-WebSocket-Default',
        function (value) {
            const validated = validateAppProductionEnvironment({
                ...createValidAppEnvironment(),
                VITE_REALTIME_WS_URL: value,
            })
            expect(validated.VITE_REALTIME_WS_URL).toBeUndefined()
        },
    )

    it('übernimmt normalisierte Werte in die laufende Prozessumgebung', function () {
        const environment = {
            ...createValidAppEnvironment(),
            APP_STORAGE_DIR: '  /app/storage/public  ',
            ORIGIN: '  https://app.example.com  ',
        }
        const keys = [
            ...Object.keys(environment),
            'BACKUP_TIMEZONE',
            'PASSKEY_ORIGIN',
            'PASSKEY_RP_ID',
            'PASSKEY_RP_NAME',
            'TRUSTED_PROXY_RANGES',
            'VITE_REALTIME_WS_URL',
        ]
        const previousValues = new Map(
            keys.map((key) => [key, process.env[key]] as const),
        )

        try {
            for (const key of keys) {
                delete process.env[key]
            }
            Object.assign(process.env, environment)

            validateAppProductionEnvironment()

            expect(process.env.ORIGIN).toBe('https://app.example.com')
            expect(process.env.APP_STORAGE_DIR).toBe('/app/storage/public')
        } finally {
            for (const [key, value] of previousValues) {
                if (value === undefined) {
                    delete process.env[key]
                } else {
                    process.env[key] = value
                }
            }
        }
    })

    it('benötigt Mail-Secrets nur im Worker-Prozess', function () {
        const environment = createValidAppEnvironment()

        for (const key of [
            'MAIL_FROM',
            'SMTP_HOST',
            'SMTP_PASSWORD',
            'SMTP_PORT',
            'SMTP_SECURE',
            'SMTP_USER',
        ]) {
            delete environment[key as keyof typeof environment]
        }

        expect(() =>
            validateAppProductionEnvironment(environment),
        ).not.toThrow()
        expect(() => validateMailWorkerEnvironment(environment)).toThrow()
    })

    it('setzt fehlende SMTP-Transportwerte auf sichere Standards', function () {
        const validated = validateMailWorkerEnvironment(
            createValidMailWorkerEnvironmentWithoutSmtpDefaults(),
        )

        expect(validated.SMTP_PORT).toBe('587')
        expect(validated.SMTP_SECURE).toBe('false')
    })

    it('setzt leere SMTP-Transportwerte auf sichere Standards', function () {
        const validated = validateMailWorkerEnvironment({
            ...createValidMailWorkerEnvironmentWithoutSmtpDefaults(),
            SMTP_PORT: '   ',
            SMTP_SECURE: '',
        })

        expect(validated.SMTP_PORT).toBe('587')
        expect(validated.SMTP_SECURE).toBe('false')
    })

    it('übernimmt SMTP-Standards in die laufende Prozessumgebung', function () {
        const environment =
            createValidMailWorkerEnvironmentWithoutSmtpDefaults()
        const keys = [...Object.keys(environment), 'SMTP_PORT', 'SMTP_SECURE']
        const previousValues = new Map(
            keys.map((key) => [key, process.env[key]] as const),
        )

        try {
            for (const key of keys) {
                delete process.env[key]
            }
            Object.assign(process.env, environment)

            validateMailWorkerEnvironment()

            expect(process.env.SMTP_PORT).toBe('587')
            expect(process.env.SMTP_SECURE).toBe('false')
        } finally {
            for (const [key, value] of previousValues) {
                if (value === undefined) {
                    delete process.env[key]
                } else {
                    process.env[key] = value
                }
            }
        }
    })

    it('kodiert das optionale Valkey-Passwort und entfernt den Rohwert aus dem Prozess', function () {
        const environment = {
            ...createValidAppEnvironment(),
            VALKEY_PASSWORD: 'p@ss word',
            VALKEY_URL: 'redis://valkey:6379',
        }
        const previousEnvironment = { ...process.env }

        try {
            Object.assign(process.env, environment)
            validateAppProductionEnvironment()

            expect(process.env.VALKEY_URL).toBe(
                'redis://:p%40ss%20word@valkey:6379',
            )
            expect(process.env.VALKEY_PASSWORD).toBeUndefined()
        } finally {
            process.env = previousEnvironment
        }
    })

    it.each([
        ['DATABASE_URL', 'mysql://db/app'],
        ['VALKEY_URL', 'https://valkey.example.com'],
        ['ORIGIN', 'https://app.example.com/'],
        ['ORIGIN', 'https://app.example.com/login'],
        ['ORIGIN', 'https://app.example.com?tenant=one'],
        ['ORIGIN', 'http://app.example.com'],
    ])('lehnt den ungültigen Wert für %s ab', function (key, value) {
        expect(() =>
            validateAppProductionEnvironment({
                ...createValidAppEnvironment(),
                [key]: value,
            }),
        ).toThrow()
    })

    it.each([
        ['SMTP_PORT', '0'],
        ['SMTP_PORT', '65536'],
        ['SMTP_PORT', '58.7'],
        ['SMTP_SECURE', 'yes'],
        ['MAIL_FROM', 'kein-postfach'],
    ])('validiert die SMTP-Einstellung %s', function (key, value) {
        expect(() =>
            validateMailWorkerEnvironment({
                ...createValidAppEnvironment(),
                [key]: value,
            }),
        ).toThrow()
    })

    it('validiert Passkey-Origin und RP-ID gemeinsam', function () {
        expect(() =>
            validateAppProductionEnvironment({
                ...createValidAppEnvironment(),
                PASSKEY_ORIGIN: 'https://login.example.com',
                PASSKEY_RP_ID: 'example.com',
            }),
        ).not.toThrow()
        expect(() =>
            validateAppProductionEnvironment({
                ...createValidAppEnvironment(),
                PASSKEY_ORIGIN: 'https://login.example.com',
                PASSKEY_RP_ID: 'attacker.example',
            }),
        ).toThrow(/PASSKEY_RP_ID/)
    })

    it.each([
        ['BACKUP_TIMEZONE', 'Mars/Olympus'],
        ['BACKUP_POSTGRES_TIMEOUT_SECONDS', '59'],
        ['BACKUP_POSTGRES_TIMEOUT_SECONDS', '14401'],
        ['BACKUP_POSTGRES_TIMEOUT_SECONDS', '1.5'],
        ['BACKUP_DIR', ''],
        ['BACKUP_DIR', '   '],
    ])('validiert die Backup-Einstellung %s', function (key, value) {
        expect(() =>
            validateBackupWorkerEnvironment({
                ...createValidAppEnvironment(),
                [key]: value,
            }),
        ).toThrow()
    })

    it.each([
        'local=/mnt/local',
        'archive=/mnt/archive',
        'nas=/mnt/nas;local=/mnt/local',
        'nas=/mnt/nas;archive=/mnt/archive',
        'invalid',
        'local=',
        '=path',
        'local=/a;local=/b',
    ])(
        'verweigert BACKUP_TARGETS ohne verpflichtendes BACKUP_DIR (%s)',
        function (backupTargets) {
            const { BACKUP_DIR: _backupDirectory, ...legacyEnvironment } =
                createValidAppEnvironment()
            const environment = {
                ...legacyEnvironment,
                BACKUP_TARGETS: backupTargets,
            }

            expect(() => validateBackupWorkerEnvironment(environment)).toThrow(
                /BACKUP_DIR/,
            )
            expect(() => validateAppProductionEnvironment(environment)).toThrow(
                /BACKUP_DIR/,
            )
        },
    )

    it.each(['local=/mnt/local', 'kein-gueltiger-eintrag'])(
        'ignoriert BACKUP_TARGETS bei gültigem BACKUP_DIR (%s)',
        function (backupTargets) {
            const environment = {
                ...createValidAppEnvironment(),
                BACKUP_DIR: '  /app/backups  ',
                BACKUP_TARGETS: backupTargets,
            }
            const backupWorkerEnvironment =
                validateBackupWorkerEnvironment(environment)
            const appEnvironment = validateAppProductionEnvironment(environment)

            expect(backupWorkerEnvironment.BACKUP_DIR).toBe('/app/backups')
            expect(appEnvironment.BACKUP_DIR).toBe('/app/backups')
            expect(backupWorkerEnvironment).not.toHaveProperty('BACKUP_TARGETS')
            expect(appEnvironment).not.toHaveProperty('BACKUP_TARGETS')
        },
    )

    it.each([undefined, '', '   '])(
        'fordert ein nichtleeres BACKUP_DIR (%s)',
        function (backupDirectory) {
            const environment = {
                ...createValidAppEnvironment(),
                BACKUP_DIR: backupDirectory,
                BACKUP_TARGETS: 'local=/mnt/local',
            }

            expect(() => validateBackupWorkerEnvironment(environment)).toThrow(
                /BACKUP_DIR/,
            )
            expect(() => validateAppProductionEnvironment(environment)).toThrow(
                /BACKUP_DIR/,
            )
        },
    )

    it('fordert bei aktivierten Proxy-Headern eine gültige Allowlist', function () {
        const environment = {
            ...createValidAppEnvironment(),
            TRUST_PROXY_HEADERS: 'true',
            TRUSTED_PROXY_RANGES: undefined,
        }

        expect(() => validateAppProductionEnvironment(environment)).toThrow(
            /TRUSTED_PROXY_RANGES/,
        )
        expect(() =>
            validateAppProductionEnvironment({
                ...environment,
                TRUSTED_PROXY_RANGES: '10.0.0.0/99',
            }),
        ).toThrow(/TRUSTED_PROXY_RANGES/)
        expect(() =>
            validateAppProductionEnvironment({
                ...environment,
                TRUSTED_PROXY_RANGES: '10.0.0.0/8, 2001:db8::/32',
            }),
        ).not.toThrow()
    })

    it.each([undefined, 'false'])(
        'akzeptiert eine öffentliche HTTPS-Origin ohne Proxyheader-Vertrauen (%s)',
        (trustProxyHeaders) => {
            const environment = validateAppProductionEnvironment({
                ...createValidAppEnvironment(),
                TRUST_PROXY_HEADERS: trustProxyHeaders,
                TRUSTED_PROXY_RANGES: undefined,
            })
            expect(environment.TRUST_PROXY_HEADERS).toBe('false')
            expect(environment.ORIGIN).toBe('https://app.example.com')
        },
    )

    it.each(['http://localhost:3000', 'http://127.0.0.1:3000'])(
        'erhält ausdrücklich lokalen Direktbetrieb für %s',
        (origin) => {
            expect(() =>
                validateAppProductionEnvironment({
                    ...createValidAppEnvironment(),
                    ORIGIN: origin,
                    TRUST_PROXY_HEADERS: 'false',
                    TRUSTED_PROXY_RANGES: undefined,
                }),
            ).not.toThrow()
        },
    )

    it.each(['http://127.4.3.2:3000', 'http://[::1]:3000'])(
        'erfordert für bisherige IP-Origins ohne passende CSP-Quelle einen ausdrücklichen WebSocket-Override',
        function (origin) {
            const environment = {
                ...createValidAppEnvironment(),
                ORIGIN: origin,
                TRUST_PROXY_HEADERS: 'false',
                TRUSTED_PROXY_RANGES: undefined,
            }
            expect(() => validateAppProductionEnvironment(environment)).toThrow(
                /Realtime-CSP/,
            )
            expect(() =>
                validateAppProductionEnvironment({
                    ...environment,
                    VITE_REALTIME_WS_URL: 'ws://localhost:3000/ws',
                }),
            ).not.toThrow()
        },
    )

    it.each([
        '0.0.0.0/0',
        '::/0',
        '127.0.0.1,',
        ',127.0.0.1',
        '127.0.0.1,,::1',
    ])(
        'verweigert eine universelle oder unvollständige Proxy-Allowlist %s',
        (ranges) => {
            expect(() =>
                validateAppProductionEnvironment({
                    ...createValidAppEnvironment(),
                    TRUSTED_PROXY_RANGES: ranges,
                }),
            ).toThrow(/TRUSTED_PROXY_RANGES/)
        },
    )

    it('ignoriert keine Allowlist bei deaktivierten Proxy-Headern', () => {
        expect(() =>
            validateAppProductionEnvironment({
                ...createValidAppEnvironment(),
                ORIGIN: 'http://localhost:3000',
                TRUST_PROXY_HEADERS: 'false',
            }),
        ).toThrow(/TRUSTED_PROXY_RANGES/)
    })

    it.each(['ftp://localhost', 'ws://localhost:3000', 'ftp://127.0.0.1'])(
        'erlaubt auch für lokale Passkeys nur HTTP(S): %s',
        (origin) => {
            expect(() =>
                validateAppProductionEnvironment({
                    ...createValidAppEnvironment(),
                    PASSKEY_ORIGIN: origin,
                }),
            ).toThrow(/PASSKEY_ORIGIN/)
        },
    )
    it('validiert Mail- und Backup-Worker prozessspezifisch', function () {
        const environment = createValidAppEnvironment()

        expect(() =>
            validateMailWorkerEnvironment({
                AUTH_ENCRYPTION_KEY: environment.AUTH_ENCRYPTION_KEY,
                MAIL_FROM: environment.MAIL_FROM,
                VALKEY_URL: environment.VALKEY_URL,
                SMTP_HOST: environment.SMTP_HOST,
                SMTP_PASSWORD: environment.SMTP_PASSWORD,
                SMTP_PORT: environment.SMTP_PORT,
                SMTP_SECURE: environment.SMTP_SECURE,
                SMTP_USER: environment.SMTP_USER,
            }),
        ).not.toThrow()
        expect(() =>
            validateBackupWorkerEnvironment({
                AUTH_ENCRYPTION_KEY: environment.AUTH_ENCRYPTION_KEY,
                APP_STORAGE_DIR: environment.APP_STORAGE_DIR,
                BACKUP_DIR: environment.BACKUP_DIR,
                DATABASE_URL: environment.DATABASE_URL,
                VALKEY_URL: environment.VALKEY_URL,
                VITE_APP_VERSION: environment.VITE_APP_VERSION,
            }),
        ).not.toThrow()
    })
})

describe.each([
    ['app', validateAppProductionEnvironment],
    ['mail worker', validateMailWorkerEnvironment],
    ['backup worker', validateBackupWorkerEnvironment],
] as const)(
    '%s Valkey authentication boundary',
    function (_, validateEnvironment) {
        it.each([
            undefined,
            '',
            'redis://localhost:6379/0',
            'rediss://synthetic-user:@localhost:6380/4',
            'redis://synthetic-user:%20%20@localhost:6379/0',
        ])(
            'rejects missing effective authentication before startup',
            function (url) {
                expect(() =>
                    validateEnvironment({
                        ...createValidAppEnvironment(),
                        VALKEY_URL: url,
                    }),
                ).toThrow()
            },
        )

        it('accepts a complete authenticated URL without a separate password', function () {
            const url =
                'rediss://synthetic-user:synthetic-password@localhost:6380/4'
            const validated = validateEnvironment({
                ...createValidAppEnvironment(),
                VALKEY_URL: url,
            })

            expect(validated.VALKEY_URL).toBe(url)
        })

        it('resolves a raw override before enforcing authentication', function () {
            const password = 'synthetic-ä-漢字-🔐 @:/?#%+'
            const validated = validateEnvironment({
                ...createValidAppEnvironment(),
                VALKEY_URL: 'rediss://synthetic-user@localhost:6380/4',
                VALKEY_PASSWORD: password,
            })
            const url = new URL(validated.VALKEY_URL)

            expect(decodeURIComponent(url.password)).toBe(password)
            expect(url.password).toBe(encodeURIComponent(password))
            expect(url.username).toBe('synthetic-user')
            expect(url.protocol).toBe('rediss:')
            expect(url.hostname).toBe('localhost')
            expect(url.port).toBe('6380')
            expect(url.pathname).toBe('/4')
        })

        it('keeps the separate password authoritative over embedded credentials', function () {
            const validated = validateEnvironment({
                ...createValidAppEnvironment(),
                VALKEY_URL:
                    'rediss://synthetic-user:embedded-password@localhost:6380/4',
                VALKEY_PASSWORD: 'synthetic-override',
            })

            expect(
                decodeURIComponent(new URL(validated.VALKEY_URL).password),
            ).toBe('synthetic-override')
        })
    },
)
