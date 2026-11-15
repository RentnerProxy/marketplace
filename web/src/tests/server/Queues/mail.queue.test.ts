import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    enqueueFailedLoginAlertMail,
    enqueueSecurityChangeMail,
    enqueuePasswordResetMail,
    enqueuePasswordSetupMail,
    MAIL_QUEUE_NAME,
} from '@/server/Queues/mail.queue.ts'
import { readMailJobEnvelope } from '@/server/Queues/mail-payload.ts'
import { SECURITY_CHANGE_TYPES } from '@/lib/Mail/Templates/securityChangeMailTemplate.ts'

const bullMqMocks = (function () {
    return {
        add: vi.fn(async function (
            _name: string,
            _data: unknown,
            _options?: unknown,
        ) {}),
        connection: { host: 'isolated-test-valkey' },
        getConnectionOptions: vi.fn(),
        queueConstructor: vi.fn(),
    }
})()

vi.mock('bullmq', function () {
    return {
        Queue: class {
            constructor(name: string, options: unknown) {
                bullMqMocks.queueConstructor(name, options)
            }

            async add(...args: Parameters<typeof bullMqMocks.add>) {
                await bullMqMocks.add(...args)
            }
        },
    }
})

vi.mock('@/server/Valkey/valkey.service.ts', function () {
    bullMqMocks.getConnectionOptions.mockReturnValue(bullMqMocks.connection)

    return {
        getBullMqProducerConnectionOptions: bullMqMocks.getConnectionOptions,
    }
})

const getEncryptionKey = vi.fn((key: string) => {
    if (key !== 'AUTH_ENCRYPTION_KEY') {
        throw new Error('Unexpected test environment request')
    }
    return Buffer.alloc(32, 7).toString('base64')
})
vi.mock('@/server/Runtime/environment.service.ts', function () {
    return { getRequiredServerEnvironment: getEncryptionKey }
})
const resetMail = {
    resetLink: 'https://app.example.test/password-reset?token=secret',
    to: 'reset@example.test',
    username: 'reset-user',
}
const setupMail = {
    resetLink: 'https://app.example.test/password-setup?token=secret',
    to: 'setup@example.test',
    username: 'setup-user',
}
const failedLoginAlertMail = {
    attemptedAt: '2026-07-15T10:00:00.000Z',
    browser: 'Firefox',
    device: 'Desktop',
    ip: '203.0.113.10',
    location: 'Berlin, Deutschland',
    mapsLink: 'https://maps.example.test/?q=Berlin',
    to: 'alert@example.test',
    username: 'alert-user',
}

describe('Mail-Queue-Producer', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        globalThis.appMailQueueV2 = undefined
    })

    it('validiert und verschlüsselt alle Mailtypen über eine konfigurierte Queue-Instanz', async function () {
        await enqueuePasswordResetMail(resetMail)
        await enqueuePasswordSetupMail(setupMail)
        await enqueueFailedLoginAlertMail(failedLoginAlertMail)

        expect(bullMqMocks.queueConstructor).toHaveBeenCalledTimes(1)
        expect(bullMqMocks.queueConstructor).toHaveBeenCalledWith(
            MAIL_QUEUE_NAME,
            {
                connection: bullMqMocks.connection,
                defaultJobOptions: {
                    attempts: 5,
                    backoff: {
                        delay: 5_000,
                        type: 'exponential',
                    },
                    removeOnComplete: 1_000,
                    removeOnFail: 1_000,
                },
            },
        )
        expect(bullMqMocks.getConnectionOptions).toHaveBeenCalledTimes(1)
        expect(bullMqMocks.add).toHaveBeenCalledTimes(3)

        const expectedJobs = [
            {
                data: { ...resetMail, kind: 'password-reset' },
                name: 'password-reset',
            },
            {
                data: { ...setupMail, kind: 'password-setup' },
                name: 'password-setup',
            },
            {
                data: {
                    ...failedLoginAlertMail,
                    kind: 'failed-login-alert',
                },
                name: 'failed-login-alert',
            },
        ] as const

        await Promise.all(
            bullMqMocks.add.mock.calls.map(async function (call, index) {
                const [name, envelope] = call
                const expectedJob = expectedJobs[index]

                expect(name).toBe(expectedJob?.name)
                expect(envelope).not.toEqual(expectedJob?.data)
                await expect(readMailJobEnvelope(envelope)).resolves.toEqual(
                    expectedJob?.data,
                )
            }),
        )
    })

    it('weist ungültige Daten vor Queue-Erzeugung und Schreibzugriff zurück', async function () {
        await expect(
            enqueuePasswordResetMail({
                ...resetMail,
                to: 'keine-mailadresse',
            }),
        ).rejects.toThrow()

        expect(bullMqMocks.queueConstructor).not.toHaveBeenCalled()
        expect(bullMqMocks.add).not.toHaveBeenCalled()
    })

    it.each([...SECURITY_CHANGE_TYPES])(
        'verschlüsselt Sicherheitsänderung %s mit zufälliger UUID und unveränderten Retrydefaults',
        async function (change) {
            const input = {
                to: 'previous-contact@example.test',
                change,
                changedAt: '2026-09-06T01:02:03.004Z',
                auditEventId: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1',
            }
            await enqueueSecurityChangeMail(input)

            expect(bullMqMocks.add).toHaveBeenCalledTimes(1)
            const [name, envelope, options] =
                bullMqMocks.add.mock.calls[0] ?? []
            expect(name).toBe('security-change')
            expect(options).toEqual({ jobId: expect.any(String) })
            const jobId =
                typeof options === 'object' && options !== null
                    ? Reflect.get(options, 'jobId')
                    : undefined
            expect(jobId).toMatch(
                /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
            )
            expect(jobId).not.toBe(input.auditEventId)
            expect(envelope).toEqual({
                version: 1,
                encryptedPayload: expect.any(String),
            })
            const serialized = JSON.stringify(envelope)
            expect(serialized).not.toContain(input.to)
            expect(serialized).not.toContain(input.auditEventId)
            expect(serialized).not.toContain(input.changedAt)
            expect(serialized).not.toContain(input.change)
            await expect(readMailJobEnvelope(envelope)).resolves.toEqual({
                ...input,
                kind: 'security-change',
            })
            expect(bullMqMocks.queueConstructor).toHaveBeenCalledWith(
                'rentnerproxy-marketplace-mail-v2',
                {
                    connection: bullMqMocks.connection,
                    defaultJobOptions: {
                        attempts: 5,
                        backoff: { delay: 5_000, type: 'exponential' },
                        removeOnComplete: 1_000,
                        removeOnFail: 1_000,
                    },
                },
            )
        },
    )

    it('verwendet neue Job-UUIDs auch für identische Benachrichtigungsdaten', async function () {
        const input = {
            to: 'previous-contact@example.test',
            change: 'password_changed' as const,
            changedAt: '2026-09-06T01:02:03.004Z',
            auditEventId: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1',
        }
        await enqueueSecurityChangeMail(input)
        await enqueueSecurityChangeMail(input)
        expect(bullMqMocks.add).toHaveBeenCalledTimes(2)
        expect(bullMqMocks.add.mock.calls[0]?.[2]).not.toEqual(
            bullMqMocks.add.mock.calls[1]?.[2],
        )
        expect(bullMqMocks.add.mock.calls[0]?.[1]).not.toEqual(
            bullMqMocks.add.mock.calls[1]?.[1],
        )
    })

    it.each([
        { to: 'invalid-address' },
        { to: 'x'.repeat(256) + '@example.test' },
        { change: 'private@example.test' },
        { changedAt: '2026-02-29T01:02:03.004Z' },
        { auditEventId: 'private-token' },
        { username: 'must-not-be-included' },
        { resetLink: 'https://app.example.test/reset?token=synthetic' },
        { kind: 'password-reset' },
    ])(
        'weist ungültigen neuen Input vor Verschlüsselung oder Queuezugriff zurück',
        async function (invalid) {
            const input = {
                to: 'previous-contact@example.test',
                change: 'password_changed',
                changedAt: '2026-09-06T01:02:03.004Z',
                auditEventId: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1',
                ...invalid,
            }
            await expect(
                Reflect.apply(enqueueSecurityChangeMail, undefined, [input]),
            ).rejects.toThrow()
            expect(bullMqMocks.queueConstructor).not.toHaveBeenCalled()
            expect(bullMqMocks.add).not.toHaveBeenCalled()
            expect(bullMqMocks.getConnectionOptions).not.toHaveBeenCalled()
            expect(getEncryptionKey).not.toHaveBeenCalled()
        },
    )

    it('gibt einen Addfehler zurück ohne einen zweiten Enqueueversuch', async function () {
        const failure = new Error('synthetic queue failure')
        bullMqMocks.add.mockRejectedValueOnce(failure)
        await expect(
            enqueueSecurityChangeMail({
                to: 'previous-contact@example.test',
                change: 'passkey_added',
                changedAt: '2026-09-06T01:02:03.004Z',
                auditEventId: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1',
            }),
        ).rejects.toBe(failure)
        expect(bullMqMocks.add).toHaveBeenCalledTimes(1)
    })
})
