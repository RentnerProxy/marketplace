import { useEffect, useMemo, useRef, useState } from 'react'
import type { UIEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RUNTIME_LOGS } from '@/config/logging.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { getDashboardLogsHandler } from '../../../middleware.ts'
import type {
    ServiceConsoleLogicReturn,
    ServiceConsoleProps,
} from '../Types/service-console.types.ts'

export default function useServiceConsoleLogic({
    service,
}: Pick<ServiceConsoleProps, 'service'>): ServiceConsoleLogicReturn {
    const { t, language } = useTranslationStore()
    const [isFollowing, setIsFollowing] = useState(true)
    const [lastReadEntryId, setLastReadEntryId] = useState<string | null>(null)
    const consoleRef = useRef<HTMLElement | null>(null)
    const outputRef = useRef<HTMLDivElement | null>(null)
    const logsQuery = useQuery({
        queryKey: ['admin-dashboard-logs', service],
        queryFn: function ({ signal }) {
            return getDashboardLogsHandler({
                data: { service },
                signal: AbortSignal.any([
                    signal,
                    AbortSignal.timeout(RUNTIME_LOGS.requestTimeoutMs),
                ]),
            })
        },
        refetchInterval: RUNTIME_LOGS.refetchIntervalMs,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        staleTime: 0,
        gcTime: 0,
        retry: false,
    })
    const entries = useMemo(
        function () {
            const formatter = new Intl.DateTimeFormat(language, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            })
            return (logsQuery.data?.entries ?? []).map((entry) => ({
                id: entry.id,
                timestamp: entry.timestamp,
                level: entry.level,
                time: formatter.format(new Date(entry.timestamp)),
                message:
                    entry.message ??
                    (entry.event.startsWith('health.')
                        ? t(
                              `admin.dashboard.details.${entry.event
                                  .slice(7)
                                  .replace(
                                      /_([a-z])/g,
                                      (_match, letter: string) =>
                                          letter.toUpperCase(),
                                  )}`,
                          )
                        : entry.event),
                contextText: Object.keys(entry.context).length
                    ? JSON.stringify(entry.context)
                    : '',
            }))
        },
        [logsQuery.data?.entries, language, t],
    )
    const lastEntryId = entries.at(-1)?.id
    const unreadCount = isFollowing
        ? 0
        : entries.length -
          entries.findIndex((entry) => entry.id === lastReadEntryId) -
          1
    const isUnavailable =
        logsQuery.isError || logsQuery.fetchStatus === 'paused'

    useEffect(function () {
        consoleRef.current?.focus({ preventScroll: true })
    }, [])

    useEffect(
        function () {
            if (!lastEntryId) return
            const output = outputRef.current
            if (isFollowing && output) output.scrollTop = output.scrollHeight
        },
        [isFollowing, lastEntryId],
    )

    function handleJumpToLatest() {
        const output = outputRef.current
        if (output) {
            output.scrollTop = output.scrollHeight
            output.focus({ preventScroll: true })
        }
        setIsFollowing(true)
        setLastReadEntryId(null)
    }

    function handleScroll(event: UIEvent<HTMLDivElement>) {
        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
        const isAtBottom = scrollHeight - scrollTop - clientHeight <= 1
        if (isAtBottom) {
            setIsFollowing(true)
            setLastReadEntryId(null)
        } else if (isFollowing) {
            setLastReadEntryId(lastEntryId ?? null)
            setIsFollowing(false)
        }
    }

    let connectionKey = 'live'
    if (isUnavailable) connectionKey = 'disconnected'
    else if (logsQuery.isPending) connectionKey = 'connecting'

    let sourceKey = 'applicationSource'
    if (!logsQuery.data) sourceKey = 'pendingSource'
    else if (logsQuery.data.source === 'container')
        sourceKey = 'containerSource'
    else if (service === 'postgresql' || service === 'valkey')
        sourceKey = 'connectionSource'

    return {
        state: {
            entries,
            isFollowing,
            unreadCount,
            isLoading: logsQuery.isPending && !isUnavailable,
            isUnavailable,
            isHistoryIncomplete:
                logsQuery.data?.sharedHistoryAvailable === false,
            connectionLabel: t(`admin.dashboard.console.${connectionKey}`),
            sourceLabel: t(`admin.dashboard.console.${sourceKey}`),
        },
        handler: {
            handleJumpToLatest,
            handleScroll,
        },
        refs: {
            consoleRef,
            outputRef,
        },
    }
}
