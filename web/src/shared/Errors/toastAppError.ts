import { toast } from '@rentnerkev/toasts'
import { createToastErrorAdapter } from '@rentnerkev/toasts/errors'
import { translateCurrentLanguage } from '@/language/languageStore.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { getErrorMessage } from '@/lib/Errors/error.ts'

const showErrorToast = createToastErrorAdapter({
    api: toast,
    dedupeWindow: 2_000,
})

export function toastAppError(error: unknown, fallback?: string): void {
    const appError = error instanceof AppError ? error : undefined
    const title = appError?.title ?? translateCurrentLanguage('common.error')
    const message = getErrorMessage(error, fallback)
    const content = message.trim()
        ? message
        : getErrorMessage(undefined, fallback)
    showErrorToast(content, {
        title,
        ...(appError ? { duration: appError.duration } : {}),
        dedupeKey: `app-error:${JSON.stringify([title, content])}`,
    })
}
