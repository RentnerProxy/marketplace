import { describe, expect, it, vi } from 'bun:test'
import { createEnumerationProtection } from '@/server/Auth/enumerationProtection.service.ts'

describe('Auth-Enumeration-Zeitgrenze', function () {
    it('wartet nur die Restzeit seit Erzeugung der Schutzgrenze', async function () {
        let currentTimeMs = 1_000
        const wait = vi.fn(async function (delayMs: number) {
            currentTimeMs += delayMs
        })
        const protection = createEnumerationProtection(750, {
            now: function () {
                return currentTimeMs
            },
            wait,
        })

        currentTimeMs += 225
        await protection.wait()

        expect(wait).toHaveBeenCalledTimes(1)
        expect(wait).toHaveBeenCalledWith(525)
    })

    it('fügt nach bereits erreichter Mindestdauer keine Wartezeit hinzu', async function () {
        let currentTimeMs = 10
        const wait = vi.fn(async function () {})
        const protection = createEnumerationProtection(750, {
            now: function () {
                return currentTimeMs
            },
            wait,
        })

        currentTimeMs += 900
        await protection.wait()

        expect(wait).not.toHaveBeenCalled()
    })

    it('weist ungültige Zeitgrenzen deterministisch zurück', function () {
        expect(function () {
            createEnumerationProtection(-1)
        }).toThrow('nicht negative ganze Zahl')
        expect(function () {
            createEnumerationProtection(1.5)
        }).toThrow('nicht negative ganze Zahl')
    })
})
