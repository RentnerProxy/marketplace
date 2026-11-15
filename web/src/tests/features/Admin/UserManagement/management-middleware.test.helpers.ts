import { vi } from 'bun:test'

type Handler = (input: { data: unknown }) => Promise<unknown>
export type Boundary = (input?: { data: unknown }) => Promise<unknown>
const identity = (data: unknown) => data

export function createServerFnStub() {
    let parse = identity
    return {
        validator(validate: typeof parse) {
            parse = validate
            return this
        },
        handler(callback: Handler) {
            return async (input?: { data: unknown }) =>
                callback({ data: parse(input?.data) })
        },
    }
}

export const authorize = vi.fn()
vi.mock('@/server/Auth/authorization.service.ts', () => ({
    requirePermissionService: authorize,
}))
