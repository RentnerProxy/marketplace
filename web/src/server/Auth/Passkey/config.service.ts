import { PROJECT_CONFIG } from '@/config/app.config.ts'

function getPasskeyOrigin() {
    return (
        process.env.PASSKEY_ORIGIN?.trim() ||
        process.env.ORIGIN?.trim() ||
        'http://localhost:3000'
    ).replace(/\/$/, '')
}

export function getPasskeyConfig() {
    const origin = getPasskeyOrigin()

    return {
        rpName:
            process.env.PASSKEY_RP_NAME?.trim() || PROJECT_CONFIG.defaultName,
        rpID: process.env.PASSKEY_RP_ID?.trim() || new URL(origin).hostname,
        origin,
    }
}
