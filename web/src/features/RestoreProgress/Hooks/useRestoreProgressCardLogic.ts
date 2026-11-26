import {
    CheckCircle2,
    DatabaseBackup,
    RotateCcw,
    TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HeadingIconTone } from '@/shared/Types/heading-icon.types.ts'
import type { BackupRestoreProgressPhase } from '@/lib/Backups/Types/backup.types.ts'
import type {
    RestoreProgressCardLogicReturn,
    RestoreProgressCardProps,
} from '../Types/restore-progress.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { TranslationKey } from '@/language/translation.ts'

const PHASE_TRANSLATION_KEYS: Record<
    BackupRestoreProgressPhase,
    TranslationKey
> = {
    preparing: 'restoreProgress.phase.preparing',
    validating: 'restoreProgress.phase.validating',
    'creating-recovery': 'restoreProgress.phase.creatingRecovery',
    'replacing-storage': 'restoreProgress.phase.replacingStorage',
    'restoring-database': 'restoreProgress.phase.restoringDatabase',
    finalizing: 'restoreProgress.phase.finalizing',
    'rolling-back': 'restoreProgress.phase.rollingBack',
}

export default function useRestoreProgressCardLogic({
    restoreStatus,
    isLoading,
}: RestoreProgressCardProps): RestoreProgressCardLogicReturn {
    const { t } = useTranslationStore()
    const percent = restoreStatus?.percent
    const hasExactPercent = percent !== null && percent !== undefined
    const safePercent = hasExactPercent
        ? Math.max(0, Math.min(100, percent))
        : 0
    const status = restoreStatus?.status
    const isRecoveryRequired = status === 'recovery-required'
    const isFailed = status === 'failed' || isRecoveryRequired
    const isCompleted = status === 'completed'
    const showIndeterminateProgress =
        !hasExactPercent && (isLoading || status === 'running')

    let phaseKey: TranslationKey = 'restoreProgress.status.idle'
    if (restoreStatus?.phase)
        phaseKey = PHASE_TRANSLATION_KEYS[restoreStatus.phase]
    else if (isLoading || !restoreStatus) phaseKey = 'restoreProgress.loading'
    const phaseLabel = t(phaseKey)
    let statusLabel = phaseLabel
    let notice = t('restoreProgress.keepOpenNotice')
    let noticeClassName = 'border-l-primary text-gray-200'
    let headerIcon: LucideIcon = DatabaseBackup
    let headerIconTone: HeadingIconTone = 'primary'
    let progressColor = 'bg-primary'

    if (isFailed) {
        const statusKey = isRecoveryRequired ? 'recoveryRequired' : 'failed'
        statusLabel = t(`restoreProgress.status.${statusKey}`)
        notice = t(`restoreProgress.${statusKey}Notice`)
        noticeClassName = 'border-l-danger text-red-100'
        headerIcon = TriangleAlert
        headerIconTone = 'danger'
        progressColor = 'bg-red-400'
    } else if (isCompleted) {
        statusLabel = t('restoreProgress.status.completed')
        notice = t('restoreProgress.completedNotice')
        noticeClassName = 'border-l-success text-emerald-100'
        headerIcon = CheckCircle2
        headerIconTone = 'success'
        progressColor = 'bg-emerald-400'
    } else {
        if (status === 'idle') notice = t('restoreProgress.idleNotice')
        if (restoreStatus?.phase === 'rolling-back') headerIcon = RotateCcw
    }

    let progressClassName = 'h-full w-0 rounded-full bg-primary'
    if (hasExactPercent) {
        progressClassName = `h-full rounded-full transition-[width] duration-500 ${progressColor}`
    } else if (showIndeterminateProgress) {
        progressClassName = 'h-full w-1/3 animate-pulse rounded-full bg-primary'
    }

    return {
        state: {
            isRecoveryRequired,
            hasExactPercent,
            safePercent,
            phaseLabel,
            statusLabel,
            notice,
            noticeClassName,
            headerIcon,
            headerIconTone,
            progressClassName,
            progressStyle: hasExactPercent
                ? { width: `${safePercent}%` }
                : undefined,
        },
    }
}
