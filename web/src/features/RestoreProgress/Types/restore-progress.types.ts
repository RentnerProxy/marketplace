import type { RestoreStatus } from '@/lib/Restore/Types/restore.types.ts'
import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { HeadingIconTone } from '@/shared/Types/heading-icon.types.ts'

export type RestoreProgressLogicReturn = {
    state: {
        restoreStatus: RestoreStatus | null
        isLoading: boolean
        isError: boolean
    }
}

export type RestoreProgressCardProps = RestoreProgressLogicReturn['state']

export type RestoreProgressCardLogicReturn = {
    state: {
        isRecoveryRequired: boolean
        hasExactPercent: boolean
        safePercent: number
        phaseLabel: string
        statusLabel: string
        notice: string
        noticeClassName: string
        headerIcon: LucideIcon
        headerIconTone: HeadingIconTone
        progressClassName: string
        progressStyle: CSSProperties | undefined
    }
}
