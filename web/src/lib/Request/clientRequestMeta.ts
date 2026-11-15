import type { ClientRequestMeta } from './Types/client-request-meta.types.ts'
import { getRequestHeader } from '@tanstack/react-start/server'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import { logWarn } from '@/server/Logging/logger.ts'
import { isRecord } from '@/lib/Validation/isRecord.ts'

const MAX_IP = 45
const MAX_LABEL = 255
const MAX_LOCATION = 255

export function getClientIp(): string | null {
    const internalProxySecret = process.env.INTERNAL_PROXY_SECRET
    const providedProxySecret = getRequestHeader('x-app-proxy-secret')
    const internalIp = getRequestHeader('x-app-client-ip')?.trim()

    if (internalProxySecret) {
        if (
            providedProxySecret === internalProxySecret &&
            internalIp &&
            isIP(internalIp)
        ) {
            return internalIp.slice(0, MAX_IP)
        }

        return null
    }

    return null
}

async function getClientLocation(ip: string | null): Promise<string | null> {
    if (!ip || isIP(ip) === 0) {
        return null
    }

    const cacheKey = `rentnerproxy-marketplace:ip-location:${createHash('sha256').update(ip).digest('hex')}`
    const valkey = process.env.VALKEY_URL ? getValkeyConnection() : null

    try {
        const cachedLocation = await valkey?.get(cacheKey)

        if (cachedLocation) {
            return cachedLocation === '__none__' ? null : cachedLocation
        }

        const response = await fetch(`https://freeipapi.com/api/json/${ip}`, {
            signal: AbortSignal.timeout(1_500),
        })
        if (!response.ok) {
            logWarn('client_location.lookup_failed', {
                status: response.status,
            })
            return null
        }
        const data: unknown = await response.json()
        if (!isRecord(data)) return null
        const cityName =
            typeof data.cityName === 'string' ? data.cityName : null
        const countryName =
            typeof data.countryName === 'string' ? data.countryName : null
        let location: string | null = null

        if (countryName && cityName) {
            location = `${cityName}, ${countryName}`.slice(0, MAX_LOCATION)
        } else if (countryName) {
            location = countryName.slice(0, MAX_LOCATION)
        }

        await valkey?.set(cacheKey, location ?? '__none__', 'EX', 24 * 60 * 60)
        return location
    } catch {
        logWarn('client_location.lookup_unavailable')
        return null
    }
}

function parseBrowserLabel(userAgent: string): string | null {
    const ua = userAgent.trim()
    if (ua === '') {
        return null
    }
    if (ua.includes('Edg/')) {
        return 'Microsoft Edge'
    }
    if (ua.includes('Firefox/')) {
        return 'Firefox'
    }
    if (ua.includes('Chrome/') && !ua.includes('Edg/')) {
        return 'Chrome'
    }
    if (ua.includes('Safari/') && !ua.includes('Chrome')) {
        return 'Safari'
    }
    if (ua.includes('Opera/') || ua.includes('OPR/')) {
        return 'Opera'
    }
    return ua.slice(0, MAX_LABEL)
}

function parseDeviceLabel(userAgent: string): string | null {
    const ua = userAgent.trim()
    if (ua === '') {
        return null
    }
    if (/iPhone/i.test(ua)) {
        return 'iPhone (iOS)'
    }
    if (/iPad/i.test(ua)) {
        return 'iPad (iOS)'
    }
    if (/Android/i.test(ua)) {
        return 'Android'
    }
    if (/Windows NT/i.test(ua)) {
        return 'Windows'
    }
    if (/Mac OS X|Macintosh/i.test(ua)) {
        return 'macOS'
    }
    if (/Linux/i.test(ua)) {
        return 'Linux'
    }
    if (/Mobile/i.test(ua)) {
        return 'Mobile'
    }
    return 'Desktop'
}

export async function getClientRequestMeta(): Promise<ClientRequestMeta> {
    const ua = getRequestHeader('user-agent') ?? ''
    const ip = getClientIp()
    const location = await getClientLocation(ip)
    return {
        ip: ip,
        device: parseDeviceLabel(ua),
        browser: parseBrowserLabel(ua),
        location: location,
    }
}
