import { afterEach, describe, expect, it } from 'bun:test'
import {
    getRealtimeHostnameService,
    getRealtimePortService,
} from '@/server/Realtime/environment.service.ts'

describe('Realtime environment service', function () {
    afterEach(function () {
        delete process.env.REALTIME_WS_HOST
        delete process.env.REALTIME_WS_PORT
    })

    it('liefert Defaults und validiert den Port', function () {
        expect(getRealtimeHostnameService()).toBe('127.0.0.1')
        expect(getRealtimePortService()).toBe(3001)

        process.env.REALTIME_WS_PORT = '70000'
        expect(function () {
            getRealtimePortService()
        }).toThrow('gültiger Port')
    })
})
