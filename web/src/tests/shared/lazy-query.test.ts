import { describe, expect, it } from 'bun:test'
import {
    createLazyTestQuery,
    LazyTestQuery,
} from './lazy-query.test.helpers.ts'

describe('lazy query test adapter', function () {
    it('defers reads until consumption and preserves the existing microtask boundary', async function () {
        const trace: string[] = []
        let current = 1
        const query = createLazyTestQuery(() =>
            Promise.resolve().then(() => {
                trace.push('read:' + current)
                return current
            }),
        )
        expect(trace).toEqual([])
        current = 2
        const result = query.then((value) => {
            trace.push('resolved')
            return value + 1
        })
        expect(trace).toEqual([])
        await Promise.resolve()
        expect(trace).toEqual(['read:2'])
        expect(await result).toBe(3)
        expect(trace).toEqual(['read:2', 'resolved'])
    })

    it('preserves immediate async work when the original query starts at then', async function () {
        const trace: string[] = []
        const release = Promise.withResolvers<void>()
        const query = createLazyTestQuery(async function () {
            trace.push('start')
            await release.promise
            trace.push('finish')
            return 5
        })
        expect(trace).toEqual([])
        const result = query.then((value) => value)
        expect(trace).toEqual(['start'])
        release.resolve()
        expect(await result).toBe(5)
        expect(trace).toEqual(['start', 'finish'])
    })

    it('keeps repeated consumption lazy and does not cache a query result', async function () {
        let reads = 0
        const query = createLazyTestQuery(() =>
            Promise.resolve().then(() => ++reads),
        )
        expect(reads).toBe(0)
        expect(await query).toBe(1)
        expect(await query).toBe(2)
        expect(reads).toBe(2)
    })

    it('preserves read rejection, handler return values and missing handlers', async function () {
        const failure = new Error('Synthetic query rejection.')
        const query = createLazyTestQuery<number>(() =>
            Promise.resolve().then(() => {
                throw failure
            }),
        )
        await expect(Promise.resolve(query)).rejects.toBe(failure)
        expect(
            await query.then(undefined, (error) => (error === failure ? 7 : 0)),
        ).toBe(7)
        const successful = createLazyTestQuery(() => Promise.resolve(11))
        expect(await successful.then<number>(undefined, undefined)).toBe(11)
        expect(await successful.then<number>(null, undefined)).toBe(11)
        await expect(
            Promise.resolve(
                successful.then(() => {
                    throw failure
                }),
            ),
        ).rejects.toBe(failure)
    })

    it('keeps fluent object identity when query methods are composed with the adapter', async function () {
        let filter = 0
        const query = {
            where(value: number) {
                filter = value
                return query
            },
            ...createLazyTestQuery(() => Promise.resolve().then(() => filter)),
        }
        expect(query.where(17)).toBe(query)
        expect(await query).toBe(17)
    })

    it('preserves receiver state for subclass query readers', async function () {
        class Rows extends LazyTestQuery<number[]> {
            private maximum = 3

            constructor() {
                super(() => Promise.resolve().then(() => this.read()))
            }

            private read() {
                return [1, 2, 3].slice(0, this.maximum)
            }

            limit(maximum: number) {
                this.maximum = maximum
                return this
            }
        }

        const query = new Rows()
        expect(query.limit(2)).toBe(query)
        expect(await query).toEqual([1, 2])
    })
})
