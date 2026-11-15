import type { PrivateStorageFileWriteInput } from './private-files.types.ts'
import type { CoreCommandError } from '@/server/Core/error.ts'

export type PrivateWriteJob = {
    input: PrivateStorageFileWriteInput
    bytes: number
    deadline: number
    controller: AbortController
    cancellation?: CoreCommandError
    timer?: ReturnType<typeof setTimeout>
    task?: Promise<void>
    resolve: () => void
    reject: (error: CoreCommandError) => void
}
