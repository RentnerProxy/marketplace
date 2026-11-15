import { describe, expect, it } from 'bun:test'
import { CSP_MAX_WEBSOCKET_URL_LENGTH } from '@/config/security-headers.config.ts'
import {
    parseConfiguredRealtimeWebSocketUrlService,
    resolveRealtimeWebSocketOriginService,
} from '@/server/Runtime/realtime-environment.service.ts'

describe('exact production WebSocket configuration', function () {
    it.each([undefined, ''])(
        'uses the documented fallback only for an absent value',
        function (value) {
            expect(
                parseConfiguredRealtimeWebSocketUrlService(value),
            ).toBeUndefined()
        },
    )

    it.each([
        ['wss://socket.example.test/ws', 'wss://socket.example.test/ws'],
        [
            'wss://socket.example.test:8443/custom/socket',
            'wss://socket.example.test:8443/custom/socket',
        ],
        ['WSS://SOCKET.EXAMPLE.TEST:443/ws', 'wss://socket.example.test/ws'],
        ['wss://socket.example.test', 'wss://socket.example.test/'],
        ['ws://localhost:3001/ws', 'ws://localhost:3001/ws'],
        ['ws://127.0.0.1:3001/ws', 'ws://127.0.0.1:3001/ws'],
        [
            'wss://socket.example.test/encoded%20path',
            'wss://socket.example.test/encoded%20path',
        ],
    ])(
        'validates and normalizes a configured endpoint',
        function (input, expected) {
            expect(parseConfiguredRealtimeWebSocketUrlService(input)).toBe(
                expected,
            )
        },
    )

    it.each(
        [
            null,
            1,
            true,
            [],
            {},
            ' ',
            '\t',
            ' wss://socket.example.test/ws',
            'wss://socket.example.test/ws ',
            'wss://socket.example.test/ws\n',
            'wss://socket.example.test/\u0000ws',
            'wss://socket.example.test/\ud800',
            'https://socket.example.test/ws',
            'javascript:alert(1)',
            'ws://socket.example.test/ws',
            'ws://0.0.0.0/ws',
            '//socket.example.test/ws',
            'wss://user:password@socket.example.test/ws',
            'wss://user@socket.example.test/ws',
            'wss://socket.example.test/ws?token=synthetic',
            'wss://socket.example.test/ws?',
            'wss://socket.example.test/ws#synthetic',
            'wss://socket.example.test/ws#',
            'wss://*.example.test/ws',
            'wss://socket.example.test:*/ws',
            'wss://socket.example.test/ws;script-src',
            'wss://socket.example.test/ws,wss://other.example.test',
            'wss://socket.example.test/\\evil',
            'wss://socket.example.test:65536/ws',
            'wss://socket_example.test/ws',
        ].map((input) => ({ input })),
    )(
        'rejects an unsafe or ambiguous endpoint without reflecting it into errors',
        function ({ input }) {
            expect(() =>
                parseConfiguredRealtimeWebSocketUrlService(input),
            ).toThrow()
            try {
                parseConfiguredRealtimeWebSocketUrlService(input)
            } catch (error) {
                expect(error).toBeInstanceOf(Error)
                if (error instanceof Error) {
                    expect(error.message).not.toContain('synthetic')
                    expect(error.message).not.toContain('socket.example.test')
                }
            }
        },
    )

    it('enforces the configured URL boundary before URL parsing', function () {
        const prefix = 'wss://socket.example.test/'
        const exact =
            prefix + 'a'.repeat(CSP_MAX_WEBSOCKET_URL_LENGTH - prefix.length)
        expect(parseConfiguredRealtimeWebSocketUrlService(exact)).toBe(exact)
        expect(() =>
            parseConfiguredRealtimeWebSocketUrlService(exact + 'a'),
        ).toThrow()
    })

    it.each([
        ['https://app.example.test', 'wss://app.example.test'],
        ['https://app.example.test:8443', 'wss://app.example.test:8443'],
        ['http://localhost:3000', 'ws://localhost:3000'],
        ['http://127.0.0.1:3000', 'ws://127.0.0.1:3000'],
    ])(
        'derives the exact fallback origin without request-host input',
        function (origin, expected) {
            expect(resolveRealtimeWebSocketOriginService({ origin })).toBe(
                expected,
            )
        },
    )

    it.each([
        'ws://[::1]:3000/ws',
        'wss://[2001:db8::1]/ws',
        'ws://127.4.3.2:3000/ws',
        'wss://192.0.2.1/ws',
    ])(
        'rejects IP socket endpoints that cannot be expressed by the supported exact CSP host-source contract',
        function (value) {
            expect(() =>
                parseConfiguredRealtimeWebSocketUrlService(value),
            ).toThrow(/Realtime-CSP/)
        },
    )

    it.each([
        'http://[::1]:3000',
        'http://127.4.3.2:3000',
        'https://192.0.2.1',
    ])(
        'does not silently derive an unusable exact CSP source from an IP application origin',
        function (origin) {
            expect(() =>
                resolveRealtimeWebSocketOriginService({ origin }),
            ).toThrow(/Realtime-CSP/)
        },
    )

    it.each([
        ['3001', 'ws://localhost:3001'],
        ['4567', 'ws://localhost:4567'],
        ['80', 'ws://localhost'],
        ['65535', 'ws://localhost:65535'],
    ])(
        'matches the separate development socket port without changing production defaults',
        function (developmentPort, expected) {
            expect(
                resolveRealtimeWebSocketOriginService({
                    origin: 'http://localhost:3000',
                    developmentPort,
                }),
            ).toBe(expected)
            expect(
                resolveRealtimeWebSocketOriginService({
                    origin: 'http://localhost:3000',
                }),
            ).toBe('ws://localhost:3000')
        },
    )

    it.each([
        '',
        '0',
        '-1',
        '65536',
        '1.5',
        ' 3001',
        '3001 ',
        '3001/ws',
        '3001;script-src',
        '03001',
        '3001' + String.fromCharCode(10),
        '3001' + String.fromCharCode(0x2028),
    ])(
        'rejects an invalid development-only port without silently reverting to another origin',
        function (developmentPort) {
            expect(() =>
                resolveRealtimeWebSocketOriginService({
                    origin: 'http://localhost:3000',
                    developmentPort,
                }),
            ).toThrow(/VITE_REALTIME_WS_DEV_PORT/)
        },
    )

    it('keeps an explicit configured URL authoritative over an unused development port', function () {
        expect(
            resolveRealtimeWebSocketOriginService({
                origin: 'http://localhost:3000',
                configuredUrl: 'ws://localhost:4555/custom/ws',
                developmentPort: 'unused-invalid',
            }),
        ).toBe('ws://localhost:4555')
    })

    it('uses exactly the configured socket origin, with no path or extra source', function () {
        expect(
            resolveRealtimeWebSocketOriginService({
                origin: 'https://app.example.test',
                configuredUrl: 'wss://socket.example.test:8443/custom/ws',
            }),
        ).toBe('wss://socket.example.test:8443')
    })

    it('permits an explicit supported socket hostname for an otherwise valid IPv6 application origin', function () {
        expect(
            resolveRealtimeWebSocketOriginService({
                origin: 'http://[::1]:3000',
                configuredUrl: 'ws://localhost:3000/ws',
            }),
        ).toBe('ws://localhost:3000')
    })

    it.each([
        'http://app.example.test',
        'https://user:password@app.example.test',
        'https://app.example.test/',
        'https://app.example.test/page',
        'https://app.example.test?query=synthetic',
        'https://app.example.test#synthetic',
        'wss://app.example.test',
        ' https://app.example.test',
        'invalid',
    ])(
        'refuses an invalid application origin even when a valid socket override is present',
        function (origin) {
            expect(() =>
                resolveRealtimeWebSocketOriginService({
                    origin,
                    configuredUrl: 'wss://socket.example.test/ws',
                }),
            ).toThrow('ORIGIN')
        },
    )
})
