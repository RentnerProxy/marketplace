export function isUncertainCoreErrorCode(code: string): boolean {
    return (
        code === 'STORAGE_ROLLBACK_FAILED' ||
        code === 'CORE_OPERATION_UNCERTAIN'
    )
}

export class CoreCommandError extends Error {
    readonly code: string
    readonly isUncertain: boolean

    constructor(
        code: string,
        message: string,
        options?: { uncertain?: boolean },
    ) {
        super(message)
        this.name = 'CoreCommandError'
        this.code = code
        this.isUncertain = options?.uncertain ?? false
    }
}
