export type LogContext = Record<
    string,
    boolean | number | string | null | undefined
>

export type SafeErrorDescriptor = {
    errorName: string
    errorCode?: string
    smtpStatus?: number
}

export type SafeErrorDetails = SafeErrorDescriptor & {
    errorId: string
    errorCauses?: Array<SafeErrorDescriptor>
    aggregateErrors?: Array<SafeErrorDescriptor>
}

export type LogLevel = 'error' | 'info' | 'warn'
