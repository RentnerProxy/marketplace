import type { ProtocolDocumentName } from './Types/contract.types.ts'

export type HttpSocket = 'app.sock' | 'core.sock'
export type HttpMethod = 'GET' | 'POST'

export const rpcLimits = Object.freeze({
    maxJsonBytes: 1_048_576,
    maxListEntries: 100,
    defaultDeadlineMs: 10_000,
    maxDeadlineMs: 30_000,
} as const)

export interface HttpOperationDefinition {
    socket: HttpSocket
    method: HttpMethod
    path: `/${string}`
    summary: string
    status: 200 | 202 | 204
    pathParameter?: 'operationId' | 'providerId' | 'secretId'
    idempotencyKey?: true
    resumeCursor?: true
    request?: ProtocolDocumentName
    response?: ProtocolDocumentName
    event?: ProtocolDocumentName
    description?: string
    failures?: Record<number, string>
}

const operations = {
    getAppHealth: {
        socket: 'app.sock',
        method: 'GET',
        path: '/app/v1/health',
        summary: 'Check app process health',
        status: 200,
        response: 'AppHealth',
        failures: { 503: 'The app is unhealthy.' },
    },
    getAppReadiness: {
        socket: 'app.sock',
        method: 'GET',
        path: '/app/v1/ready',
        summary: 'Check readiness for the negotiated generation',
        status: 200,
        response: 'AppReadiness',
        failures: { 503: 'The app or its required context is unavailable.' },
    },
    activateApp: {
        socket: 'app.sock',
        method: 'POST',
        path: '/app/v1/lifecycle/activate',
        summary: 'Activate the prepared app generation',
        status: 204,
        idempotencyKey: true,
    },
    drainApp: {
        socket: 'app.sock',
        method: 'POST',
        path: '/app/v1/lifecycle/drain',
        summary: 'Drain the active app generation',
        status: 204,
        idempotencyKey: true,
    },
    deactivateApp: {
        socket: 'app.sock',
        method: 'POST',
        path: '/app/v1/lifecycle/deactivate',
        summary: 'Deactivate the drained app generation',
        status: 204,
        idempotencyKey: true,
    },
    callAppApi: {
        socket: 'app.sock',
        method: 'POST',
        path: '/app/v1/api/{operationId}',
        pathParameter: 'operationId',
        summary: 'Invoke an app-owned operation declared by the package',
        status: 200,
        request: 'AppApiPayload',
        response: 'AppApiPayload',
        idempotencyKey: true,
        description:
            'The authenticated gateway verifies current user and resource access, then validates the request and result against the installed package API for this operation ID.',
    },
    invokeAppProvider: {
        socket: 'app.sock',
        method: 'POST',
        path: '/app/v1/providers/{providerId}',
        pathParameter: 'providerId',
        summary: 'Invoke a negotiated provider operation',
        status: 200,
        request: 'ProviderRequest',
        response: 'ProviderResult',
        idempotencyKey: true,
        description:
            'The broker derives the provider from the active registration. Its profile, operation discriminants and resource identities must match the invocation and result. Accepted long-running provider work may carry a durable Operation.',
    },
    getPlatformContext: {
        socket: 'core.sock',
        method: 'GET',
        path: '/platform/v1/context',
        summary: 'Read the verified installation context',
        status: 200,
        response: 'PlatformContext',
        description:
            'An authenticated candidate generation may read its own context while preparing for readiness. Other operations require an active generation and current authorization.',
    },
    checkAuthorization: {
        socket: 'core.sock',
        method: 'POST',
        path: '/platform/v1/authorization',
        summary: 'Check current resource authorization',
        status: 200,
        request: 'AuthorizationRequest',
        response: 'AuthorizationResult',
    },
    listProxyHosts: {
        socket: 'core.sock',
        method: 'POST',
        path: '/platform/v1/proxy-hosts/query',
        summary: 'List proxy hosts within current grants',
        status: 200,
        request: 'ProxyHostQuery',
        response: 'ProxyHostPage',
    },
    updateOwnedProxyHost: {
        socket: 'core.sock',
        method: 'POST',
        path: '/platform/v1/proxy-hosts/owned',
        summary: 'Apply a revision-checked change to an app-owned host',
        status: 202,
        request: 'OwnedProxyHostChange',
        response: 'Operation',
        idempotencyKey: true,
        description:
            'The platform controls ownership and configuration. Recheck current ownership, grants and revision before applying; conflicts preserve the currently applied proxy configuration.',
    },
    probeUpstream: {
        socket: 'core.sock',
        method: 'POST',
        path: '/platform/v1/diagnostics/upstream',
        summary: 'Run a bounded probe of an authorized proxy host upstream',
        status: 200,
        request: 'UpstreamProbe',
        response: 'UpstreamProbeResult',
    },
    publishNotification: {
        socket: 'core.sock',
        method: 'POST',
        path: '/platform/v1/notifications',
        summary: 'Publish an app-owned notification',
        status: 204,
        request: 'AppNotification',
        idempotencyKey: true,
    },
    recordAuditEvent: {
        socket: 'core.sock',
        method: 'POST',
        path: '/platform/v1/audit-events',
        summary: 'Record an app-owned audit event',
        status: 204,
        request: 'AppAuditEvent',
        idempotencyKey: true,
        description:
            'The platform supplies app, installation, actor and timestamp provenance from authenticated context.',
    },
    readSecret: {
        socket: 'core.sock',
        method: 'GET',
        path: '/platform/v1/secrets/{secretId}',
        pathParameter: 'secretId',
        summary: 'Read a secret assigned to this app installation',
        status: 200,
        response: 'AppSecret',
        failures: { 404: 'The secret is unavailable to this installation.' },
    },
    getProvider: {
        socket: 'core.sock',
        method: 'GET',
        path: '/platform/v1/providers/{providerId}',
        pathParameter: 'providerId',
        summary: 'Read an authorized provider registration',
        status: 200,
        response: 'ProviderRegistration',
        failures: { 404: 'The provider is unavailable to this installation.' },
    },
    getOperation: {
        socket: 'core.sock',
        method: 'GET',
        path: '/platform/v1/operations/{operationId}',
        pathParameter: 'operationId',
        summary: 'Read an authorized durable operation',
        status: 200,
        response: 'Operation',
        failures: { 404: 'The operation is unavailable to this installation.' },
    },
    cancelOperation: {
        socket: 'core.sock',
        method: 'POST',
        path: '/platform/v1/operations/{operationId}/cancel',
        pathParameter: 'operationId',
        summary: 'Request cancellation of an authorized operation',
        status: 202,
        response: 'Operation',
        idempotencyKey: true,
        failures: { 404: 'The operation is unavailable to this installation.' },
    },
    subscribeToEvents: {
        socket: 'core.sock',
        method: 'GET',
        path: '/platform/v1/events',
        summary: 'Resume the permission-filtered durable stream',
        status: 200,
        event: 'PlatformEvent',
        resumeCursor: true,
        failures: {
            410: 'The cursor expired. Perform a full authorized resynchronization.',
        },
        description:
            'The SSE id is the resume cursor. Events are at least once. Deduplicate by the data event ID. Recheck active generation, grants, resource visibility, and delegation at delivery. Close the stream when subscription authority expires or is revoked.',
    },
} as const satisfies Record<string, HttpOperationDefinition>

for (const operation of Object.values(operations)) Object.freeze(operation)
export const httpOperations = Object.freeze(operations)

export type HttpOperationName = keyof typeof httpOperations

type KnownOperation = (typeof httpOperations)[HttpOperationName]
type OperationSchemas = {
    [Field in 'request' | 'response' | 'event']?: Extract<
        KnownOperation,
        Record<Field, ProtocolDocumentName>
    >[Field]
}

export function httpOperation(
    name: HttpOperationName,
): HttpOperationDefinition & OperationSchemas {
    return httpOperations[name]
}
