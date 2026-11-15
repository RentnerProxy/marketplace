import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import RestoreProgressCard from '@/features/RestoreProgress/Components/RestoreProgressCard.tsx'
import type { RestoreStatus } from '@/lib/Restore/Types/restore.types.ts'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))

const running: RestoreStatus = {
    version: 1,
    status: 'running',
    phase: 'restoring-database',
    percent: 42.4,
    processedBytes: 1024,
    totalBytes: 2048,
    startedAt: null,
    updatedAt: null,
}
const render = (
    restoreStatus: RestoreStatus | null,
    isLoading = false,
    isError = false,
) =>
    renderToStaticMarkup(
        RestoreProgressCard({ restoreStatus, isLoading, isError }),
    )

describe('RestoreProgressCard', () => {
    it('announces loading without inventing a percentage and preserves polling errors', () => {
        const html = render(null, true, true)
        expect(html).toContain('role="progressbar"')
        expect(html).not.toContain('aria-valuenow')
        expect(html).toContain('animate-pulse')
        expect(html).toContain('restoreProgress.loading')
        expect(html).toContain('restoreProgress.statusUnavailable')
    })

    it('renders rounded accessible progress, precise bar width, phase and transferred bytes', () => {
        const html = render(running)
        expect(html).toContain('aria-valuenow="42"')
        expect(html).toContain('width:42.4%')
        expect(html).toContain('restoreProgress.phase.restoringDatabase')
        expect(html).toContain('restoreProgress.bytes')
        expect(html).toContain('1.0 KB')
        expect(html).toContain('2.0 KB')
    })

    it.each(['completed', 'failed', 'recovery-required'] as const)(
        'shows the %s outcome and its specific notice',
        (status) => {
            const html = render({ ...running, status, percent: 100 })
            const key =
                status === 'recovery-required' ? 'recoveryRequired' : status
            expect(html).toContain(`restoreProgress.status.${key}`)
            expect(html).toContain(`restoreProgress.${key}Notice`)
            expect(html).toContain(
                status === 'completed' ? 'bg-emerald-400' : 'bg-red-400',
            )
            if (status === 'recovery-required')
                expect(html).toContain('restoreProgress.recoveryRequiredTitle')
        },
    )

    it('uses the rollback phase and keeps unknown running progress indeterminate', () => {
        const html = render({
            ...running,
            phase: 'rolling-back',
            percent: null,
        })
        expect(html).toContain('restoreProgress.phase.rollingBack')
        expect(html).toContain('animate-spin')
        expect(html).not.toContain('aria-valuenow')
    })

    it('renders idle without animation or a byte count', () => {
        const html = render({
            ...running,
            status: 'idle',
            phase: null,
            percent: null,
            totalBytes: 0,
        })
        expect(html).toContain('restoreProgress.status.idle')
        expect(html).toContain('restoreProgress.idleNotice')
        expect(html).not.toContain('animate-pulse')
        expect(html).not.toContain('restoreProgress.bytes')
    })

    it.each([-10, 110])('clamps an out-of-range percentage %s', (percent) => {
        expect(render({ ...running, percent })).toContain(
            `aria-valuenow="${percent < 0 ? 0 : 100}"`,
        )
    })
})
