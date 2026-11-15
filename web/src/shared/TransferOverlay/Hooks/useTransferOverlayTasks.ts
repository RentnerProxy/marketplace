import { useSyncExternalStore } from 'react'
import type {
    FinishExternalTransferTaskInput,
    StartTransferOptions,
    SyncExternalTransferTaskInput,
    TransferOverlayLogicReturn,
    TransferProgressUpdate,
    TransferStatus,
    TransferTask,
    TransferTaskController,
} from '../Types/types.ts'

const listeners = new Set<() => void>()
const taskIntervals = new Map<string, number>()
const taskRemovalTimers = new Map<string, number>()
let tasks: Array<TransferTask> = []

function emit() {
    listeners.forEach((listener) => listener())
}

function updateTask(id: string, updater: (task: TransferTask) => TransferTask) {
    const currentTask = tasks.find((task) => task.id === id)

    if (!currentTask) {
        return
    }

    const nextTask = updater(currentTask)

    if (nextTask === currentTask) {
        return
    }

    tasks = tasks.map((task) => (task.id === id ? nextTask : task))
    emit()
}

function clearTaskTimers(id: string) {
    const interval = taskIntervals.get(id)

    if (interval !== undefined) {
        window.clearInterval(interval)
        taskIntervals.delete(id)
    }

    const removalTimer = taskRemovalTimers.get(id)

    if (removalTimer !== undefined) {
        window.clearTimeout(removalTimer)
        taskRemovalTimers.delete(id)
    }
}

function removeTask(id: string, force = false) {
    const task = tasks.find((item) => item.id === id)

    if (
        !task ||
        (!force && task.kind === 'backup' && task.status === 'running')
    ) {
        return
    }

    clearTaskTimers(id)
    tasks = tasks.filter((candidate) => candidate.id !== id)
    emit()
}

function subscribeToTransferTasks(listener: () => void) {
    listeners.add(listener)

    return function unsubscribe() {
        listeners.delete(listener)
    }
}

function getTransferTasksSnapshot() {
    return tasks
}

export function dismissTransferTask(id: string) {
    removeTask(id)
}

export function clearTransferTasks(kind?: TransferTask['kind']) {
    const taskIds = tasks
        .filter((task) => kind === undefined || task.kind === kind)
        .map((task) => task.id)

    if (taskIds.length === 0) {
        return
    }

    taskIds.forEach((id) => clearTaskTimers(id))
    const taskIdSet = new Set(taskIds)
    tasks = tasks.filter((task) => !taskIdSet.has(task.id))
    emit()
}

function normalizeExternalTask(
    input: SyncExternalTransferTaskInput,
): TransferTask {
    const safeTotalBytes = Math.max(input.totalBytes, 1)
    const safeTransferredBytes = Math.max(
        0,
        Math.min(input.transferredBytes, safeTotalBytes),
    )

    return {
        id: input.id,
        direction: input.direction,
        kind: input.kind,
        title: input.title,
        totalBytes: safeTotalBytes,
        transferredBytes: safeTransferredBytes,
        speedBytesPerSecond: Math.max(input.speedBytesPerSecond ?? 0, 0),
        progress: Math.min(100, (safeTransferredBytes / safeTotalBytes) * 100),
        status: 'running',
        indeterminate: input.indeterminate ?? input.totalBytes <= 0,
        message: input.message,
    }
}

export function syncExternalTransferTask(input: SyncExternalTransferTaskInput) {
    const currentTask = tasks.find((task) => task.id === input.id)

    if (currentTask && currentTask.status !== 'running') {
        return
    }

    const nextTask = normalizeExternalTask(input)

    if (!currentTask) {
        tasks = [...tasks, nextTask]
        emit()
        return
    }

    updateTask(input.id, function (task) {
        if (
            task.direction === nextTask.direction &&
            task.kind === nextTask.kind &&
            task.title === nextTask.title &&
            task.totalBytes === nextTask.totalBytes &&
            task.transferredBytes === nextTask.transferredBytes &&
            task.speedBytesPerSecond === nextTask.speedBytesPerSecond &&
            task.progress === nextTask.progress &&
            task.indeterminate === nextTask.indeterminate &&
            task.message === nextTask.message
        ) {
            return task
        }

        return nextTask
    })
}

export function finishExternalTransferTask(
    input: FinishExternalTransferTaskInput,
) {
    const currentTask = tasks.find((task) => task.id === input.id)

    if (currentTask && currentTask.status !== 'running') {
        return
    }

    const runningTask = normalizeExternalTask(input)
    const nextTask: TransferTask = {
        ...runningTask,
        transferredBytes:
            input.status === 'success'
                ? runningTask.totalBytes
                : runningTask.transferredBytes,
        speedBytesPerSecond: 0,
        progress: input.status === 'success' ? 100 : runningTask.progress,
        status: input.status,
        indeterminate:
            input.status === 'success' ? false : runningTask.indeterminate,
        message: input.message,
    }

    clearTaskTimers(input.id)

    if (currentTask) {
        tasks = tasks.map((task) => (task.id === input.id ? nextTask : task))
    } else {
        tasks = [...tasks, nextTask]
    }
    emit()

    if (input.status === 'success') {
        const removalTimer = window.setTimeout(function () {
            taskRemovalTimers.delete(input.id)
            removeTask(input.id, true)
        }, 3500)
        taskRemovalTimers.set(input.id, removalTimer)
    }
}

export function startTransferTask({
    direction,
    title,
    totalBytes,
    indeterminate = false,
}: StartTransferOptions): TransferTaskController {
    const id = crypto.randomUUID()
    const safeTotalBytes = Math.max(totalBytes, 1)
    const startedAt = Date.now()
    let lastTickAt = startedAt
    let lastTransferredBytes = 0
    let usesExternalProgress = false

    tasks = [
        ...tasks,
        {
            id,
            direction,
            kind: 'transfer',
            title,
            totalBytes: safeTotalBytes,
            transferredBytes: 0,
            speedBytesPerSecond: 0,
            progress: 0,
            status: 'running',
            indeterminate,
        },
    ]
    emit()

    if (!indeterminate) {
        const interval = window.setInterval(function () {
            if (usesExternalProgress) {
                return
            }

            const now = Date.now()
            const elapsed = now - startedAt
            const nextProgress = Math.min(
                92,
                Math.max(4, (1 - Math.exp(-elapsed / 1800)) * 92),
            )
            const nextTransferredBytes = Math.round(
                (safeTotalBytes * nextProgress) / 100,
            )
            const tickSeconds = Math.max((now - lastTickAt) / 1000, 0.001)
            const speedBytesPerSecond = Math.max(
                0,
                (nextTransferredBytes - lastTransferredBytes) / tickSeconds,
            )

            lastTickAt = now
            lastTransferredBytes = nextTransferredBytes

            updateTask(id, (task) => {
                if (task.status !== 'running') {
                    return task
                }

                return {
                    ...task,
                    transferredBytes: nextTransferredBytes,
                    speedBytesPerSecond,
                    progress: nextProgress,
                }
            })
        }, 250)
        taskIntervals.set(id, interval)
    }

    function finish(
        status: Exclude<TransferStatus, 'running'>,
        message?: string,
    ) {
        clearTaskTimers(id)

        updateTask(id, (task) => ({
            ...task,
            transferredBytes:
                status === 'success' ? task.totalBytes : task.transferredBytes,
            speedBytesPerSecond:
                status === 'success' ? 0 : task.speedBytesPerSecond,
            progress: status === 'success' ? 100 : task.progress,
            status,
            message,
        }))

        if (status === 'success') {
            const removalTimer = window.setTimeout(
                () => removeTask(id, true),
                3500,
            )
            taskRemovalTimers.set(id, removalTimer)
        }
    }

    return {
        id,
        updateProgress(input: TransferProgressUpdate) {
            usesExternalProgress = true
            const safeTotal = Math.max(input.totalBytes, 1)
            updateTask(id, (task) => ({
                ...task,
                totalBytes: safeTotal,
                transferredBytes: input.transferredBytes,
                speedBytesPerSecond: input.speedBytesPerSecond,
                indeterminate: false,
                progress: Math.min(
                    100,
                    (input.transferredBytes / safeTotal) * 100,
                ),
            }))
        },
        complete(message?: string) {
            finish('success', message)
        },
        fail(message?: string) {
            finish('error', message)
        },
        dismiss() {
            removeTask(id)
        },
    }
}

export default function useTransferOverlayTasks(): TransferOverlayLogicReturn {
    const transferTasks = useSyncExternalStore(
        subscribeToTransferTasks,
        getTransferTasksSnapshot,
        getTransferTasksSnapshot,
    )

    return {
        state: {
            tasks: transferTasks,
        },
        handler: {
            handleDismissTask: dismissTransferTask,
        },
    }
}
