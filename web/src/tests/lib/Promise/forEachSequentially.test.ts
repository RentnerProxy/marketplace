import { describe, expect, it } from 'bun:test'
import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'

describe('forEachSequentially', function () {
    it('schließt jede Operation vor dem nächsten Wert ab', async function () {
        const events: Array<string> = []
        let activeOperations = 0
        let maximumActiveOperations = 0
        const visitedIndexes: Array<number> = []

        await forEachSequentially([1, 2, 3], async function (value, index) {
            activeOperations += 1
            maximumActiveOperations = Math.max(
                maximumActiveOperations,
                activeOperations,
            )
            visitedIndexes.push(index)
            events.push(`start:${value}`)
            await Bun.sleep(1)
            events.push(`end:${value}`)
            activeOperations -= 1
        })

        expect(maximumActiveOperations).toBe(1)
        expect(visitedIndexes).toEqual([0, 1, 2])
        expect(events).toEqual([
            'start:1',
            'end:1',
            'start:2',
            'end:2',
            'start:3',
            'end:3',
        ])
    })

    it('bricht nach dem ersten Fehler ab', async function () {
        const visitedValues: Array<number> = []

        await expect(
            forEachSequentially([1, 2, 3], function (value) {
                visitedValues.push(value)

                if (value === 2) {
                    throw new Error('Operation fehlgeschlagen')
                }
            }),
        ).rejects.toThrow('Operation fehlgeschlagen')
        expect(visitedValues).toEqual([1, 2])
    })
})
