export function getErrorMessage(
    error: unknown,
    fallback = 'Ein unerwarteter Fehler ist aufgetreten.',
) {
    return error instanceof Error && error.message ? error.message : fallback
}

export function normalizeError(
    error: unknown,
    fallback = 'Ein unerwarteter Fehler ist aufgetreten.',
) {
    if (error instanceof Error) {
        return error
    }

    return new Error(fallback, { cause: error })
}
