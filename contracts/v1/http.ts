type Socket = 'app.sock' | 'core.sock'

function schema(name: string) {
    return { $ref: '#/components/schemas/' + name }
}

function parameter(name: string) {
    return { $ref: '#/components/parameters/' + name }
}

function json(
    description: string,
    name: string,
    contentType = 'application/json',
) {
    return { description, content: { [contentType]: { schema: schema(name) } } }
}

function problem(description: string) {
    return json(description, 'Problem', 'application/problem+json')
}

function operation(
    socket: Socket,
    operationId: string,
    summary: string,
    responses: Record<string, object>,
    parameters: string[] = [],
) {
    const core = socket === 'core.sock'
    return {
        operationId,
        summary,
        'x-rentnerproxy-socket': socket,
        security: core ? [{ CoreCredential: [] }] : [{ AppCredential: [] }],
        parameters: [
            parameter('Installation'),
            parameter('Generation'),
            ...(core ? [parameter('Delegation')] : []),
            ...parameters.map(parameter),
        ],
        responses: {
            401: problem('The request credential is absent or invalid.'),
            403: problem(
                'The installation, generation, actor, or resource is unauthorized.',
            ),
            default: problem('The request failed with a stable problem code.'),
            ...responses,
        },
    }
}

export const httpPaths = {
    '/app/v1/health': {
        get: operation('app.sock', 'getAppHealth', 'Check app process health', {
            200: json('The app process is healthy.', 'AppHealth'),
            503: problem('The app is unhealthy.'),
        }),
    },
    '/app/v1/ready': {
        get: operation(
            'app.sock',
            'getAppReadiness',
            'Check readiness for the negotiated generation',
            {
                200: json(
                    'The app is ready and advertises its provider registrations.',
                    'AppReadiness',
                ),
                503: problem('The app or its required context is unavailable.'),
            },
        ),
    },
    ...Object.fromEntries(
        (['activate', 'drain', 'deactivate'] as const).map((action) => [
            '/app/v1/lifecycle/' + action,
            {
                post: operation(
                    'app.sock',
                    action + 'App',
                    'Apply a manager-directed lifecycle transition',
                    {
                        204: {
                            description:
                                'The generation completed the requested transition.',
                        },
                        409: problem(
                            'The generation state or idempotency key conflicts.',
                        ),
                    },
                    ['IdempotencyKey'],
                ),
            },
        ]),
    ),
    '/platform/v1/context': {
        get: {
            ...operation(
                'core.sock',
                'getPlatformContext',
                'Read the verified installation context',
                {
                    200: json(
                        'Negotiated versions and installation capabilities.',
                        'PlatformContext',
                    ),
                },
            ),
            description:
                'An authenticated candidate generation may read its own context while preparing for readiness. Platform operations outside this context read require an active generation and current authorization.',
        },
    },
    '/platform/v1/authorization': {
        post: {
            ...operation(
                'core.sock',
                'checkAuthorization',
                'Check current resource authorization',
                {
                    200: json(
                        'The current authorization decision.',
                        'AuthorizationResult',
                    ),
                },
            ),
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: schema('AuthorizationRequest'),
                    },
                },
            },
        },
    },
    '/platform/v1/operations/{operationId}': {
        get: operation(
            'core.sock',
            'getOperation',
            'Read an authorized durable operation',
            {
                200: json('Current operation status.', 'Operation'),
                404: problem(
                    'The operation is unavailable to this installation.',
                ),
            },
            ['OperationId'],
        ),
    },
    '/platform/v1/operations/{operationId}/cancel': {
        post: operation(
            'core.sock',
            'cancelOperation',
            'Request cancellation of an authorized operation',
            {
                202: json(
                    'The cancellation request was accepted.',
                    'Operation',
                ),
                404: problem(
                    'The operation is unavailable to this installation.',
                ),
                409: problem('The operation or idempotency key conflicts.'),
            },
            ['OperationId', 'IdempotencyKey'],
        ),
    },
    '/platform/v1/events': {
        get: operation(
            'core.sock',
            'subscribeToEvents',
            'Resume the permission-filtered durable stream',
            {
                200: {
                    description:
                        'Server-Sent Events with at-least-once delivery. The SSE id is the resume cursor. Deduplicate JSON payloads by their event id. Recheck the active generation, current grants, resource visibility, and delegation at delivery. Close the stream when subscription authority expires or is revoked.',
                    content: {
                        'text/event-stream': {
                            schema: { type: 'string' },
                            'x-rentnerproxy-event-data-schema':
                                schema('PlatformEvent'),
                        },
                    },
                },
                410: problem(
                    'The cursor expired. Perform a full authorized resynchronization.',
                ),
            },
            ['ResumeCursor'],
        ),
    },
}

export const httpComponents = {
    securitySchemes: {
        AppCredential: {
            type: 'http',
            scheme: 'bearer',
            description:
                'The manager-issued app direction credential. The platform verifies the app peer UID before calling it. The app validates the credential and generation.',
        },
        CoreCredential: {
            type: 'http',
            scheme: 'bearer',
            description:
                'The manager-issued core direction credential. The platform validates the Linux peer UID and credential on each request and authorizes the installation generation for the requested operation.',
        },
    },
    parameters: {
        Installation: {
            name: 'X-App-Installation',
            in: 'header',
            required: true,
            schema: schema('RecordId'),
        },
        Generation: {
            name: 'X-App-Generation',
            in: 'header',
            required: true,
            description:
                'Positive installation generation in canonical decimal form.',
            schema: schema('Generation'),
        },
        Delegation: {
            name: 'X-App-Delegation',
            in: 'header',
            description:
                'The platform-issued opaque delegation is required for user-originated work. An explicit service grant governs autonomous operations.',
            schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,256}$' },
        },
        IdempotencyKey: {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            description:
                'Retry the same input with the original key. Reusing the key with different input conflicts.',
            schema: schema('RecordId'),
        },
        OperationId: {
            name: 'operationId',
            in: 'path',
            required: true,
            schema: schema('RecordId'),
        },
        ResumeCursor: {
            name: 'Last-Event-ID',
            in: 'header',
            description:
                'Resume within the subscription authorized by the current generation, grants, and delegation.',
            schema: schema('EventCursor'),
        },
    },
}
