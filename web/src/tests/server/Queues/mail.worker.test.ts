import type { Mock } from 'bun:test'
import { UnrecoverableError } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    sendFailedLoginAlertMail,
    sendSecurityChangeMail,
    sendPasswordResetMail,
    sendRegistrationVerificationMail,
    sendPasswordSetupMail,
} from '@/lib/Mail/mail.ts'
import { MAIL_QUEUE_NAME } from '@/server/Queues/mail.queue.ts'
import { createMailJobEnvelope } from '@/server/Queues/mail-payload.ts'
import { processMailJob } from '@/server/Queues/mail.worker.ts'
import { mailJobDataSchema } from '@/server/Queues/mail-job.schema.ts'
import { encryptAuthSecret } from '@/lib/Auth/secretEncryption.ts'
import { SECURITY_CHANGE_TYPES } from '@/lib/Mail/Templates/securityChangeMailTemplate.ts'
import type { AuthMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'

const restoreStateMocks = (function () {
    return {
        isActive: vi.fn(async function () {
            return false
        }),
    }
})()
const prepareResend = vi.fn<() => Promise<AuthMailInput | null>>()
vi.mock('@/server/Admin/StaffManagement/resendInvitation.service.ts', () => ({
    prepareStaffInvitationResendMailService: prepareResend,
}))

vi.mock('@/lib/Mail/mail.ts', function () {
    return {
        sendFailedLoginAlertMail: vi.fn(async function () {}),
        sendSecurityChangeMail: vi.fn(async function () {}),
        sendPasswordResetMail: vi.fn(async function () {}),
        sendRegistrationVerificationMail: vi.fn(async function () {}),
        sendPasswordSetupMail: vi.fn(async function () {}),
    }
})

vi.mock('@/server/Admin/Backups/restore-state.service.ts', function () {
    return { isRestoreStateActiveService: restoreStateMocks.isActive }
})

vi.mock('@/server/Queues/mail-restore-quiescence.service.ts', function () {
    return { createMailRestoreQuiescenceService: vi.fn() }
})

const mockedSendSecurityChangeMail = sendSecurityChangeMail as Mock<
    typeof sendSecurityChangeMail
>
const mockedSendFailedLoginAlertMail = sendFailedLoginAlertMail as Mock<
    typeof sendFailedLoginAlertMail
>
const mockedSendPasswordResetMail = sendPasswordResetMail as Mock<
    typeof sendPasswordResetMail
>
const mockedSendPasswordSetupMail = sendPasswordSetupMail as Mock<
    typeof sendPasswordSetupMail
>
const encryptionState = { key: Buffer.alloc(32, 9).toString('base64') }

vi.mock('@/server/Runtime/environment.service.ts', function () {
    return {
        getRequiredServerEnvironment: function (key: string) {
            if (key !== 'AUTH_ENCRYPTION_KEY')
                throw new Error('Unexpected test environment request')
            return encryptionState.key
        },
    }
})

const securityChangeMailData = {
    to: 'previous-contact@example.test',
    change: 'password_changed' as const,
    changedAt: '2026-09-06T01:02:03.004Z',
    auditEventId: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1',
}

const authMailData = {
    to: 'kevin@example.test',
    username: 'kevin',
    resetLink: 'https://app.example.test/password-reset?token=secret',
}

const failedLoginAlertData = {
    to: 'kevin@example.test',
    username: 'kevin',
    ip: '203.0.113.10',
    location: 'Berlin, Deutschland',
    device: 'Windows',
    browser: 'Chrome',
    attemptedAt: '11.07.2026, 10:30:00',
    mapsLink:
        'https://www.google.com/maps/search/?api=1&query=Berlin%2C%20Deutschland',
}

function createQueuedJob(name: string, data: unknown) {
    return {
        data,
        name,
        opts: { removeOnFail: true as boolean | number },
    }
}

describe('Mail-Worker-Dispatch', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        encryptionState.key = Buffer.alloc(32, 9).toString('base64')
        restoreStateMocks.isActive.mockResolvedValue(false)
    })

    it('nutzt eine versionierte Queue gegen gemischte Worker-Versionen', function () {
        expect(MAIL_QUEUE_NAME).toBe('rentnerproxy-marketplace-mail-v2')
    })

    it('dispatches encrypted registration verification mail', async () => {
        await processMailJob({
            name: 'registration-verification',
            data: await createMailJobEnvelope({
                ...authMailData,
                resetLink: 'https://app.example.test/register#verify=token',
                kind: 'registration-verification',
            }),
        })
        expect(sendRegistrationVerificationMail).toHaveBeenCalledTimes(1)
        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
        expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
    })

    it('sendet einen Reset-Job ausschließlich als Reset-Mail', async function () {
        await processMailJob({
            name: 'password-reset',
            data: await createMailJobEnvelope({
                ...authMailData,
                kind: 'password-reset',
            }),
        })

        expect(mockedSendPasswordResetMail).toHaveBeenCalledTimes(1)
        expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
        expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it('sendet bei aktivem Restore auch nach Valkey-Verlust keine Mail', async function () {
        restoreStateMocks.isActive.mockResolvedValue(true)

        await expect(
            processMailJob({
                name: 'password-reset',
                data: await createMailJobEnvelope({
                    ...authMailData,
                    kind: 'password-reset',
                }),
            }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')

        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
        expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
        expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it('sendet einen Setup-Job ausschließlich als Setup-Mail', async function () {
        await processMailJob({
            name: 'password-setup',
            data: await createMailJobEnvelope({
                ...authMailData,
                kind: 'password-setup',
            }),
        })

        expect(mockedSendPasswordSetupMail).toHaveBeenCalledTimes(1)
        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
        expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it('sends a committed resend and skips stale jobs through the encrypted queue', async () => {
        const data = {
            kind: 'staff-invitation-resend' as const,
            invitationId: '01941f29-7c00-7000-8000-000000000011',
            actorUserId: '01941f29-7c00-7000-8000-000000000012',
            previousTokenHash: 'a'.repeat(64),
            previousIsActive: true,
            tokenHash: 'b'.repeat(64),
            resetLink:
                'https://app.example.test/staff-invitation#invite=synthetic',
        }
        const mail = { ...authMailData, resetLink: data.resetLink }
        const job = { name: data.kind, data: await createMailJobEnvelope(data) }
        prepareResend
            .mockRejectedValueOnce(new Error('commit failed'))
            .mockResolvedValueOnce(mail)
            .mockResolvedValueOnce(null)
        await expect(processMailJob(job)).rejects.toThrow(
            'Mail-Job konnte nicht verarbeitet werden.',
        )
        expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
        await processMailJob(job)
        await processMailJob(job)
        expect(prepareResend).toHaveBeenCalledWith(data)
        expect(mockedSendPasswordSetupMail).toHaveBeenCalledTimes(1)
        expect(mockedSendPasswordSetupMail).toHaveBeenCalledWith(mail)
    })

    it('sendet einen Lockout-Job ausschließlich als Sicherheitswarnung', async function () {
        await processMailJob({
            name: 'failed-login-alert',
            data: await createMailJobEnvelope({
                ...failedLoginAlertData,
                kind: 'failed-login-alert',
            }),
        })

        expect(mockedSendFailedLoginAlertMail).toHaveBeenCalledTimes(1)
        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
        expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
    })

    it('lehnt unbekannte oder unvollständige Jobdaten ab', async function () {
        await expect(
            processMailJob({
                name: 'failed-login-alert',
                data: { version: 1, encryptedPayload: 'invalid' },
            }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')

        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
        expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
        expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it('akzeptiert weder Klartext noch andere Verschlüsselungsversionen', async function () {
        const plaintextPayload = JSON.stringify({
            ...authMailData,
            kind: 'password-reset',
        })

        await expect(
            processMailJob({
                name: 'password-reset',
                data: { version: 1, encryptedPayload: plaintextPayload },
            }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')
        await expect(
            processMailJob({
                name: 'password-reset',
                data: {
                    version: 1,
                    encryptedPayload: 'v2.aW52YWxpZA.aW52YWxpZA',
                },
            }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')

        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
    })

    it('lehnt einen widersprüchlichen Jobnamen ab', async function () {
        await expect(
            processMailJob({
                name: 'password-reset',
                data: await createMailJobEnvelope({
                    ...failedLoginAlertData,
                    kind: 'failed-login-alert',
                }),
            }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')

        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
        expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
        expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it('persistiert Reset-Token und PII nicht im Klartext im Queue-Payload', async function () {
        const envelope = await createMailJobEnvelope({
            ...authMailData,
            kind: 'password-reset',
        })

        expect(envelope.encryptedPayload).not.toContain('secret')
        expect(envelope.encryptedPayload).not.toContain('kevin@example.test')
    })

    it.each([
        { ...authMailData, kind: 'password-reset' as const },
        { ...authMailData, kind: 'password-setup' as const },
        { ...failedLoginAlertData, kind: 'failed-login-alert' as const },
        { ...securityChangeMailData, kind: 'security-change' as const },
    ])(
        'lehnt auch vollständig gültige Klartextjobs vom Typ $kind ab',
        async function (plaintextJob) {
            expect(mailJobDataSchema.safeParse(plaintextJob).success).toBe(true)
            const job = createQueuedJob(plaintextJob.kind, plaintextJob)

            await expect(processMailJob(job)).rejects.toMatchObject({
                message: 'Mail-Job konnte nicht verarbeitet werden.',
            })

            expect(job.opts.removeOnFail).toBe(true)
            expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
            expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
            expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
        },
    )

    it.each(['nonce', 'ciphertext', 'tag'] as const)(
        'authentisiert verschlüsselte v2-Jobs und lehnt manipulierte %s-Bytes ab',
        async function (part) {
            const envelope = await createMailJobEnvelope({
                ...authMailData,
                kind: 'password-reset',
            })
            const segments = envelope.encryptedPayload.split('.')
            const index = part === 'nonce' ? 1 : 2
            const bytes = Buffer.from(segments[index]!, 'base64url')
            const byteIndex = part === 'tag' ? bytes.length - 1 : 0
            bytes.writeUInt8(bytes.readUInt8(byteIndex) ^ 1, byteIndex)
            segments[index] = bytes.toString('base64url')

            await expect(
                processMailJob({
                    name: 'password-reset',
                    data: { ...envelope, encryptedPayload: segments.join('.') },
                }),
            ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')

            expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
            expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
            expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
        },
    )

    it('lehnt unter einem anderen Installationsschlüssel erzeugte v2-Jobs ab', async function () {
        const envelope = await createMailJobEnvelope({
            ...authMailData,
            kind: 'password-reset',
        })
        encryptionState.key = Buffer.alloc(32, 10).toString('base64')

        await expect(
            processMailJob({ name: 'password-reset', data: envelope }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')

        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
        expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
        expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it('prüft auch authentisierte Klartexte nach dem Entschlüsseln erneut gegen den Jobvertrag', async function () {
        const encryptedPayload = await encryptAuthSecret(
            JSON.stringify({ ...authMailData, kind: 'unknown' }),
        )

        await expect(
            processMailJob({
                name: 'unknown',
                data: { version: 1, encryptedPayload },
            }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')

        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
        expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
        expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it('behält Transportfehler im normalen Retry-Vertrag', async function () {
        const job = createQueuedJob(
            'password-reset',
            await createMailJobEnvelope({
                ...authMailData,
                kind: 'password-reset',
            }),
        )
        mockedSendPasswordResetMail.mockRejectedValueOnce(
            new Error('Test-Transportfehler'),
        )

        await expect(processMailJob(job)).rejects.toThrow(
            'Mail-Job konnte nicht verarbeitet werden.',
        )

        expect(job.opts.removeOnFail).toBe(true)
    })

    it('bereinigt SMTP-Fehler vor der BullMQ-Persistenz und erhält den Retry-Vertrag', async function () {
        const originalError = Object.assign(
            new Error('550 victim@example.test raw-token private-seed'),
            {
                code: 'EENVELOPE',
                responseCode: 550,
                response: '550 victim@example.test rejected',
                rejected: ['victim@example.test'],
                recipient: 'victim@example.test',
                command: 'RCPT TO:<victim@example.test>',
                cause: new Error('sql params: password-hash'),
            },
        )
        const job = createQueuedJob(
            'password-reset',
            await createMailJobEnvelope({
                ...authMailData,
                kind: 'password-reset',
            }),
        )
        mockedSendPasswordResetMail.mockRejectedValueOnce(originalError)

        let failure: unknown
        try {
            await processMailJob(job)
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(Error)
        expect(failure).not.toBe(originalError)
        expect(failure).not.toBeInstanceOf(UnrecoverableError)
        expect(failure).toMatchObject({
            message: 'Mail-Job konnte nicht verarbeitet werden.',
            code: 'EENVELOPE',
            responseCode: 550,
        })
        expect(failure).not.toHaveProperty('stack', expect.any(String))
        expect(failure).not.toHaveProperty('cause')
        expect(failure).not.toHaveProperty('response')
        expect(failure).not.toHaveProperty('recipient')
        expect(failure).not.toHaveProperty('rejected')
        expect(failure).not.toHaveProperty('command')
        expect(JSON.stringify(failure)).not.toContain('victim@example.test')
        expect(JSON.stringify(failure)).not.toContain('raw-token')
        expect(JSON.stringify(failure)).not.toContain('private-seed')
        expect(job.opts.removeOnFail).toBe(true)
        expect(mockedSendPasswordResetMail).toHaveBeenCalledTimes(1)
    })

    it('bereinigt auch Fehler der Restore-Prüfung vor einem Mailversand', async function () {
        restoreStateMocks.isActive.mockRejectedValueOnce(
            new Error('SQL params: victim@example.test hash-value'),
        )
        const job = createQueuedJob(
            'password-reset',
            await createMailJobEnvelope({
                ...authMailData,
                kind: 'password-reset',
            }),
        )

        await expect(processMailJob(job)).rejects.toMatchObject({
            message: 'Mail-Job konnte nicht verarbeitet werden.',
        })

        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
        expect(job.opts.removeOnFail).toBe(true)
    })

    it('serialisiert primitive und benutzerdefinierte Transportfehler nicht', async function () {
        const toString = vi.fn(function () {
            throw new Error(
                'Private Transportdaten dürfen nicht formatiert werden.',
            )
        })
        mockedSendPasswordResetMail.mockRejectedValueOnce({ toString })
        const job = createQueuedJob(
            'password-reset',
            await createMailJobEnvelope({
                ...authMailData,
                kind: 'password-reset',
            }),
        )

        await expect(processMailJob(job)).rejects.toMatchObject({
            message: 'Mail-Job konnte nicht verarbeitet werden.',
        })

        expect(toString).not.toHaveBeenCalled()
        expect(job.opts.removeOnFail).toBe(true)
    })

    it('weist unbekannte Klartextjobs ohne Stack oder fremde Payload im Fehler ab', async function () {
        const job = createQueuedJob('victim@example.test', {
            rawToken: 'private-token',
            seed: 'private-seed',
        })
        let failure: unknown
        try {
            await processMailJob(job)
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(Error)
        expect(failure).toMatchObject({
            message: 'Mail-Job konnte nicht verarbeitet werden.',
        })
        expect(failure).not.toHaveProperty('stack', expect.any(String))
        expect(failure).not.toHaveProperty('cause')
        expect(JSON.stringify(failure)).not.toContain('victim@example.test')
        expect(JSON.stringify(failure)).not.toContain('private-token')
        expect(JSON.stringify(failure)).not.toContain('private-seed')
        expect(job.opts.removeOnFail).toBe(true)
        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
        expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
        expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
    })

    it.each([...SECURITY_CHANGE_TYPES])(
        'sendet entschlüsselte Änderung %s ausschließlich als Sicherheitsmail',
        async function (change) {
            const input = { ...securityChangeMailData, change }
            await processMailJob({
                name: 'security-change',
                data: await createMailJobEnvelope({
                    ...input,
                    kind: 'security-change',
                }),
            })
            expect(mockedSendSecurityChangeMail).toHaveBeenCalledTimes(1)
            expect(mockedSendSecurityChangeMail).toHaveBeenCalledWith(input)
            expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
            expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
            expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
        },
    )

    it.each(['nonce', 'ciphertext', 'tag'] as const)(
        'weist manipulierte %s-Bytes einer Sicherheitsmail vor dem Versand ab',
        async function (part) {
            const envelope = await createMailJobEnvelope({
                ...securityChangeMailData,
                kind: 'security-change',
            })
            const segments = envelope.encryptedPayload.split('.')
            const index = part === 'nonce' ? 1 : 2
            const bytes = Buffer.from(segments[index]!, 'base64url')
            const byteIndex = part === 'tag' ? bytes.length - 1 : 0
            bytes.writeUInt8(bytes.readUInt8(byteIndex) ^ 1, byteIndex)
            segments[index] = bytes.toString('base64url')
            await expect(
                processMailJob({
                    name: 'security-change',
                    data: { ...envelope, encryptedPayload: segments.join('.') },
                }),
            ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')
            expect(mockedSendSecurityChangeMail).not.toHaveBeenCalled()
        },
    )

    it.each([
        { username: 'private-username' },
        { resetLink: 'https://app.example.test/reset?token=private-token' },
        { ip: '192.0.2.1' },
        { change: 'unknown' },
        { changedAt: '2026-02-29T01:02:03.004Z' },
        { auditEventId: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1\n' },
        { to: 'first@example.test,second@example.test' },
    ])(
        'validiert auch authentisierte Sicherheitsmail-Inhalte vor dem Versand erneut',
        async function (invalid) {
            const encryptedPayload = await encryptAuthSecret(
                JSON.stringify({
                    ...securityChangeMailData,
                    kind: 'security-change',
                    ...invalid,
                }),
            )
            await expect(
                processMailJob({
                    name: 'security-change',
                    data: { version: 1, encryptedPayload },
                }),
            ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')
            expect(mockedSendSecurityChangeMail).not.toHaveBeenCalled()
            expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
            expect(mockedSendPasswordSetupMail).not.toHaveBeenCalled()
            expect(mockedSendFailedLoginAlertMail).not.toHaveBeenCalled()
        },
    )

    it('verweigert Sicherheitsjobs mit abweichendem Jobnamen in beiden Richtungen', async function () {
        await expect(
            processMailJob({
                name: 'password-reset',
                data: await createMailJobEnvelope({
                    ...securityChangeMailData,
                    kind: 'security-change',
                }),
            }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')
        await expect(
            processMailJob({
                name: 'security-change',
                data: await createMailJobEnvelope({
                    ...authMailData,
                    kind: 'password-reset',
                }),
            }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')
        expect(mockedSendSecurityChangeMail).not.toHaveBeenCalled()
        expect(mockedSendPasswordResetMail).not.toHaveBeenCalled()
    })

    it('beachtet die vorhandene Restore-Barriere auch für Sicherheitsmails', async function () {
        restoreStateMocks.isActive.mockResolvedValue(true)
        await expect(
            processMailJob({
                name: 'security-change',
                data: await createMailJobEnvelope({
                    ...securityChangeMailData,
                    kind: 'security-change',
                }),
            }),
        ).rejects.toThrow('Mail-Job konnte nicht verarbeitet werden.')
        expect(mockedSendSecurityChangeMail).not.toHaveBeenCalled()
    })

    it('bereinigt Sicherheitsmail-SMTPfehler vor BullMQ-Persistenz und erhält Retries', async function () {
        mockedSendSecurityChangeMail.mockRejectedValueOnce(
            Object.assign(
                new Error(
                    'previous-contact@example.test private-token private-seed',
                ),
                {
                    code: 'EENVELOPE',
                    responseCode: 550,
                    recipient: 'previous-contact@example.test',
                    response: '550 private recipient',
                    cause: new Error('private credential hash'),
                },
            ),
        )
        let failure: unknown
        try {
            await processMailJob({
                name: 'security-change',
                data: await createMailJobEnvelope({
                    ...securityChangeMailData,
                    kind: 'security-change',
                }),
            })
        } catch (error) {
            failure = error
        }
        expect(failure).toBeInstanceOf(Error)
        expect(failure).not.toBeInstanceOf(UnrecoverableError)
        expect(failure).toMatchObject({
            message: 'Mail-Job konnte nicht verarbeitet werden.',
            code: 'EENVELOPE',
            responseCode: 550,
        })
        expect(failure).not.toHaveProperty('recipient')
        expect(failure).not.toHaveProperty('response')
        expect(failure).not.toHaveProperty('cause')
        expect(failure).not.toHaveProperty('stack', expect.any(String))
        expect(JSON.stringify(failure)).not.toContain(
            'previous-contact@example.test',
        )
        expect(JSON.stringify(failure)).not.toContain('private-')
        expect(mockedSendSecurityChangeMail).toHaveBeenCalledTimes(1)
    })
})
