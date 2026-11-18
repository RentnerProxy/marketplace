import {
    httpOperation,
    httpOperations,
    type HttpMethod,
    type HttpOperationName,
    type HttpSocket,
} from './http-operations.ts'
import type {
    ProtocolDocument,
    ProtocolDocumentName,
} from './Types/contract.types.ts'
import { ContractError, parseProtocolDocument } from './validation.ts'

type OperationDocument<Operation, Field extends string> =
    Operation extends Record<Field, infer Name extends ProtocolDocumentName>
        ? ProtocolDocument<Name>
        : undefined

type HttpDocument<Name extends HttpOperationName, Field extends string> =
    OperationDocument<(typeof httpOperations)[Name], Field>

export interface HttpRequestOptions {
    pathParameter?: string
    idempotencyKey?: string
    resumeCursor?: string
    body?: unknown
}

export interface HttpRequest<Name extends HttpOperationName> {
    method: HttpMethod
    socket: HttpSocket
    path: string
    headers: Record<string, string>
    body: HttpDocument<Name, 'request'>
}

function requireHttpOperation(name: HttpOperationName) {
    if (!Object.hasOwn(httpOperations, name)) {
        throw new ContractError('invalidShape', 'Unknown v1 HTTP operation.')
    }
    return httpOperation(name)
}

/** Prepare the validated path, controls and payload. The transport provides authorization and byte limits. */
export function prepareHttpRequest<Name extends HttpOperationName>(
    name: Name,
    options?: HttpRequestOptions,
): HttpRequest<Name>
export function prepareHttpRequest(
    name: HttpOperationName,
    options: HttpRequestOptions = {},
): HttpRequest<HttpOperationName> {
    const operation = requireHttpOperation(name)
    if (
        Boolean(operation.pathParameter) !== (options.pathParameter !== undefined) ||
        Boolean(operation.idempotencyKey) !== (options.idempotencyKey !== undefined) ||
        (!operation.resumeCursor && options.resumeCursor !== undefined) ||
        Boolean(operation.request) !== (options.body !== undefined)
    ) {
        throw new ContractError('invalidShape', 'Invalid controls or payload for the HTTP operation.')
    }
    const path = operation.pathParameter
        ? operation.path.replace(
            '{' + operation.pathParameter + '}',
            parseProtocolDocument('RecordId', options.pathParameter),
        )
        : operation.path
    const headers: Record<string, string> = {}
    if (options.idempotencyKey !== undefined) {
        headers['Idempotency-Key'] = parseProtocolDocument('RecordId', options.idempotencyKey)
    }
    if (options.resumeCursor !== undefined) {
        headers['Last-Event-ID'] = parseProtocolDocument('EventCursor', options.resumeCursor)
    }
    const body = operation.request ? parseProtocolDocument(operation.request, options.body) : undefined
    return {
        method: operation.method,
        socket: operation.socket,
        path,
        headers,
        body,
    }
}

export type HttpResponse<Name extends HttpOperationName> =
    | { ok: true; data: HttpDocument<Name, 'response'> }
    | { ok: false; problem: ProtocolDocument<'Problem'> }

/** Validate decoded response JSON. For empty success or a stream opening omit the body. */
export function parseHttpResponse<Name extends HttpOperationName>(
    name: Name,
    status: number,
    body?: unknown,
): HttpResponse<Name>
export function parseHttpResponse(
    name: HttpOperationName,
    status: number,
    body?: unknown,
): HttpResponse<HttpOperationName> {
    const operation = requireHttpOperation(name)
    if (status === operation.status) {
        if (!operation.response && body !== undefined) {
            throw new ContractError('invalidShape', 'The HTTP success response has no JSON body.')
        }
        const data = operation.response
            ? parseProtocolDocument(operation.response, body)
            : undefined
        return { ok: true, data }
    }
    if (!Number.isInteger(status) || status < 400 || status > 599) {
        throw new ContractError('invalidShape', 'Unexpected HTTP status for the operation.')
    }
    const problem = parseProtocolDocument('Problem', body)
    if (problem.status !== status) {
        throw new ContractError('invalidShape', 'The HTTP status does not match the problem.')
    }
    return { ok: false, problem }
}

/** Validate one decoded event after the transport admits a bounded SSE frame. */
export function parseHttpEvent<Name extends HttpOperationName>(
    name: Name,
    body: unknown,
): HttpDocument<Name, 'event'>
export function parseHttpEvent(
    name: HttpOperationName,
    body: unknown,
): HttpDocument<HttpOperationName, 'event'> {
    const operation = requireHttpOperation(name)
    if (!operation.event) {
        throw new ContractError('invalidShape', 'The HTTP operation has no event stream.')
    }
    return parseProtocolDocument(operation.event, body)
}
