import {
    generatedHttpOperations,
    generatedRpcLimits,
} from './http-operations.generated.ts'
import type { ProtocolDocumentName } from './Types/contract.types.ts'

export type HttpSocket = 'app.sock' | 'core.sock'
export type HttpMethod = 'GET' | 'POST'

export const rpcLimits = Object.freeze(generatedRpcLimits)

/** The protocol document that admits each path parameter value. */
export const pathParameterSchemas = Object.freeze({
    operationId: 'RecordId',
    providerId: 'RecordId',
    secretId: 'RecordId',
    incidentKey: 'RecordId',
    domain: 'LegacyHandoffDomain',
} as const satisfies Record<string, ProtocolDocumentName>)

export type HttpPathParameter = keyof typeof pathParameterSchemas

export interface HttpOperationDefinition {
    socket: HttpSocket
    method: HttpMethod
    path: `/${string}`
    summary: string
    status: 200 | 202 | 204
    pathParameter?: HttpPathParameter
    idempotencyKey?: true
    resumeCursor?: true
    request?: ProtocolDocumentName
    response?: ProtocolDocumentName
    event?: ProtocolDocumentName
    description?: string
    failures?: Record<number, string>
}

const operations = generatedHttpOperations satisfies Record<
    string,
    HttpOperationDefinition
>

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
