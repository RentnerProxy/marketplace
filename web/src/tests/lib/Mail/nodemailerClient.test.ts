import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createTransport } from 'nodemailer'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { sendWithSmtp } from '@/lib/Mail/nodemailerClient.ts'

const mocks = (function () {
    return {
        environment: {
            MAIL_FROM: 'no-reply@example.test',
            MAIL_FROM_NAME: PROJECT_CONFIG.defaultName,
            SMTP_HOST: 'smtp.example.test',
            SMTP_PASSWORD: 'password',
            SMTP_PORT: '587',
            SMTP_SECURE: 'false',
            SMTP_USER: 'mailer',
        } as Record<string, string>,
        sendMail: vi.fn(async function () {}),
    }
})()

vi.mock('nodemailer', function () {
    return {
        createTransport: vi.fn(function () {
            return { sendMail: mocks.sendMail }
        }),
    }
})

vi.mock('@/lib/Mail/mailEnv.ts', function () {
    return {
        getNormalizedMailEnv: vi.fn(function (key: string) {
            return mocks.environment[key]
        }),
        getRequiredMailEnv: vi.fn(function (key: string) {
            const value = mocks.environment[key]

            if (!value) {
                throw new Error(`Missing ${key}`)
            }

            return value
        }),
    }
})

const mailInput = {
    to: 'kevin@example.test',
    subject: 'Test',
    text: 'Test',
    html: '<p>Test</p>',
}

describe('Nodemailer-Transport', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        mocks.environment.SMTP_SECURE = 'false'
    })

    it('erzwingt STARTTLS und begrenzte Netzwerk-Timeouts', async function () {
        await sendWithSmtp(mailInput)

        expect(createTransport).toHaveBeenCalledWith(
            expect.objectContaining({
                secure: false,
                requireTLS: true,
                connectionTimeout: 10_000,
                greetingTimeout: 10_000,
                socketTimeout: 30_000,
                tls: { minVersion: 'TLSv1.2' },
            }),
        )
    })

    it('verwendet bei SMTPS keinen zusätzlichen STARTTLS-Zwang', async function () {
        mocks.environment.SMTP_SECURE = 'true'

        await sendWithSmtp(mailInput)

        expect(createTransport).toHaveBeenCalledWith(
            expect.objectContaining({ secure: true, requireTLS: false }),
        )
    })
})
