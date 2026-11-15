export class RestoreRollbackError extends Error {
    readonly rollbackErrors: Array<unknown>

    constructor(
        message: string,
        rollbackErrors: Array<unknown>,
        cause: unknown,
    ) {
        super(message, { cause })
        this.name = 'RestoreRollbackError'
        this.rollbackErrors = rollbackErrors
    }
}
