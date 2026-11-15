import { describe, expect, it } from 'bun:test'
import {
    getTrustedForwardedProtocol,
    getValidatedClientIpService,
    isLoopbackIpService,
    isLoopbackOriginService,
    isTrustedProxyIp,
    parseTrustedProxyRanges,
    resolveTrustedProxyClientIp,
} from '@/server/Request/trustedProxy.service.ts'

describe('Trusted Proxy CIDR-Allowlist', function () {
    it('erhält IPv4/IPv6-Netze, Hostbits und einzelne Adressen', function () {
        const ranges = parseTrustedProxyRanges(
            ' 127.0.0.1, 10.16.7.42/13, 2001:db8:abcd:ffff::1/49 ',
        )
        for (const address of [
            '127.0.0.1',
            '10.16.0.0',
            '10.23.255.255',
            '2001:db8:abcd:8000::',
            '2001:db8:abcd:ffff:ffff:ffff:ffff:ffff',
        ]) {
            expect(isTrustedProxyIp(address, ranges)).toBe(true)
        }
        for (const address of [
            '127.0.0.2',
            '10.15.255.255',
            '10.24.0.0',
            '2001:db8:abcd:7fff::1',
            '2001:db8:abce::1',
        ]) {
            expect(isTrustedProxyIp(address, ranges)).toBe(false)
        }
        expect(isTrustedProxyIp(null, ranges)).toBe(false)
        expect(isTrustedProxyIp('ungültig', ranges)).toBe(false)
        expect(isTrustedProxyIp('127.0.0.1', [])).toBe(false)
    })

    it('normalisiert mapped IPv6 für Allowlist und Socket ohne neue IP-Identität', function () {
        const ipv4Ranges = parseTrustedProxyRanges('192.0.2.0/24')
        const mappedRanges = parseTrustedProxyRanges('::ffff:192.0.2.199/120')
        for (const ranges of [ipv4Ranges, mappedRanges]) {
            expect(isTrustedProxyIp('192.0.2.10', ranges)).toBe(true)
            expect(isTrustedProxyIp('::ffff:192.0.2.10', ranges)).toBe(true)
            expect(isTrustedProxyIp('0:0:0:0:0:FFFF:C000:020A', ranges)).toBe(
                true,
            )
            expect(isTrustedProxyIp('192.0.3.10', ranges)).toBe(false)
            expect(isTrustedProxyIp('::192.0.2.10', ranges)).toBe(false)
            expect(isTrustedProxyIp('64:ff9b::192.0.2.10', ranges)).toBe(false)
        }
        const singleMapped = parseTrustedProxyRanges('::ffff:192.0.2.10')
        expect(isTrustedProxyIp('192.0.2.10', singleMapped)).toBe(true)
        expect(isTrustedProxyIp('192.0.2.11', singleMapped)).toBe(false)
    })

    it('akzeptiert enge native IPv6-Hostnetze ohne breiten Nachbarzugriff', function () {
        const ranges = parseTrustedProxyRanges('2001:db8::8/128')
        expect(isTrustedProxyIp('2001:0DB8:0:0:0:0:0:8', ranges)).toBe(true)
        expect(isTrustedProxyIp('2001:db8::9', ranges)).toBe(false)
        expect(isTrustedProxyIp('192.0.2.8', ranges)).toBe(false)
    })

    it('verwirft universelle, leere, mehrdeutige oder ungültige Einträge', function () {
        for (const value of [
            '',
            ' ',
            ',',
            ',127.0.0.1',
            '127.0.0.1,',
            '127.0.0.1,,::1',
            '0.0.0.0/0',
            '192.0.2.1/0',
            '::/0',
            '2001:db8::/0',
            '::ffff:0:0/96',
            '::ffff:192.0.2.0/95',
            '::ffff:192.0.2.0/64',
            '192.0.2.1/33',
            '::1/129',
            '192.0.2.1/',
            '192.0.2.1/-1',
            '192.0.2.1/+32',
            '192.0.2.1/32.0',
            '192.0.2.1/0x20',
            '192.0.2.1/32/24',
            '192.0.2.1 /32',
            '192.0.2.1/ 32',
            '192.0.2.1/32\n',
            '192.0.2.1\n',
            '192.0.2.1\u00a0',
            'proxy.internal',
            '192.0.2.1:443',
            '[::1]',
            'fe80::1%eth0',
        ]) {
            expect(() => parseTrustedProxyRanges(value)).toThrow()
        }
    })

    it('begrenzt Anzahl und Länge vor der Allowlist-Verarbeitung', function () {
        const entries = Array.from(
            { length: 64 },
            (_, index) => `192.0.2.${index + 1}`,
        )
        expect(parseTrustedProxyRanges(entries.join(','))).toHaveLength(64)
        expect(() =>
            parseTrustedProxyRanges([...entries, '::1'].join(',')),
        ).toThrow()
        const validAddress = '127.0.0.1'
        const maximum = ' '.repeat(4096 - validAddress.length) + validAddress
        expect(parseTrustedProxyRanges(maximum)).toHaveLength(1)
        expect(() => parseTrustedProxyRanges(' ' + maximum)).toThrow()
    })

    it('gibt abgelehnte Konfigurationswerte nicht im Fehlertext zurück', function () {
        const input = 'private-proxy.example.invalid'
        try {
            parseTrustedProxyRanges(input)
            throw new Error('Expected validation failure')
        } catch (error) {
            if (!(error instanceof Error)) throw error
            expect(error.message).toContain('TRUSTED_PROXY_RANGES')
            expect(error.message).not.toContain(input)
        }
    })
})

describe('Kanonische Client-IP', function () {
    it.each([
        ['198.51.100.21', '198.51.100.21'],
        [' \t198.51.100.21\t ', '198.51.100.21'],
        ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
        ['0:0:0:0:0:0:0:0', '::'],
        ['0:0:0:0:0:0:0:1', '::1'],
        ['2001:0:0:1:0:0:1:1', '2001::1:0:0:1:1'],
        ['2001:db8:0:1:0:0:0:1', '2001:db8:0:1::1'],
        ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
        ['2001:db8:1:2:3:4:0:0', '2001:db8:1:2:3:4::'],
        ['0:0:1:2:3:4:5:6', '::1:2:3:4:5:6'],
        ['::ffff:192.0.2.10', '192.0.2.10'],
        ['::FFFF:C000:020A', '192.0.2.10'],
        ['0:0:0:0:0:ffff:192.0.2.10', '192.0.2.10'],
        ['::192.0.2.10', '::c000:20a'],
        ['64:ff9b::192.0.2.10', '64:ff9b::c000:20a'],
    ])('normalisiert %s zu %s', function (input, expected) {
        expect(getValidatedClientIpService(input)).toBe(expected)
        expect(getValidatedClientIpService(expected)).toBe(expected)
    })

    it('verwirft alternative IPv4-Formen, Zonen, Ports und Kontrollzeichen', function () {
        for (const input of [
            undefined,
            null,
            '',
            ' ',
            '192.168.001.1',
            '127.1',
            '2130706433',
            '0x7f000001',
            '[::1]',
            '[::1]:443',
            '127.0.0.1:443',
            'example.invalid',
            '10.0.0.1/32',
            'fe80::1%eth0',
            '::ffff:127.0.0.01',
            '2001:::1',
            '2001:db8::1::2',
            '\n127.0.0.1',
            '127.0.0.1\n',
            '127.0.0.1\r\nx-header:x',
            '\u00a0127.0.0.1',
            '127.0.0.1\u00a0',
            '127.\t0.0.1',
            'x'.repeat(64 + 1),
        ]) {
            expect(getValidatedClientIpService(input)).toBeNull()
        }
    })

    it('erkennt ausschließlich kanonische Loopback-IP-Bereiche', function () {
        for (const input of [
            '127.0.0.1',
            '127.255.255.255',
            '::1',
            '0:0:0:0:0:0:0:1',
            '::ffff:127.0.0.1',
            '::FFFF:7FFF:FFFF',
        ])
            expect(isLoopbackIpService(input)).toBe(true)
        for (const input of [
            undefined,
            null,
            '',
            'localhost',
            '127.1',
            '127.example.invalid',
            '126.255.255.255',
            '128.0.0.1',
            '10.0.0.1',
            '::',
            '::2',
            '::127.0.0.1',
            '64:ff9b::127.0.0.1',
            '::ffff:10.0.0.1',
        ])
            expect(isLoopbackIpService(input)).toBe(false)
    })

    it('klassifiziert geparste lokale Origin-Hosts ohne DNS und Suffixfallback', function () {
        for (const input of [
            'http://localhost:3000',
            'https://LOCALHOST:8443',
            'http://127.12.34.56',
            'http://[::1]:3000',
            'http://[::ffff:127.0.0.1]',
        ])
            expect(isLoopbackOriginService(new URL(input))).toBe(true)
        for (const input of [
            'http://localhost.example.invalid',
            'http://child.localhost',
            'http://localhost.',
            'http://192.168.1.2',
            'http://example.invalid',
            'http://[::]',
            'http://[::2]',
            'http://[::ffff:10.0.0.1]',
        ])
            expect(isLoopbackOriginService(new URL(input))).toBe(false)
    })
})

describe('Strikt vorgelagerter Trusted-Proxy-Resolver', function () {
    const ranges = parseTrustedProxyRanges('10.0.0.0/8,2001:db8:ffff::/48')

    it('verweigert ungültige und nicht vertraute Socket-Peers ohne Headerfallback', function () {
        for (const directIp of [
            undefined,
            null,
            '',
            'invalid',
            '203.0.113.20',
            '::ffff:203.0.113.20',
        ]) {
            const legacyRequest = {
                directIp,
                forwardedFor: '198.51.100.8',
                cfConnectingIp: '198.51.100.9',
                realIp: '198.51.100.7',
            }
            expect(
                resolveTrustedProxyClientIp(legacyRequest, ranges),
            ).toBeNull()
        }
        expect(
            resolveTrustedProxyClientIp(
                { directIp: '10.0.0.3', forwardedFor: '198.51.100.8' },
                [],
            ),
        ).toBeNull()
    })

    it('nimmt von rechts den ersten untrusted Hop und ignoriert vorgeschobene Identitäten', function () {
        expect(
            resolveTrustedProxyClientIp(
                {
                    directIp: '10.0.0.3',
                    forwardedFor: '203.0.113.7, 198.51.100.11, 10.0.0.2',
                },
                ranges,
            ),
        ).toBe('198.51.100.11')
        expect(
            resolveTrustedProxyClientIp(
                {
                    directIp: '2001:db8:ffff::3',
                    forwardedFor:
                        '203.0.113.7, 2001:0DB8:0001:0:0:0:0:7, 2001:db8:ffff::2',
                },
                ranges,
            ),
        ).toBe('2001:db8:1::7')
    })

    it('normalisiert mapped Socket- und Chain-Hops vor Vertrauen und Identitätsausgabe', function () {
        expect(
            resolveTrustedProxyClientIp(
                {
                    directIp: '::ffff:10.0.0.3',
                    forwardedFor: '::FFFF:C633:640B, ::ffff:10.0.0.2',
                },
                ranges,
            ),
        ).toBe('198.51.100.11')
        expect(
            resolveTrustedProxyClientIp(
                {
                    directIp: '::FFFF:A00:3',
                    forwardedFor: '198.51.100.11, 10.0.0.2',
                },
                ranges,
            ),
        ).toBe('198.51.100.11')
    })

    it('erhält bei vollständig trusted Ketten den linken Endclient', function () {
        expect(
            resolveTrustedProxyClientIp(
                {
                    directIp: '10.0.0.3',
                    forwardedFor: '10.0.0.1, 10.0.0.2',
                },
                ranges,
            ),
        ).toBe('10.0.0.1')
        expect(
            resolveTrustedProxyClientIp(
                {
                    directIp: '::ffff:10.0.0.3',
                    forwardedFor: '::ffff:10.0.0.1',
                },
                ranges,
            ),
        ).toBe('10.0.0.1')
    })

    it('verweigert jede unvollständige Kette statt Cf/Real/Socketersatz zu verwenden', function () {
        for (const forwardedFor of [
            undefined,
            null,
            '',
            ' ',
            ',',
            ',198.51.100.8',
            '198.51.100.8,',
            '198.51.100.8,,10.0.0.2',
            'unknown,10.0.0.2',
            'unknown,198.51.100.8',
            '198.51.100.8,unknown',
            '[2001:db8::7]:443,10.0.0.2',
            '198.51.100.8:443,10.0.0.2',
            'fe80::1%eth0,10.0.0.2',
            '198.51.100.8\n,10.0.0.2',
            '198.51.100.8\u00a0,10.0.0.2',
            '198.51.100.8,10.0.0.2\r',
        ]) {
            const legacyRequest = {
                directIp: '10.0.0.3',
                forwardedFor,
                cfConnectingIp: '198.51.100.9',
                realIp: '198.51.100.7',
            }
            expect(
                resolveTrustedProxyClientIp(legacyRequest, ranges),
            ).toBeNull()
        }
    })

    it('begrenzt Hopzahl und Headerlänge ohne die gültige Maximal-Kette abzuschneiden', function () {
        const entries = [
            '198.51.100.8',
            ...Array.from({ length: 16 - 1 }, () => '10.0.0.2'),
        ]
        expect(
            resolveTrustedProxyClientIp(
                {
                    directIp: '10.0.0.3',
                    forwardedFor: entries.join(','),
                },
                ranges,
            ),
        ).toBe('198.51.100.8')
        expect(
            resolveTrustedProxyClientIp(
                {
                    directIp: '10.0.0.3',
                    forwardedFor: [...entries, '10.0.0.2'].join(','),
                },
                ranges,
            ),
        ).toBeNull()
        expect(
            resolveTrustedProxyClientIp(
                {
                    directIp: '10.0.0.3',
                    forwardedFor: ' '.repeat(2048 + 1),
                },
                ranges,
            ),
        ).toBeNull()
    })
})

describe('Strikt weitergereichtes Protokoll', function () {
    it('akzeptiert genau HTTP(S) mit begrenztem ASCII-OWS', function () {
        expect(getTrustedForwardedProtocol('http')).toBe('http')
        expect(getTrustedForwardedProtocol('https')).toBe('https')
        expect(getTrustedForwardedProtocol(' \thttps\t ')).toBe('https')
    })

    it('verwirft Listen, alternative Schreibweisen, Kontrollzeichen und Überlänge', function () {
        for (const protocol of [
            undefined,
            null,
            '',
            ' ',
            'HTTP',
            'HTTPS',
            'javascript',
            'ws',
            'http, https',
            'https,http',
            'https,https',
            ',https',
            'https,',
            'https\n',
            '\rhttps',
            '\u00a0https',
            'https\u00a0',
            ' '.repeat(16) + 'https',
        ])
            expect(getTrustedForwardedProtocol(protocol)).toBeNull()
    })
})
