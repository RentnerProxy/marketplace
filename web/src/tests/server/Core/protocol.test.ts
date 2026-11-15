import { describe, expect, it } from 'bun:test'
import { coreErrorSchema } from '@/server/Core/protocol.ts'

describe('native Core error contract', () => {
    it.each([
        { code: 'A', message: 'Ö' },
        { code: 'A_0'.padEnd(100, 'Z'), message: 'ß'.repeat(2000) },
    ])('accepts error fields at their wire limits', (error) => {
        expect(coreErrorSchema.parse(error)).toEqual(error)
    })

    it.each([
        { code: '', message: 'Fehler' },
        { code: 'A'.repeat(101), message: 'Fehler' },
        { code: 'lowercase', message: 'Fehler' },
        { code: 'CORE-ERROR', message: 'Fehler' },
        { code: 'CORE_ERROR\n', message: 'Fehler' },
        { code: 'CORE_ERROR', message: '' },
        { code: 'CORE_ERROR', message: 'x'.repeat(2001) },
        { code: 'CORE_ERROR', message: 'Fehler', extra: true },
    ])('rejects errors outside the shared wire contract', (error) => {
        expect(coreErrorSchema.safeParse(error).success).toBe(false)
    })
})
