import { toast } from '@rentnerkev/toasts'
import { createToastErrorAdapter } from '@rentnerkev/toasts/errors'
import { AppError } from '@/lib/Errors/appError.ts'
import { getErrorMessage } from '@/lib/Errors/error.ts'

export function toastAppError(error: unknown, fallback?: string): void {
    createToastErrorAdapter({
        api: toast,
        fallbackMessage: fallback,
        normalize(value) {
            return value instanceof AppError
                ? {
                      content: value.message,
                      title: value.title,
                      duration: value.duration,
                  }
                : { content: getErrorMessage(value, fallback), title: 'Fehler' }
        },
        dedupeKey(value, content) {
            const title = value instanceof AppError ? value.title : 'Fehler'
            return `app-error:${JSON.stringify([title, content])}`
        },
        dedupeWindow: 2_000,
    })(error)
}
