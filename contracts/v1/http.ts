import {
    httpOperations,
    pathParameterSchemas,
    type HttpOperationDefinition,
    type HttpPathParameter,
} from './http-operations.ts'

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

function describeOperation(name: string, operation: HttpOperationDefinition) {
    const core = operation.socket === 'core.sock'
    const parameters = [parameter('Installation'), parameter('Generation')]
    if (core) parameters.push(parameter('Delegation'))
    if (operation.pathParameter)
        parameters.push(parameter(operation.pathParameter))
    if (operation.idempotencyKey) parameters.push(parameter('IdempotencyKey'))
    if (operation.resumeCursor) parameters.push(parameter('ResumeCursor'))

    const responses: Record<string, object> = {
        401: problem('The request credential is absent or invalid.'),
        403: problem(
            'The installation, generation, actor, or resource is unauthorized.',
        ),
        '4XX': problem('The request was rejected with a stable problem code.'),
        '5XX': problem('The operation failed with a stable problem code.'),
    }
    if (operation.idempotencyKey) {
        responses[409] = problem(
            'The resource, generation, or idempotency key conflicts.',
        )
    }
    for (const [status, description] of Object.entries(
        operation.failures ?? {},
    )) {
        responses[status] = problem(description)
    }
    if (operation.event) {
        responses[operation.status] = {
            description: 'Server-Sent Events.',
            content: {
                'text/event-stream': {
                    schema: { type: 'string' },
                    'x-rentnerproxy-event-data-schema': schema(operation.event),
                },
            },
        }
    } else if (operation.response) {
        responses[operation.status] = json(
            operation.status === 202
                ? 'The operation was accepted.'
                : 'The operation result.',
            operation.response,
        )
    } else {
        responses[operation.status] = {
            description: 'The operation completed.',
        }
    }

    return {
        operationId: name,
        summary: operation.summary,
        description: operation.description,
        'x-rentnerproxy-socket': operation.socket,
        security: core ? [{ CoreCredential: [] }] : [{ AppCredential: [] }],
        parameters,
        ...(operation.request && {
            requestBody: {
                required: true,
                content: {
                    'application/json': { schema: schema(operation.request) },
                },
            },
        }),
        responses,
    }
}

export const httpPaths: Record<
    string,
    Partial<Record<'get' | 'post', ReturnType<typeof describeOperation>>>
> = {}
for (const [name, operation] of Object.entries(httpOperations)) {
    const { path, method } = operation
    const item = (httpPaths[path] ??= {})
    item[method === 'GET' ? 'get' : 'post'] = describeOperation(name, operation)
}

function pathParameter(name: HttpPathParameter) {
    return {
        name,
        in: 'path',
        required: true,
        schema: schema(pathParameterSchemas[name]),
    }
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
        operationId: pathParameter('operationId'),
        providerId: pathParameter('providerId'),
        secretId: pathParameter('secretId'),
        incidentKey: pathParameter('incidentKey'),
        domain: pathParameter('domain'),
        ResumeCursor: {
            name: 'Last-Event-ID',
            in: 'header',
            description:
                'Resume within the subscription authorized by the current generation, grants, and delegation.',
            schema: schema('EventCursor'),
        },
    },
}
