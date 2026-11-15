import { describe, expect, it } from 'bun:test'
import { SECURITY_CHANGE_TYPES } from '@/lib/Mail/Templates/securityChangeMailTemplate.ts'
import {
    mailJobDataSchema,
    securityChangeMailInputSchema,
} from '@/server/Queues/mail-job.schema.ts'

const input = {
    to: 'previous-contact@example.test',
    change: 'password_changed' as const,
    changedAt: '2026-09-06T01:02:03.004Z',
    auditEventId: '6a2f66ea-63cc-4aaf-b682-08296d5d57f1',
}
const job = { ...input, kind: 'security-change' as const }

describe('Security-change Mailvertrag', () => {
    it.each([...SECURITY_CHANGE_TYPES])(
        'akzeptiert ausschließlich den festen Änderungstyp %s',
        (change) => {
            expect(
                securityChangeMailInputSchema.parse({ ...input, change }),
            ).toEqual({
                ...input,
                change,
            })
            expect(mailJobDataSchema.parse({ ...job, change })).toEqual({
                ...job,
                change,
            })
        },
    )

    it.each([
        '',
        'unknown',
        'password-reset',
        '__proto__',
        'constructor',
        'PASSWORD_CHANGED',
        'password_changed\n',
        'private@example.test',
        null,
        1,
    ])('verwirft unbekannte Änderungswerte', (change) => {
        expect(mailJobDataSchema.safeParse({ ...job, change }).success).toBe(
            false,
        )
    })

    it.each([
        '2026-09-06T01:02:03Z',
        '2026-09-06T01:02:03.00Z',
        '2026-09-06T01:02:03.0000Z',
        '2026-09-06T01:02:03.004z',
        '2026-09-06T01:02:03.004Z\n',
        '2026-09-06T01:02:03.004+00:00',
        '2026-09-06T03:02:03.004+02:00',
        '2026-02-29T01:02:03.004Z',
        '2024-02-30T01:02:03.004Z',
        '2026-04-31T01:02:03.004Z',
        '2026-00-06T01:02:03.004Z',
        '2026-13-06T01:02:03.004Z',
        '2026-09-00T01:02:03.004Z',
        '2026-09-06T24:02:03.004Z',
        '2026-09-06T01:60:03.004Z',
        '2026-09-06T01:02:60.004Z',
        'NaN',
        null,
        0,
    ])(
        'verwirft nichtkanonische oder unmögliche Auditzeitpunkte',
        (changedAt) => {
            expect(
                mailJobDataSchema.safeParse({ ...job, changedAt }).success,
            ).toBe(false)
        },
    )

    it('erhält gültige Schaltjahre und den unveränderten historischen Auditzeitpunkt', () => {
        const changedAt = '2024-02-29T23:59:59.999Z'
        expect(mailJobDataSchema.parse({ ...job, changedAt })).toEqual({
            ...job,
            changedAt,
        })
    })

    it.each([
        '',
        'recipient@example.test,second@example.test',
        'recipient@example.test\r\nBcc: second@example.test',
        'https://example.test',
        null,
    ])('verwirft ungültige oder mehrere Empfänger', (to) => {
        expect(mailJobDataSchema.safeParse({ ...job, to }).success).toBe(false)
    })

    it('verweigert eine Empfängerliste als tatsächlichen Feldwert', () => {
        expect(
            mailJobDataSchema.safeParse({
                ...job,
                to: ['recipient@example.test'],
            }).success,
        ).toBe(false)
    })

    it('begrenzt die einzelne Kontaktadresse auf 255 Zeichen', () => {
        const address =
            'a'.repeat(64) +
            '@' +
            'b'.repeat(63) +
            '.' +
            'c'.repeat(63) +
            '.' +
            'd'.repeat(59) +
            '.de'
        expect(address.length).toBe(255)
        expect(
            mailJobDataSchema.safeParse({ ...job, to: address }).success,
        ).toBe(true)
        const tooLong = address.replace('.de', 'd.de')
        expect(tooLong.length).toBe(256)
        expect(
            mailJobDataSchema.safeParse({ ...job, to: tooLong }).success,
        ).toBe(false)
    })

    it.each([
        '',
        'private@example.test',
        '6a2f66ea-63cc-4aaf-b682-08296d5d57f1\n',
        '6a2f66ea-63cc-4aaf-b682-08296d5d57f',
        '6a2f66ea-63cc-4aaf-0682-08296d5d57f1',
        null,
        0,
    ])('verwirft ungültige Audit-UUIDs', (auditEventId) => {
        expect(
            mailJobDataSchema.safeParse({ ...job, auditEventId }).success,
        ).toBe(false)
    })

    it.each([
        'username',
        'resetLink',
        'ip',
        'secret',
        'token',
        'passwordHash',
        'sessionHash',
        '__proto__',
        'constructor',
    ])(
        'verweigert Zusatzfeld %s statt es in den neuen Job zu übernehmen',
        (field) => {
            expect(
                mailJobDataSchema.safeParse({
                    ...job,
                    [field]: 'must-not-enter-queue',
                }).success,
            ).toBe(false)
            expect(
                securityChangeMailInputSchema.safeParse({
                    ...input,
                    [field]: 'must-not-enter-queue',
                }).success,
            ).toBe(false)
        },
    )

    it('nimmt am Producer-Eingang auch keinen fremden oder vorgegebenen kind entgegen', () => {
        expect(securityChangeMailInputSchema.safeParse(job).success).toBe(false)
        expect(
            securityChangeMailInputSchema.safeParse({
                ...input,
                kind: 'password-reset',
            }).success,
        ).toBe(false)
    })

    it.each(['to', 'change', 'changedAt', 'auditEventId'])(
        'verlangt das Snapshotfeld %s',
        (field) => {
            const incomplete = { ...job }
            Reflect.deleteProperty(incomplete, field)
            expect(mailJobDataSchema.safeParse(incomplete).success).toBe(false)
        },
    )

    it('erhält die bisherigen drei Jobverträge einschließlich ihrer bisherigen Normalisierung', () => {
        for (const kind of ['password-reset', 'password-setup'] as const) {
            expect(
                mailJobDataSchema.parse({
                    kind,
                    to: ' contact@example.test ',
                    username: ' user ',
                    resetLink: 'https://app.example.test/reset?token=synthetic',
                    legacyExtra: 'ignored-by-existing-contract',
                }),
            ).toEqual({
                kind,
                to: 'contact@example.test',
                username: 'user',
                resetLink: 'https://app.example.test/reset?token=synthetic',
            })
        }
        const failed = {
            kind: 'failed-login-alert' as const,
            to: 'contact@example.test',
            username: 'user',
            ip: null,
            location: null,
            device: null,
            browser: null,
            attemptedAt: '06.09.2026, 01:02:03',
            mapsLink: null,
        }
        expect(mailJobDataSchema.parse(failed)).toEqual(failed)
    })
})
