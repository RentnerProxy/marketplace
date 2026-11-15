import {
    LOG_ALLOWED_VALUES,
    LOG_BOOLEAN_FIELDS,
    LOG_ID_FIELDS,
    LOG_NUMBER_FIELDS,
} from '@/config/logging.config.ts'
import type { LogContext } from './Types/logging.types.ts'
import { getOwnLogValue } from './error-details.ts'

const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const decimalJobIdPattern = /^(?:0|[1-9][0-9]{0,19})$/

export function sanitizeLogContextService(context: unknown): LogContext {
    const result: LogContext = {}
    for (const field of LOG_NUMBER_FIELDS) {
        const value = getOwnLogValue(context, field)
        if (typeof value === 'number' && Number.isFinite(value))
            result[field] = value
    }
    for (const field of LOG_BOOLEAN_FIELDS) {
        const value = getOwnLogValue(context, field)
        if (typeof value === 'boolean') result[field] = value
    }
    for (const field of LOG_ID_FIELDS) {
        const value = getOwnLogValue(context, field)
        if (typeof value === 'string' && uuidPattern.test(value))
            result[field] = value.toLowerCase()
        else if (value === null) result[field] = null
    }
    for (const [field, values] of Object.entries(LOG_ALLOWED_VALUES)) {
        const value = getOwnLogValue(context, field)
        if (
            typeof value === 'string' &&
            values.some((allowed) => allowed === value)
        )
            result[field] = value
    }
    const jobId = getOwnLogValue(context, 'jobId')
    if (
        typeof jobId === 'string' &&
        (uuidPattern.test(jobId) ||
            decimalJobIdPattern.test(jobId) ||
            jobId === 'unknown')
    ) {
        result.jobId = jobId.toLowerCase()
    }
    return result
}
