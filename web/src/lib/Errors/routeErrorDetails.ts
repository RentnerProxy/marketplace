import { getErrorMessage } from '@/lib/Errors/error.ts'
import { isRecord } from '@/lib/Validation/isRecord.ts'
import type {
    RouteErrorCategory,
    RouteErrorDetails,
} from '@/lib/Errors/Types/route-error.types.ts'

function getErrorRecord(error: unknown): Record<string, unknown> | undefined {
    return isRecord(error) ? error : undefined
}

function getStatusCode(error: unknown) {
    if (typeof Response !== 'undefined' && error instanceof Response) {
        return error.status
    }

    const errorRecord = getErrorRecord(error)
    const statusCode = errorRecord?.statusCode ?? errorRecord?.status

    return typeof statusCode === 'number' ? statusCode : undefined
}

function getErrorName(error: unknown) {
    if (error instanceof Error && error.name) {
        return error.name
    }

    const name = getErrorRecord(error)?.name
    return typeof name === 'string' && name ? name : 'Error'
}

function getRouteErrorMessage(error: unknown) {
    if (typeof error === 'string' && error) {
        return error
    }

    if (typeof Response !== 'undefined' && error instanceof Response) {
        return `${error.status} ${error.statusText}`.trim()
    }

    return getErrorMessage(error)
}

function getErrorCause(error: unknown) {
    const cause = error instanceof Error ? error.cause : undefined

    if (cause instanceof Error) {
        return cause.message
    }

    if (typeof cause === 'string') {
        return cause
    }

    if (!cause) {
        return undefined
    }

    try {
        return JSON.stringify(cause)
    } catch {
        return undefined
    }
}

function extractErrorPath(stack?: string) {
    if (!stack) {
        return undefined
    }

    const sourceLine = stack.split('\n').find((line) => {
        return (
            (line.includes('/') || line.includes('\\')) &&
            !line.includes('node_modules')
        )
    })

    if (!sourceLine) {
        return undefined
    }

    const parenthesizedPath = sourceLine.match(/\((.+)\)/)?.[1]
    const rawPath = parenthesizedPath ?? sourceLine.trim().replace(/^at\s+/, '')

    return rawPath
        .replace(/https?:\/\/[^/]+\//, '')
        .split('?')[0]
        .replace(/:\d+:\d+$/, '')
}

function getErrorCategory(
    message: string,
    statusCode?: number,
): RouteErrorCategory {
    const normalizedMessage = message.toLowerCase()

    if (
        normalizedMessage.includes('failed to fetch dynamically imported') ||
        normalizedMessage.includes('failed to load url') ||
        normalizedMessage.includes('err_load_url') ||
        normalizedMessage.includes('loading chunk')
    ) {
        return 'moduleLoad'
    }

    if (
        normalizedMessage.includes('failed to fetch') ||
        normalizedMessage.includes('networkerror') ||
        normalizedMessage.includes('network request failed') ||
        normalizedMessage.includes('load failed')
    ) {
        return 'network'
    }

    if (statusCode === 401 || statusCode === 403) {
        return 'authorization'
    }

    if (statusCode === 404) {
        return 'notFound'
    }

    if (statusCode && statusCode >= 500) {
        return 'server'
    }

    return 'generic'
}

function createTechnicalDetails(
    details: Omit<RouteErrorDetails, 'technicalDetails'>,
) {
    return [
        `Name: ${details.errorName}`,
        details.statusCode ? `HTTP-Status: ${details.statusCode}` : undefined,
        `Meldung: ${details.message}`,
        details.errorPath ? `Fundort: ${details.errorPath}` : undefined,
        details.cause ? `Ursache: ${details.cause}` : undefined,
        details.stack ? `\nStack Trace:\n${details.stack}` : undefined,
        details.componentStack
            ? `\nComponent Stack:\n${details.componentStack}`
            : undefined,
    ]
        .filter(Boolean)
        .join('\n')
}

export function getRouteErrorDetails(
    error: unknown,
    componentStack?: string,
): RouteErrorDetails {
    const message = getRouteErrorMessage(error)
    const statusCode = getStatusCode(error)

    if (!import.meta.env.DEV) {
        const details = {
            category: getErrorCategory(message, statusCode),
            cause: undefined,
            componentStack: undefined,
            errorName: 'ApplicationError',
            errorPath: undefined,
            message: 'Die Anfrage konnte nicht verarbeitet werden.',
            stack: undefined,
            statusCode,
        }

        return {
            ...details,
            technicalDetails: createTechnicalDetails(details),
        }
    }

    const stack = error instanceof Error ? error.stack : undefined
    const detailsWithoutTechnicalText = {
        category: getErrorCategory(message, statusCode),
        cause: getErrorCause(error),
        componentStack,
        errorName: getErrorName(error),
        errorPath: extractErrorPath(stack),
        message,
        stack,
        statusCode,
    }

    return {
        ...detailsWithoutTechnicalText,
        technicalDetails: createTechnicalDetails(detailsWithoutTechnicalText),
    }
}
