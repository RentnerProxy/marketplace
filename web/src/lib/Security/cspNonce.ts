import { createIsomorphicFn } from '@tanstack/react-start'
import { CSP_NONCE_PATTERN } from '@/config/security-headers.config.ts'
import { getCurrentCspNonceService } from '@/server/Security/csp.service.ts'

export function parseDocumentCspNonce(values: readonly unknown[]): string {
    if (
        values.length !== 1 ||
        typeof values[0] !== 'string' ||
        !CSP_NONCE_PATTERN.test(values[0])
    ) {
        throw new Error(
            'Die CSP-Kennung des Dokuments fehlt oder ist ungültig.',
        )
    }
    return values[0]
}

export const getRouterCspNonce = createIsomorphicFn()
    .server(() => getCurrentCspNonceService())
    .client(() =>
        parseDocumentCspNonce(
            Array.from(
                document.querySelectorAll<HTMLMetaElement>(
                    'meta[property="csp-nonce"]',
                ),
                (element) => element.content,
            ),
        ),
    )
