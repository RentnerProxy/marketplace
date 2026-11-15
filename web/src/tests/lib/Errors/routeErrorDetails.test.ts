import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getRouteErrorDetails } from '@/lib/Errors/routeErrorDetails.ts'

const originalDevelopment = process.env.DEV

beforeEach(function () {
    process.env.DEV = 'true'
})

afterEach(function () {
    if (originalDevelopment === undefined) delete process.env.DEV
    else process.env.DEV = originalDevelopment
})

describe('route error diagnostics', function () {
    it.each([
        ['Failed to fetch dynamically imported module', 'moduleLoad'],
        ['Failed to load url /assets/page.js', 'moduleLoad'],
        ['ERR_LOAD_URL', 'moduleLoad'],
        ['Loading chunk 123 failed', 'moduleLoad'],
        ['Failed to fetch', 'network'],
        ['NetworkError', 'network'],
        ['Network request failed', 'network'],
        ['Load failed', 'network'],
        ['Unexpected input', 'generic'],
    ] as const)(
        'classifies %s for a useful recovery action',
        function (message, category) {
            expect(getRouteErrorDetails(message).category).toBe(category)
        },
    )

    it.each([
        [401, 'authorization'],
        [403, 'authorization'],
        [404, 'notFound'],
        [500, 'server'],
        [503, 'server'],
        [400, 'generic'],
    ] as const)(
        'preserves HTTP %s while choosing %s recovery',
        function (status, category) {
            const response = new Response(null, {
                status,
                statusText: 'Synthetic status',
            })
            const details = getRouteErrorDetails(response)
            expect(details.statusCode).toBe(status)
            expect(details.category).toBe(category)
            expect(details.message).toBe(`${status} Synthetic status`)
            expect(details.technicalDetails).toContain(`HTTP-Status: ${status}`)
        },
    )

    it('shows development stack/cause/component details and strips asset origin and query', function () {
        const error = new Error('Rendering failed', {
            cause: new Error('Synthetic cause'),
        })
        error.name = 'RenderError'
        error.stack =
            'RenderError: Rendering failed\n    at dependency (/app/node_modules/lib.js:1:2)\n    at render (https://app.example.test/web/src/view.tsx?v=123:4:5)'
        const details = getRouteErrorDetails(error, 'at AccountCard')
        expect(details.errorName).toBe('RenderError')
        expect(details.errorPath).toBe('web/src/view.tsx')
        expect(details.cause).toBe('Synthetic cause')
        expect(details.componentStack).toBe('at AccountCard')
        expect(details.technicalDetails).toContain('Fundort: web/src/view.tsx')
        expect(details.technicalDetails).toContain('Ursache: Synthetic cause')
        expect(details.technicalDetails).toContain(
            'Component Stack:\nat AccountCard',
        )
        expect(details.technicalDetails).toContain(error.stack)
    })

    it('handles bare Windows stack frames and absent source frames', function () {
        const error = new Error('Synthetic')
        error.stack = 'Error: Synthetic\n    at C:\\app\\src\\loader.ts:12:9'
        expect(getRouteErrorDetails(error).errorPath).toBe(
            'C:\\app\\src\\loader.ts',
        )
        error.stack = 'Error: Synthetic\n    at internalCallback'
        expect(getRouteErrorDetails(error).errorPath).toBeUndefined()
        error.stack = undefined
        expect(getRouteErrorDetails(error).errorPath).toBeUndefined()
    })

    it.each([
        ['a string cause', 'a string cause'],
        [{ operation: 'read' }, '{"operation":"read"}'],
        [0, undefined],
        [1n, undefined],
    ])(
        'serializes supported causes and tolerates unsupported ones',
        function (cause, expected) {
            expect(
                getRouteErrorDetails(new Error('Synthetic', { cause })).cause,
            ).toBe(expected)
        },
    )

    it('accepts structured HTTP errors and ignores invalid status/name fields', function () {
        const details = getRouteErrorDetails({
            statusCode: 403,
            name: 'Forbidden',
        })
        expect(details.statusCode).toBe(403)
        expect(details.errorName).toBe('Forbidden')
        expect(
            getRouteErrorDetails({ status: '503', name: 17 }).statusCode,
        ).toBeUndefined()
        expect(getRouteErrorDetails({ status: 404, name: '' }).errorName).toBe(
            'Error',
        )
        expect(getRouteErrorDetails(null).category).toBe('generic')
        expect(getRouteErrorDetails('').message).toBe(
            'Ein unerwarteter Fehler ist aufgetreten.',
        )
    })

    it('redacts internal details in production while retaining the recovery category', function () {
        delete process.env.DEV
        const internal = new Error('Synthetic internal connection details', {
            cause: 'Synthetic internal cause',
        })
        internal.stack = 'Error: Synthetic\n    at /private/server.ts:1:2'
        const details = getRouteErrorDetails(internal, 'at PrivateComponent')
        expect(details).toMatchObject({
            errorName: 'ApplicationError',
            message: 'Die Anfrage konnte nicht verarbeitet werden.',
            stack: undefined,
            cause: undefined,
            componentStack: undefined,
            errorPath: undefined,
        })
        expect(details.technicalDetails).not.toContain('Synthetic internal')
        expect(details.technicalDetails).not.toContain('PrivateComponent')
        expect(details.technicalDetails).not.toContain('/private')
        expect(
            getRouteErrorDetails(new Response(null, { status: 403 })).category,
        ).toBe('authorization')
    })
})
