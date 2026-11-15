export function isPasswordResetTokenValidationValid(result: unknown) {
    if (typeof result !== 'object' || result === null) {
        return false
    }

    if ('valid' in result && typeof result.valid === 'boolean') {
        return result.valid
    }

    return (
        'length' in result &&
        typeof result.length === 'number' &&
        result.length > 0
    )
}
