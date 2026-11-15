import { createTransport } from 'nodemailer'

import type { SendSmtpMailInput } from './Types/mail-client.types.ts'
import { getNormalizedMailEnv, getRequiredMailEnv } from './mailEnv.ts'

function getSmtpPort() {
    const port = Number(getNormalizedMailEnv('SMTP_PORT') ?? 587)

    if (!Number.isInteger(port)) {
        throw new Error('SMTP_PORT muss eine Zahl sein.')
    }

    return port
}

function getSmtpSecure() {
    return getNormalizedMailEnv('SMTP_SECURE') === 'true'
}

function getMailFrom() {
    const from = getRequiredMailEnv('MAIL_FROM')
    const fromName = getNormalizedMailEnv('MAIL_FROM_NAME')

    if (!fromName) {
        return from
    }

    return `"${fromName}" <${from}>`
}

function createMailTransporter() {
    const secure = getSmtpSecure()

    return createTransport({
        host: getRequiredMailEnv('SMTP_HOST'),
        port: getSmtpPort(),
        secure,
        requireTLS: !secure,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        tls: {
            minVersion: 'TLSv1.2',
        },
        auth: {
            user: getRequiredMailEnv('SMTP_USER'),
            pass: getRequiredMailEnv('SMTP_PASSWORD'),
        },
    })
}

export async function sendWithSmtp({
    to,
    subject,
    text,
    html,
}: SendSmtpMailInput) {
    const transporter = createMailTransporter()

    await transporter.sendMail({
        from: getMailFrom(),
        to,
        subject,
        text,
        html,
    })
}
