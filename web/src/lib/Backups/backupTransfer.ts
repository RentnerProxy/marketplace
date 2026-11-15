import { normalizeError } from '@/lib/Errors/error.ts'
import type { TransferTaskController } from '@/shared/TransferOverlay/Types/types.ts'

export function failBackupTransfer(
    transfer: Pick<TransferTaskController, 'fail'>,
    error: unknown,
    fallback: string,
) {
    const normalizedError = normalizeError(error, fallback)
    transfer.fail(normalizedError.message)
    return normalizedError
}

export function triggerBackupDownload(url: string, fileName: string) {
    const downloadLink = document.createElement('a')
    downloadLink.href = url
    downloadLink.download = fileName
    downloadLink.click()
}
