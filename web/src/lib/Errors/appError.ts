import type { AppErrorOptions } from './Types/app-error.types.ts'

export class AppError extends Error {
    readonly title: string | undefined
    readonly duration: number

    constructor(message: string, options?: AppErrorOptions) {
        super(message, { cause: options?.cause })
        this.name = 'AppError'
        this.title = options?.title
        this.duration = options?.duration ?? 6000
    }
}
