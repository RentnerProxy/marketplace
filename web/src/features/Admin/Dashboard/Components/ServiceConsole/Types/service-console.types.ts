import type { RefObject, UIEvent } from 'react'
import type { RuntimeLogEntry } from '@/lib/RuntimeLogs/Types/runtime-log.types.ts'
import type { DashboardServiceId } from '../../../Types/dashboard-domain.types.ts'

export type ServiceConsoleProps = {
    service: DashboardServiceId
    onClose: () => void
}

export type ServiceConsoleLogicReturn = {
    state: {
        entries: Array<
            Pick<RuntimeLogEntry, 'id' | 'timestamp' | 'level'> & {
                time: string
                message: string
                contextText: string
            }
        >
        isFollowing: boolean
        unreadCount: number
        isLoading: boolean
        isUnavailable: boolean
        isHistoryIncomplete: boolean
        connectionLabel: string
        sourceLabel: string
    }
    handler: {
        handleJumpToLatest: () => void
        handleScroll: (event: UIEvent<HTMLDivElement>) => void
    }
    refs: {
        consoleRef: RefObject<HTMLElement | null>
        outputRef: RefObject<HTMLDivElement | null>
    }
}
