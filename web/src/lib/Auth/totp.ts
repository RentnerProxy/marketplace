import * as OTPAuth from 'otpauth'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { TOTP_POLICY } from '@/config/security.config.ts'
import { db } from '@/db'
import { systemSettings } from '@/db/schema.ts'

async function getTotpIssuer() {
    const settingsRows = await db
        .select({ companyName: systemSettings.companyName })
        .from(systemSettings)
        .limit(1)
    const companyName = settingsRows[0]?.companyName.trim()

    return companyName || PROJECT_CONFIG.defaultName
}

export function createTotpSecret() {
    return new OTPAuth.Secret({ size: 20 }).base32
}

export async function createTotp(secret: string, label: string) {
    return new OTPAuth.TOTP({
        issuer: await getTotpIssuer(),
        label,
        algorithm: TOTP_POLICY.algorithm,
        digits: TOTP_POLICY.digits,
        period: TOTP_POLICY.periodSeconds,
        secret,
    })
}

export function getTotpCodeStep(secret: string, token: string) {
    if (!/^\d{6}$/.test(token)) {
        return null
    }

    const timestamp = Date.now()
    const totp = new OTPAuth.TOTP({
        algorithm: TOTP_POLICY.algorithm,
        digits: TOTP_POLICY.digits,
        period: TOTP_POLICY.periodSeconds,
        secret,
    })
    const delta = totp.validate({
        token,
        timestamp,
        window: TOTP_POLICY.window,
    })

    return delta === null ? null : totp.counter({ timestamp }) + delta
}
