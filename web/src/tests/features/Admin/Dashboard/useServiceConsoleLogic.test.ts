import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import type { UseQueryOptions } from '@tanstack/react-query'
import type { UIEvent } from 'react'
import { RUNTIME_LOGS } from '@/config/logging.config.ts'
import type {
    RuntimeLogEntry,
    RuntimeLogSnapshot,
} from '@/lib/RuntimeLogs/Types/runtime-log.types.ts'
import {
    query,
    render,
    reset,
} from '../UserManagement/user-management-hooks.test.helpers.ts'

function entry(id: string): RuntimeLogEntry {
    return {
        id,
        timestamp: '2026-11-10T08:00:00.000Z',
        level: 'info',
        event: 'app.started',
        context: {},
    }
}

const first = entry('first')
const second = entry('second')
const third = entry('third')
const fourth = entry('fourth')
const result = {
    data: {
        source: 'application' as 'application' | 'container',
        entries: [first, second],
        sharedHistoryAvailable: true,
    },
    isError: false,
    isPending: false,
    fetchStatus: 'idle',
}
const getLogs = vi.fn(async (_options: unknown) => result.data)
vi.mock('@/features/Admin/Dashboard/middleware.ts', () => ({
    getDashboardLogsHandler: getLogs,
}))
const { default: useServiceConsoleLogic } =
    await import('@/features/Admin/Dashboard/Components/ServiceConsole/Hooks/useServiceConsoleLogic.ts')

function renderConsole() {
    return render(() => useServiceConsoleLogic({ service: 'worker' }))
}

function scroll(scrollTop: number) {
    renderConsole().handler.handleScroll({
        currentTarget: { scrollTop, scrollHeight: 1000, clientHeight: 300 },
    } as UIEvent<HTMLDivElement>)
}

beforeEach(function () {
    reset()
    result.data = {
        source: 'application',
        entries: [first, second],
        sharedHistoryAvailable: true,
    }
    result.isError = false
    result.isPending = false
    result.fetchStatus = 'idle'
    query.mockImplementation(() => result)
})

describe('Automatisches Mitlesen der Dienstkonsole', function () {
    it('lädt nur den gewählten Dienst, aktualisiert im Vordergrund und reicht Abbrüche weiter', async function () {
        const logic = renderConsole()
        expect(logic.state.isFollowing).toBe(true)
        expect(logic.state.unreadCount).toBe(0)
        const options = query.mock
            .calls[0]?.[0] as UseQueryOptions<RuntimeLogSnapshot>
        expect(options).toMatchObject({
            queryKey: ['admin-dashboard-logs', 'worker'],
            refetchInterval: RUNTIME_LOGS.refetchIntervalMs,
            refetchIntervalInBackground: false,
            refetchOnWindowFocus: true,
            retry: false,
            gcTime: 0,
        })
        if (typeof options.queryFn !== 'function')
            throw new Error('Query fehlt')
        const controller = new AbortController()
        await options.queryFn({
            queryKey: options.queryKey ?? [],
            signal: controller.signal,
            client: new QueryClient(),
            meta: undefined,
        })
        const request = getLogs.mock.calls[0]?.[0] as {
            data: { service: string }
            signal: AbortSignal
        }
        expect(request.data).toEqual({ service: 'worker' })
        controller.abort()
        expect(request.signal.aborted).toBe(true)
    })

    it('unterbricht das Mitscrollen beim Hochscrollen und zählt ausschließlich neue Einträge', function () {
        scroll(300)
        expect(renderConsole().state.isFollowing).toBe(false)
        expect(renderConsole().state.unreadCount).toBe(0)
        result.data = {
            ...result.data,
            entries: [first, second, third, fourth],
        }
        expect(renderConsole().state.unreadCount).toBe(2)
        expect(renderConsole().state.unreadCount).toBe(2)
        expect(query.mock.calls.at(-1)?.[0]).toMatchObject({
            refetchInterval: RUNTIME_LOGS.refetchIntervalMs,
        })
    })

    it('aktiviert das Mitscrollen erst ganz unten und markiert dann alles als gelesen', function () {
        scroll(300)
        result.data = { ...result.data, entries: [first, second, third] }
        expect(renderConsole().state.unreadCount).toBe(1)
        scroll(698)
        expect(renderConsole().state.isFollowing).toBe(false)
        scroll(700)
        expect(renderConsole().state.isFollowing).toBe(true)
        expect(renderConsole().state.unreadCount).toBe(0)
    })

    it('springt per Pfeil sofort ans Ende, fokussiert die Ausgabe und folgt weiteren Logs', function () {
        const output = {
            scrollTop: 300,
            scrollHeight: 1000,
            focus: vi.fn(),
        }
        renderConsole().refs.outputRef.current =
            output as unknown as HTMLDivElement
        scroll(300)
        result.data = { ...result.data, entries: [first, second, third] }
        expect(renderConsole().state.unreadCount).toBe(1)
        expect(output.scrollTop).toBe(300)
        renderConsole().handler.handleJumpToLatest()
        expect(output.scrollTop).toBe(1000)
        expect(output.focus).toHaveBeenCalledWith({ preventScroll: true })
        expect(renderConsole().state.isFollowing).toBe(true)
        expect(renderConsole().state.unreadCount).toBe(0)
        output.scrollHeight = 1200
        result.data = {
            ...result.data,
            entries: [first, second, third, fourth],
        }
        renderConsole()
        expect(output.scrollTop).toBe(1200)
    })

    it('zählt den noch verfügbaren Verlauf, wenn der letzte gelesene Eintrag bereits herausgefallen ist', function () {
        scroll(300)
        result.data = { ...result.data, entries: [third, fourth] }
        expect(renderConsole().state.unreadCount).toBe(2)
    })

    it('behält vorhandene Logs bei Verbindungsfehlern lesbar und kennzeichnet unvollständigen Verlauf', function () {
        result.isError = true
        result.data.sharedHistoryAvailable = false
        const logic = renderConsole()
        expect(logic.state.entries).toHaveLength(2)
        expect(logic.state.isUnavailable).toBe(true)
        expect(logic.state.isHistoryIncomplete).toBe(true)
        expect(logic.state.connectionLabel).toBe(
            'admin.dashboard.console.disconnected',
        )
    })
})
