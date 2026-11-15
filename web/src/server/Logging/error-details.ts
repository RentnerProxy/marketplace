import {
    LOG_LIMITS,
    SAFE_ERROR_CODES,
    SAFE_ERROR_NAMES,
} from '@/config/logging.config.ts'
import type {
    SafeErrorDescriptor,
    SafeErrorDetails,
} from './Types/logging.types.ts'

const errorNames = new Set<string>(SAFE_ERROR_NAMES)
const errorCodes = new Set<string>(SAFE_ERROR_CODES)

export function getOwnLogValue(value: unknown, key: string): unknown {
    if (
        (typeof value !== 'object' || value === null) &&
        typeof value !== 'function'
    )
        return undefined
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        return descriptor && 'value' in descriptor
            ? descriptor.value
            : undefined
    } catch {
        return undefined
    }
}

function safeErrorName(error: unknown) {
    const declaredName = getOwnLogValue(error, 'name')
    if (typeof declaredName === 'string' && errorNames.has(declaredName))
        return declaredName
    try {
        if (error instanceof AggregateError) return 'AggregateError'
        if (error instanceof TypeError) return 'TypeError'
        if (error instanceof RangeError) return 'RangeError'
        if (error instanceof SyntaxError) return 'SyntaxError'
        if (error instanceof ReferenceError) return 'ReferenceError'
        if (error instanceof URIError) return 'URIError'
        if (error instanceof EvalError) return 'EvalError'
        if (error instanceof Error) return 'Error'
    } catch {
        return 'UnknownError'
    }
    return 'UnknownError'
}

function describeError(error: unknown): SafeErrorDescriptor {
    const descriptor: SafeErrorDescriptor = { errorName: safeErrorName(error) }
    const code = getOwnLogValue(error, 'code')
    if (typeof code === 'string' && errorCodes.has(code))
        descriptor.errorCode = code
    const responseCode = getOwnLogValue(error, 'responseCode')
    if (
        typeof responseCode === 'number' &&
        Number.isInteger(responseCode) &&
        responseCode >= 100 &&
        responseCode <= 599
    ) {
        descriptor.smtpStatus = responseCode
    }
    return descriptor
}

function isReadableArray(value: unknown): value is unknown[] {
    try {
        return Array.isArray(value)
    } catch {
        return false
    }
}

export function getSafeErrorDetailsService(error: unknown): SafeErrorDetails {
    const details: SafeErrorDetails = {
        errorId: crypto.randomUUID(),
        ...describeError(error),
    }
    const seen = new Set<unknown>([error])
    const causes: Array<SafeErrorDescriptor> = []
    let cause = getOwnLogValue(error, 'cause')
    while (
        cause !== undefined &&
        cause !== null &&
        causes.length < LOG_LIMITS.causeDepth &&
        !seen.has(cause)
    ) {
        seen.add(cause)
        causes.push(describeError(cause))
        cause = getOwnLogValue(cause, 'cause')
    }
    if (causes.length > 0) details.errorCauses = causes

    const errors = getOwnLogValue(error, 'errors')
    if (isReadableArray(errors)) {
        const length = getOwnLogValue(errors, 'length')
        if (
            typeof length === 'number' &&
            Number.isSafeInteger(length) &&
            length > 0
        ) {
            details.aggregateErrors = Array.from(
                { length: Math.min(length, LOG_LIMITS.aggregateItems) },
                (_, index) =>
                    describeError(getOwnLogValue(errors, String(index))),
            )
        }
    }
    return details
}

export function createSafeErrorForStorageService(
    error: unknown,
    message: string,
    createError: (message: string) => Error = (text) => new Error(text),
): Error {
    const details = describeError(error)

    const safe = createError(message)
    for (const key of Object.getOwnPropertyNames(safe)) {
        if (key !== 'message' && key !== 'name')
            Reflect.deleteProperty(safe, key)
    }
    safe.stack = undefined
    if (details.errorCode)
        Object.defineProperty(safe, 'code', { value: details.errorCode })
    if (details.smtpStatus !== undefined)
        Object.defineProperty(safe, 'responseCode', {
            value: details.smtpStatus,
        })
    return safe
}
