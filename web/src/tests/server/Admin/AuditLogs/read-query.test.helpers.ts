import { vi } from 'bun:test'

export type Rows = Array<Record<string, unknown>>
type ReadQuery = Promise<Rows> & {
    from: (...args: Array<unknown>) => ReadQuery
    innerJoin: (...args: Array<unknown>) => ReadQuery
    leftJoin: (...args: Array<unknown>) => ReadQuery
    where: (...args: Array<unknown>) => ReadQuery
    orderBy: (...args: Array<unknown>) => ReadQuery
    limit: (...args: Array<unknown>) => ReadQuery
    for: (...args: Array<unknown>) => ReadQuery
}

export function createReadDb() {
    const results: Array<Rows> = []
    const queries: Array<ReadQuery> = []
    const select = vi.fn((_selection?: unknown) => {
        const pending = Promise.resolve(results.shift() ?? [])
        const chain: ReadQuery = Object.assign(pending, {
            from: vi.fn(() => chain),
            innerJoin: vi.fn(() => chain),
            leftJoin: vi.fn(() => chain),
            where: vi.fn(() => chain),
            orderBy: vi.fn(() => chain),
            limit: vi.fn(() => chain),
            for: vi.fn(() => chain),
        })
        queries.push(chain)
        return chain
    })
    return { db: { select }, results, queries }
}

export function table(name: string, fields: Array<string>) {
    return Object.fromEntries(
        fields.map((field) => [field, `${name}.${field}`]),
    )
}

export const operators = {
    eq: (left: unknown, right: unknown) => ({ op: 'eq', left, right }),
    ne: (left: unknown, right: unknown) => ({ op: 'ne', left, right }),
    gt: (left: unknown, right: unknown) => ({ op: 'gt', left, right }),
    and: (...conditions: Array<unknown>) => ({ op: 'and', conditions }),
    inArray: (column: unknown, values: Array<unknown>) => ({
        op: 'in',
        column,
        values,
    }),
    asc: (column: unknown) => ({ op: 'asc', column }),
    desc: (column: unknown) => ({ op: 'desc', column }),
}
