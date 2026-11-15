import { isRedirect } from '@tanstack/react-router'
import { isPasswordResetPath } from '@/lib/Auth/passwordResetPath.ts'
import { passwordResetConfig } from '@/config/session.config.ts'
import { requestPasswordResetTokenSchema } from '@/features/Auth/PasswordReset/validation.ts'

export function applyPasswordResetPrivacyHeadersService(
    headers: Pick<Headers, 'set'>,
): void {
    headers.set('cache-control', 'private, no-store, max-age=0')
    headers.set('pragma', 'no-cache')
    headers.set('referrer-policy', 'no-referrer')
}

export function addPasswordResetPrivacyHeadersService(
    response: Response,
): Response {
    try {
        applyPasswordResetPrivacyHeadersService(response.headers)
        return response
    } catch {
        const headers = new Headers(response.headers)
        applyPasswordResetPrivacyHeadersService(headers)
        const privateResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        })

        return isRedirect(response)
            ? Object.assign(privateResponse, { options: response.options })
            : privateResponse
    }
}

function rejectLegacyPasswordResetLinkService(): Response {
    return addPasswordResetPrivacyHeadersService(
        new Response(null, { status: 400 }),
    )
}

export function getPasswordResetLegacyRedirectService(
    request: Request,
): Response | null {
    const url = new URL(request.url)
    if (
        !isPasswordResetPath(url.pathname) ||
        (request.method !== 'GET' && request.method !== 'HEAD') ||
        !url.search
    ) {
        return null
    }

    const query = url.search.slice(1)
    if (query.length > passwordResetConfig.maximumLegacyQueryLength) {
        return rejectLegacyPasswordResetLinkService()
    }

    let token: string | undefined
    try {
        for (const field of query.split('&')) {
            const separator = field.indexOf('=')
            const encodedName =
                separator === -1 ? field : field.slice(0, separator)
            const encodedValue =
                separator === -1 ? '' : field.slice(separator + 1)
            const name = decodeURIComponent(encodedName.replaceAll('+', ' '))
            const value = decodeURIComponent(encodedValue.replaceAll('+', ' '))
            if (name !== 'token') {
                continue
            }
            if (token !== undefined) {
                return rejectLegacyPasswordResetLinkService()
            }
            token = value
        }
    } catch {
        return rejectLegacyPasswordResetLinkService()
    }

    if (token === undefined) {
        return null
    }
    const parsed = requestPasswordResetTokenSchema.safeParse({ token })
    if (!parsed.success) {
        return rejectLegacyPasswordResetLinkService()
    }

    return addPasswordResetPrivacyHeadersService(
        new Response(null, {
            status: 303,
            headers: {
                location: `/password-reset#token=${encodeURIComponent(parsed.data.token)}`,
            },
        }),
    )
}
