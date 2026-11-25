import { CORE_RUNTIME } from '@/config/core.config.ts'
import { z } from 'zod'
import { CoreCommandError } from './error.ts'
import type { CoreBinary } from './Types/core.types.ts'

const partLengthSchema = z
    .number()
    .int()
    .min(1)
    .max(CORE_RUNTIME.maxBinaryInputBytes)
const brandingLengthsSchema = z.tuple([
    partLengthSchema,
    partLengthSchema,
    partLengthSchema,
])

/** Validate lengths before allocation or admission to the shared worker budget. */
export function validateCoreBinaryInputService(
    binary: CoreBinary,
    request: Record<string, unknown>,
    bytes: Uint8Array | undefined,
    code = 'CORE_INVALID_REQUEST',
): void {
    const invalid = (): never => {
        throw new CoreCommandError(
            code,
            'Die binäre Core-Anfrage ist ungültig.',
        )
    }
    if (bytes === undefined) {
        if ('binaryLengths' in request) invalid()
        return
    }
    if (!(bytes instanceof Uint8Array) || binary !== 'storage') invalid()
    if (request.operation === 'writeFile') {
        if (
            bytes.byteLength > CORE_RUNTIME.maxBinaryInputBytes ||
            'dataBase64' in request ||
            'binaryLengths' in request
        )
            invalid()
        return
    }
    const lengths = brandingLengthsSchema.safeParse(request.binaryLengths)
    if (
        request.operation !== 'brandingPublish' ||
        !Object.hasOwn(request, 'binaryLengths') ||
        !lengths.success ||
        ['largeBase64', 'smallBase64', 'faviconBase64'].some(
            (key) => key in request,
        )
    )
        return invalid()
    // Each of the three validated lengths is at most 8 MiB, so the sum is exact.
    const [large, small, favicon] = lengths.data
    const total = large + small + favicon
    if (
        total !== bytes.byteLength ||
        total > CORE_RUNTIME.maxBrandingInputBytes
    )
        invalid()
}
