import { isIP } from 'node:net'
import type {
    ParsedIpAddress,
    TrustedProxyRange,
    TrustedProxyRequest,
} from './Types/trusted-proxy.types.ts'

function trimHeaderWhitespace(value: string) {
    return value.replace(/^[ \t]+|[ \t]+$/g, '')
}

function parseIpv4Address(value: string): ParsedIpAddress {
    return {
        bytes: value.split('.').map(Number),
        version: 4,
    }
}

function parseIpv6Address(value: string): ParsedIpAddress {
    let normalizedValue = value
    const ipv4Suffix = value.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1]

    if (ipv4Suffix) {
        const ipv4Bytes = parseIpv4Address(ipv4Suffix).bytes
        const high = (ipv4Bytes[0] << 8) | ipv4Bytes[1]
        const low = (ipv4Bytes[2] << 8) | ipv4Bytes[3]
        normalizedValue = value.slice(0, -ipv4Suffix.length)
        normalizedValue += `${high.toString(16)}:${low.toString(16)}`
    }

    const compressedParts = normalizedValue.split('::')
    const leftParts = compressedParts[0] ? compressedParts[0].split(':') : []
    const rightParts = compressedParts[1] ? compressedParts[1].split(':') : []
    const omittedPartCount =
        compressedParts.length === 2
            ? 8 - leftParts.length - rightParts.length
            : 0
    const parts = [
        ...leftParts,
        ...Array.from({ length: omittedPartCount }, function () {
            return '0'
        }),
        ...rightParts,
    ]

    return {
        bytes: parts.flatMap(function (part) {
            const number = Number.parseInt(part, 16)
            return [number >> 8, number & 0xff]
        }),
        version: 6,
    }
}

function parseIpAddress(value: string): ParsedIpAddress | null {
    if (value.length > 64) return null

    const normalizedValue = trimHeaderWhitespace(value)
    const version = isIP(normalizedValue)

    if (version === 4) {
        return parseIpv4Address(normalizedValue)
    }

    if (version === 6 && !normalizedValue.includes('%')) {
        return parseIpv6Address(normalizedValue)
    }

    return null
}

function normalizeMappedAddress(address: ParsedIpAddress): ParsedIpAddress {
    if (
        address.version === 6 &&
        address.bytes.slice(0, 10).every((byte) => byte === 0) &&
        address.bytes[10] === 0xff &&
        address.bytes[11] === 0xff
    ) {
        return { bytes: address.bytes.slice(12), version: 4 }
    }
    return address
}

function formatIpAddress(address: ParsedIpAddress) {
    if (address.version === 4) return address.bytes.join('.')

    const parts: Array<string> = []
    for (let index = 0; index < address.bytes.length; index += 2) {
        parts.push(
            ((address.bytes[index] << 8) | address.bytes[index + 1]).toString(
                16,
            ),
        )
    }

    let longestStart = -1
    let longestLength = 1
    for (let index = 0; index < parts.length;) {
        if (parts[index] !== '0') {
            index += 1
            continue
        }
        const start = index
        while (index < parts.length && parts[index] === '0') index += 1
        if (index - start > longestLength) {
            longestStart = start
            longestLength = index - start
        }
    }

    if (longestStart < 0) return parts.join(':')
    const left = parts.slice(0, longestStart).join(':')
    const right = parts.slice(longestStart + longestLength).join(':')
    return `${left}::${right}`
}

function getNetworkBytes(address: ParsedIpAddress, prefixLength: number) {
    return address.bytes.map(function (byte, index) {
        const remainingBits = prefixLength - index * 8
        if (remainingBits >= 8) return byte
        if (remainingBits <= 0) return 0
        return byte & ((0xff << (8 - remainingBits)) & 0xff)
    })
}

export function parseTrustedProxyRanges(
    value: string,
): Array<TrustedProxyRange> {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 4096
    ) {
        throw new Error('TRUSTED_PROXY_RANGES ist leer oder zu lang.')
    }

    const entries = value.split(',').map(trimHeaderWhitespace)
    if (entries.length > 64 || entries.some((entry) => entry.length === 0)) {
        throw new Error(
            'TRUSTED_PROXY_RANGES enthält leere oder zu viele Einträge.',
        )
    }

    return entries.map(function (entry): TrustedProxyRange {
        const [addressValue, prefixValue, ...additionalParts] = entry.split('/')
        const address = parseIpAddress(addressValue ?? '')

        if (
            !address ||
            additionalParts.length > 0 ||
            addressValue !== trimHeaderWhitespace(addressValue ?? '')
        ) {
            throw new Error(
                'TRUSTED_PROXY_RANGES enthält eine ungültige IP-Adresse.',
            )
        }

        const maximumPrefixLength = address.version === 4 ? 32 : 128
        let prefixLength =
            prefixValue === undefined
                ? maximumPrefixLength
                : Number(prefixValue)

        if (
            !Number.isInteger(prefixLength) ||
            prefixLength <= 0 ||
            prefixLength > maximumPrefixLength ||
            (prefixValue !== undefined &&
                (prefixValue.length === 0 ||
                    prefixValue.length > 3 ||
                    /[^0-9]/.test(prefixValue)))
        ) {
            throw new Error(
                'TRUSTED_PROXY_RANGES enthält einen ungültigen CIDR-Präfix.',
            )
        }

        const normalizedAddress = normalizeMappedAddress(address)
        if (normalizedAddress.version !== address.version) {
            if (prefixLength <= 96) {
                throw new Error(
                    'TRUSTED_PROXY_RANGES enthält ein zu weites IPv4-Mapped-Netz.',
                )
            }
            prefixLength -= 96
        }

        return {
            bytes: getNetworkBytes(normalizedAddress, prefixLength),
            version: normalizedAddress.version,
            prefixLength,
        }
    })
}

export function isTrustedProxyIp(
    value: string | null | undefined,
    ranges: ReadonlyArray<TrustedProxyRange>,
): boolean {
    if (typeof value !== 'string') return false
    const parsedAddress = parseIpAddress(value)
    if (!parsedAddress) return false
    const address = normalizeMappedAddress(parsedAddress)

    return ranges.some(function (range) {
        if (range.version !== address.version) return false

        const fullBytes = Math.floor(range.prefixLength / 8)
        const remainingBits = range.prefixLength % 8
        for (let index = 0; index < fullBytes; index += 1) {
            if (range.bytes[index] !== address.bytes[index]) return false
        }
        if (remainingBits === 0) return true

        const mask = (0xff << (8 - remainingBits)) & 0xff
        return (
            (range.bytes[fullBytes] & mask) ===
            (address.bytes[fullBytes] & mask)
        )
    })
}

export function getValidatedClientIpService(
    value: string | null | undefined,
): string | null {
    if (typeof value !== 'string') return null
    const address = parseIpAddress(value)
    return address ? formatIpAddress(normalizeMappedAddress(address)) : null
}

export function isLoopbackIpService(value: string | null | undefined): boolean {
    const address = getValidatedClientIpService(value)
    return address === '::1' || address?.startsWith('127.') === true
}

export function isLoopbackOriginService(value: URL): boolean {
    if (value.hostname === 'localhost') return true
    const hostname =
        value.hostname.startsWith('[') && value.hostname.endsWith(']')
            ? value.hostname.slice(1, -1)
            : value.hostname
    return isLoopbackIpService(hostname)
}

export function resolveTrustedProxyClientIp(
    request: TrustedProxyRequest,
    ranges: ReadonlyArray<TrustedProxyRange>,
): string | null {
    const directIp = getValidatedClientIpService(request.directIp)
    if (!directIp || !isTrustedProxyIp(directIp, ranges)) return null

    const forwardedFor = request.forwardedFor
    if (
        typeof forwardedFor !== 'string' ||
        forwardedFor.length === 0 ||
        forwardedFor.length > 2048
    ) {
        return null
    }
    const entries = forwardedFor.split(',')
    if (entries.length > 16) return null

    const addresses: Array<string> = []
    for (const entry of entries) {
        const address = getValidatedClientIpService(entry)
        if (!address) return null
        addresses.push(address)
    }

    for (let index = addresses.length - 1; index >= 0; index -= 1) {
        const address = addresses[index]
        if (!isTrustedProxyIp(address, ranges)) return address
    }
    return addresses[0] ?? null
}

export function getTrustedForwardedProtocol(
    value: string | null | undefined,
): 'http' | 'https' | null {
    if (typeof value !== 'string' || value.length > 16) {
        return null
    }
    const protocol = trimHeaderWhitespace(value)
    return protocol === 'http' || protocol === 'https' ? protocol : null
}
