import { describe, expect, it } from 'bun:test'
import { parseValkeyUrl } from '@/server/Valkey/valkeyUrl.ts'

describe('parseValkeyUrl', function () {
    it('dekodiert BullMQ-Zugangsdaten genauso wie eine URL-Verbindung', function () {
        expect(
            parseValkeyUrl('rediss://user%40tenant:p%40ss@valkey.test:6380/4'),
        ).toEqual({
            database: 4,
            host: 'valkey.test',
            password: 'p@ss',
            port: 6380,
            tls: true,
            username: 'user@tenant',
        })
    })

    it.each([
        'redis://valkey.test/not-a-database',
        'redis://valkey.test/1/2',
        'redis://valkey.test/0?db=2',
        'http://valkey.test/0',
    ])('verwirft eine mehrdeutige Valkey-URL: %s', function (url) {
        expect(() => parseValkeyUrl(url)).toThrow()
    })

    it('normalisiert IPv6-Literale für ioredis', function () {
        expect(parseValkeyUrl('redis://[::1]:6380/2')).toMatchObject({
            database: 2,
            host: '::1',
            port: 6380,
        })
    })

    it('verwirft Port 0', function () {
        expect(() => parseValkeyUrl('redis://valkey.test:0/0')).toThrow(/Port/)
    })
})
