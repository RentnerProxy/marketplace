type TransferDirection = 'upload' | 'download'
type TransferKind = 'transfer' | 'backup'
export type TransferStatus = 'running' | 'success' | 'error'

export type TransferTask = {
    id: string
    direction: TransferDirection
    kind: TransferKind
    title: string
    totalBytes: number
    transferredBytes: number
    speedBytesPerSecond: number
    progress: number
    status: TransferStatus
    indeterminate?: boolean
    message?: string
}

export type StartTransferOptions = {
    direction: TransferDirection
    title: string
    totalBytes: number
    indeterminate?: boolean
}

export type TransferProgressUpdate = {
    totalBytes: number
    transferredBytes: number
    speedBytesPerSecond: number
}

export type TransferTaskController = {
    id: string
    updateProgress: (input: TransferProgressUpdate) => void
    complete: (message?: string) => void
    fail: (message?: string) => void
    dismiss: () => void
}

export type SyncExternalTransferTaskInput = {
    id: string
    direction: TransferDirection
    kind: TransferKind
    title: string
    totalBytes: number
    transferredBytes: number
    speedBytesPerSecond?: number
    indeterminate?: boolean
    message?: string
}

export type FinishExternalTransferTaskInput = SyncExternalTransferTaskInput & {
    status: Exclude<TransferStatus, 'running'>
}

type TransferOverlayState = {
    tasks: Array<TransferTask>
}

type TransferOverlayHandler = {
    handleDismissTask: (id: string) => void
}

export type TransferOverlayLogicReturn = {
    state: TransferOverlayState
    handler: TransferOverlayHandler
}

export type TransferOverlayItemProps = {
    task: TransferTask
    onDismiss: TransferOverlayHandler['handleDismissTask']
}
