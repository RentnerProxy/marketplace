import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import {
    CSP_MAX_WEBSOCKET_URL_LENGTH,
    CSP_NONCE_PATTERN,
    CSP_SECURITY_CONFIG,
} from '@/config/security-headers.config.ts'
import type {
    CspRequestContext,
    CspRequestOperation,
} from './Types/csp.types.ts'

const FALLBACK_CONTENT_SECURITY_POLICY = [
    ...CSP_SECURITY_CONFIG.sharedDirectives,
    "script-src 'none'",
    ["connect-src 'self'", ...CSP_SECURITY_CONFIG.connectOrigins].join(' '),
].join('; ')

const requestContext = new AsyncLocalStorage<CspRequestContext>()

function cspError() {
    return new Error('The content security policy context is invalid.')
}

function assertCanonicalWebsocketOrigin(value: string) {
    if (
        typeof value !== 'string' ||
        !value.length ||
        value.length > CSP_MAX_WEBSOCKET_URL_LENGTH ||
        /[\s;,'"*]/.test(value)
    )
        throw cspError()
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw cspError()
    }
    if (
        (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
        url.origin !== value ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
    )
        throw cspError()
}

function assertCanonicalNonce(value: string) {
    if (typeof value !== 'string' || !CSP_NONCE_PATTERN.test(value))
        throw cspError()
}

export function buildContentSecurityPolicyService(
    context?: CspRequestContext,
): string {
    if (context === undefined) return FALLBACK_CONTENT_SECURITY_POLICY
    assertCanonicalNonce(context.nonce)
    assertCanonicalWebsocketOrigin(context.websocketOrigin)
    return [
        ...CSP_SECURITY_CONFIG.sharedDirectives,
        "script-src 'self' 'nonce-" + context.nonce + "'",
        [
            "connect-src 'self'",
            context.websocketOrigin,
            ...CSP_SECURITY_CONFIG.connectOrigins,
        ].join(' '),
    ].join('; ')
}

export function validateNonceContentSecurityPolicyService(
    policy: unknown,
    expectedWebsocketOrigin: string,
): boolean {
    if (
        typeof policy !== 'string' ||
        policy.length > CSP_SECURITY_CONFIG.maximumPolicyLength
    )
        return false
    const nonce = /'nonce-([A-Za-z0-9_-]{43})'/.exec(policy)?.[1]
    if (!nonce) return false
    try {
        return (
            policy ===
            buildContentSecurityPolicyService({
                nonce,
                websocketOrigin: expectedWebsocketOrigin,
            })
        )
    } catch {
        return false
    }
}

export function withRequestCspContextService<Result>(
    websocketOrigin: string,
    operation: CspRequestOperation<Result>,
): Result {
    assertCanonicalWebsocketOrigin(websocketOrigin)
    let nonce: string
    try {
        nonce = randomBytes(CSP_SECURITY_CONFIG.nonceBytes).toString(
            'base64url',
        )
    } catch {
        throw cspError()
    }
    assertCanonicalNonce(nonce)
    const context: CspRequestContext = Object.freeze({ nonce, websocketOrigin })

    return requestContext.run(context, () => operation(context))
}

export function getCurrentCspNonceService(): string {
    const context = requestContext.getStore()
    if (!context) throw cspError()
    return context.nonce
}
