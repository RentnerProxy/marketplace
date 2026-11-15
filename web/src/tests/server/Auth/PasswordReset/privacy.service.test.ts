import { describe, expect, it, vi } from 'bun:test'
import { isRedirect, redirect } from '@tanstack/react-router'
import { isPasswordResetPath } from '@/lib/Auth/passwordResetPath.ts'
import { passwordResetConfig } from '@/config/session.config.ts'
import {
    addPasswordResetPrivacyHeadersService,
    getPasswordResetLegacyRedirectService,
} from '@/server/Auth/PasswordReset/privacy.service.ts'

function legacyRequest(
    query: string,
    method = 'GET',
    pathname = '/password-reset',
) {
    return new Request(`https://app.example.test${pathname}${query}`, {
        method,
    })
}

function expectPrivate(response: Response | null) {
    expect(response).not.toBeNull()
    expect(response?.headers.get('cache-control')).toBe(
        'private, no-store, max-age=0',
    )
    expect(response?.headers.get('pragma')).toBe('no-cache')
    expect(response?.headers.get('referrer-policy')).toBe('no-referrer')
}

describe('password reset link privacy', () => {
    it.each([
        '/password-reset',
        '/password-reset/',
        '/Password-Reset',
        '/PASSWORD-RESET/',
        '/password-reset///',
        '/%70assword-reset',
        '//password-reset',
        '///%50assword-reset//',
    ])(
        'canonicalizes the router alias %s without rendering a token-bearing body',
        (pathname) => {
            const response = getPasswordResetLegacyRedirectService(
                legacyRequest(
                    '?token=reset-token&return=https%3A%2F%2Fevil.example',
                    'GET',
                    pathname,
                ),
            )
            expectPrivate(response)
            expect(response?.status).toBe(303)
            expect(response?.headers.get('location')).toBe(
                '/password-reset#token=reset-token',
            )
            expect(response?.body).toBeNull()
            expect(response?.headers.has('set-cookie')).toBe(false)
        },
    )

    it.each([
        '/password-reset-other',
        '/private/password-reset',
        '/%2570assword-reset',
        '/%2Fpassword-reset',
        '/password-reset%2F',
        '/password-reset%',
        '/login',
    ])('does not treat %s as the reset route', (pathname) => {
        expect(isPasswordResetPath(pathname)).toBe(false)
        expect(
            getPasswordResetLegacyRedirectService(
                legacyRequest('?token=secret', 'GET', pathname),
            ),
        ).toBeNull()
    })

    it('supports HEAD with an empty response and strips every query parameter', () => {
        const response = getPasswordResetLegacyRedirectService(
            legacyRequest(
                '?utm_source=mail&token=%20value%2Bslash%2Fhash%23%20&next=%2Fadmin',
                'HEAD',
            ),
        )
        expectPrivate(response)
        expect(response?.status).toBe(303)
        expect(response?.headers.get('location')).toBe(
            '/password-reset#token=value%2Bslash%2Fhash%23',
        )
        expect(response?.body).toBeNull()
    })

    it('keeps the existing trimmed generic token contract, including encoded names', () => {
        const token = 'x'.repeat(passwordResetConfig.maximumTokenLength)
        expect(
            getPasswordResetLegacyRedirectService(
                legacyRequest(`?to%6Ben=+${token}+`),
            )?.headers.get('location'),
        ).toBe(`/password-reset#token=${token}`)
        expect(
            getPasswordResetLegacyRedirectService(
                legacyRequest('?token=ABC_123-%C3%A4'),
            )?.headers.get('location'),
        ).toBe('/password-reset#token=ABC_123-%C3%A4')
    })

    it.each([
        '?token=',
        '?token=+%20',
        '?token=first&token=second',
        '?token=&token=second',
        '?token=first&to%6Ben=second',
        '?token=%',
        '?token=%2',
        '?token=%GG',
        '?token=%FF',
        '?token=%C0%AF',
        '?token=%ED%A0%80',
        '?token=valid&bad%name=value',
        '?token=valid&extra=%FF',
        `?token=${'x'.repeat(passwordResetConfig.maximumTokenLength + 1)}`,
        `?token=valid&ignored=${'x'.repeat(passwordResetConfig.maximumLegacyQueryLength)}`,
    ])('rejects an invalid legacy query with no reflected token', (query) => {
        const response = getPasswordResetLegacyRedirectService(
            legacyRequest(query),
        )
        expectPrivate(response)
        expect(response?.status).toBe(400)
        expect(response?.headers.has('location')).toBe(false)
        expect(response?.body).toBeNull()
    })

    it('does not reinterpret missing tokens or non-navigation methods', () => {
        expect(
            getPasswordResetLegacyRedirectService(legacyRequest('')),
        ).toBeNull()
        expect(
            getPasswordResetLegacyRedirectService(
                legacyRequest('?campaign=mail'),
            ),
        ).toBeNull()
        expect(
            getPasswordResetLegacyRedirectService(
                legacyRequest('?Token=case-sensitive'),
            ),
        ).toBeNull()
        expect(
            getPasswordResetLegacyRedirectService(
                legacyRequest('?token=secret', 'POST'),
            ),
        ).toBeNull()
    })

    it('retains the response, cookies, stream identity and TanStack redirect metadata', () => {
        const response = redirect({
            to: '/login',
            hash: 'password-reset-token-invalid',
            statusCode: 307,
        })
        response.headers.append('set-cookie', 'synthetic=one; HttpOnly')
        const options = response.options
        const privateResponse = addPasswordResetPrivacyHeadersService(response)
        expect(privateResponse).toBe(response)
        expectPrivate(privateResponse)
        expect(isRedirect(privateResponse)).toBe(true)
        expect(Reflect.get(privateResponse, 'options')).toBe(options)
        expect(privateResponse.headers.get('set-cookie')).toBe(
            'synthetic=one; HttpOnly',
        )
    })

    it('retains redirect options when immutable headers require a clone', () => {
        const response = Object.assign(
            Response.redirect('https://app.example.test/login', 303),
            {
                options: { href: '/login', statusCode: 303 },
            },
        )
        const privateResponse = addPasswordResetPrivacyHeadersService(response)
        expectPrivate(privateResponse)
        expect(privateResponse.status).toBe(303)
        expect(privateResponse.headers.get('location')).toBe(
            'https://app.example.test/login',
        )
        expect(isRedirect(privateResponse)).toBe(true)
        expect(Reflect.get(privateResponse, 'options')).toBe(response.options)
    })

    it('never buffers or replaces a streaming body while decorating a response', async () => {
        const response = new Response('streamed synthetic body', {
            status: 202,
        })
        const body = response.body
        const privateResponse = addPasswordResetPrivacyHeadersService(response)
        expect(privateResponse).toBe(response)
        expect(privateResponse.body).toBe(body)
        expect(await privateResponse.text()).toBe('streamed synthetic body')
    })

    it('forwards streaming content when immutable headers require a response wrapper', async () => {
        const stream = new TransformStream<Uint8Array, Uint8Array>()
        const writer = stream.writable.getWriter()
        const response = new Response(stream.readable, {
            status: 202,
            statusText: 'Accepted',
        })
        const set = vi.spyOn(response.headers, 'set').mockImplementation(() => {
            throw new TypeError('immutable')
        })
        const privateResponse = addPasswordResetPrivacyHeadersService(response)
        set.mockRestore()
        expect(privateResponse).not.toBe(response)
        expectPrivate(privateResponse)
        expect(privateResponse.bodyUsed).toBe(false)
        expect(privateResponse.status).toBe(202)
        expect(privateResponse.statusText).toBe('Accepted')
        const reader = privateResponse.body?.getReader()
        expect(reader).toBeDefined()

        async function expectStreamedChunk(chunk: string) {
            const bytes = new TextEncoder().encode(chunk)
            const written = writer.write(bytes)
            expect(await reader?.read()).toEqual({ done: false, value: bytes })
            await written
        }

        await expectStreamedChunk('streamed ')
        await expectStreamedChunk('synthetic body')

        expect(privateResponse.bodyUsed).toBe(true)
        await writer.close()
        expect(await reader?.read()).toEqual({ done: true, value: undefined })
        reader?.releaseLock()
        writer.releaseLock()
    })

    it('forwards cancellation through a response wrapper with private headers', async () => {
        const cancel = vi.fn()
        const response = new Response(new ReadableStream({ cancel }))
        const set = vi.spyOn(response.headers, 'set').mockImplementation(() => {
            throw new TypeError('immutable')
        })
        const privateResponse = addPasswordResetPrivacyHeadersService(response)
        set.mockRestore()

        expectPrivate(privateResponse)
        expect(privateResponse.body).not.toBeNull()
        await privateResponse.body?.cancel('synthetic cancellation')
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(cancel).toHaveBeenCalledWith('synthetic cancellation')
        expect(privateResponse.bodyUsed).toBe(true)
    })
})
