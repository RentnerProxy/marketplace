import { CheckCircle2, Download, Upload, X, XCircle } from 'lucide-react'
import type { TransferOverlayItemProps, TransferTask } from '../Types/types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { formatFileSize } from '@/lib/Format/format.ts'

function getTaskLabel(task: TransferTask, t: (key: string) => string) {
    if (task.kind === 'backup') {
        if (task.status === 'success') {
            return t('shared.transfer.backupDone')
        }

        if (task.status === 'error') {
            return t('shared.transfer.backupFailed')
        }

        return t('shared.transfer.backupRunning')
    }

    if (task.status === 'success') {
        return task.direction === 'upload'
            ? t('shared.transfer.uploadDone')
            : t('shared.transfer.downloadDone')
    }

    if (task.status === 'error') {
        return task.direction === 'upload'
            ? t('shared.transfer.uploadFailed')
            : t('shared.transfer.downloadFailed')
    }

    return task.direction === 'upload'
        ? t('shared.transfer.uploadRunning')
        : t('shared.transfer.downloadRunning')
}

function getTaskIcon(task: TransferTask) {
    if (task.status === 'success') {
        return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    }

    if (task.status === 'error') {
        return <XCircle className="h-4 w-4 text-red-400" />
    }

    if (task.direction === 'upload') {
        return <Upload className="h-4 w-4 text-primary" />
    }

    return <Download className="h-4 w-4 text-primary" />
}

export default function TransferOverlayItem({
    task,
    onDismiss,
}: TransferOverlayItemProps) {
    const progress = Math.max(0, Math.min(100, task.progress))
    const canDismiss = task.kind !== 'backup' || task.status !== 'running'
    const showIndeterminate = task.indeterminate && task.status === 'running'
    const { t } = useTranslationStore()

    return (
        <div className="w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border-dark bg-surface-dark/95 text-gray-100 shadow-2xl shadow-black/40 backdrop-blur-md">
            <div className="flex items-start gap-3 p-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-dark bg-input-dark">
                    {getTaskIcon(task)}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">
                                {getTaskLabel(task, t)}
                            </p>
                            <p className="truncate text-xs text-secondary-text">
                                {task.title}
                            </p>
                        </div>
                        {canDismiss && (
                            <button
                                type="button"
                                onClick={() => onDismiss(task.id)}
                                aria-label={t('shared.transfer.dismiss')}
                                className="cursor-pointer rounded p-1 text-secondary-text transition hover:bg-input-dark hover:text-white"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    <div
                        role="progressbar"
                        aria-label={task.title}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={
                            showIndeterminate ? undefined : Math.round(progress)
                        }
                        className="mt-3 h-1.5 overflow-hidden rounded-full bg-input-dark"
                    >
                        <div
                            className={
                                showIndeterminate
                                    ? 'h-full w-1/3 animate-pulse rounded-full bg-primary'
                                    : 'h-full rounded-full bg-primary transition-all duration-300'
                            }
                            style={
                                showIndeterminate
                                    ? undefined
                                    : { width: `${progress}%` }
                            }
                        />
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-medium text-secondary-text">
                        <span>
                            {task.indeterminate
                                ? (task.message ??
                                  t('shared.transfer.preparing'))
                                : t(
                                      task.kind === 'backup'
                                          ? 'shared.transfer.backupProgress'
                                          : 'shared.transfer.progress',
                                      {
                                          progress: Math.round(progress),
                                          transferredBytes: formatFileSize(
                                              task.transferredBytes,
                                          ),
                                          totalBytes: formatFileSize(
                                              task.totalBytes,
                                          ),
                                      },
                                  )}
                        </span>
                        {task.status === 'running' &&
                            task.speedBytesPerSecond > 0 && (
                                <span className="shrink-0 font-mono text-primary">
                                    {formatFileSize(task.speedBytesPerSecond)}/s
                                </span>
                            )}
                    </div>

                    {task.message && !task.indeterminate ? (
                        <p className="mt-2 text-xs text-secondary-text">
                            {task.message}
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
