import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import TransferOverlayItem from '@/shared/TransferOverlay/Components/TransferOverlayItem.tsx'
import type { TransferTask } from '@/shared/TransferOverlay/Types/types.ts'
import {
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))

const base: TransferTask = {
    id: 'transfer-1',
    kind: 'transfer',
    direction: 'upload',
    title: 'archive.zip',
    totalBytes: 2048,
    transferredBytes: 1024,
    speedBytesPerSecond: 512,
    progress: 50,
    status: 'running',
}

describe('TransferOverlayItem', () => {
    it.each(['upload', 'download'] as const)(
        'renders %s running, success and error states with exact progress',
        (direction) => {
            for (const [status, suffix] of [
                ['running', 'Running'],
                ['success', 'Done'],
                ['error', 'Failed'],
            ] as const) {
                const html = renderToStaticMarkup(
                    TransferOverlayItem({
                        task: {
                            ...base,
                            direction,
                            status,
                            message: 'Transfer details',
                        },
                        onDismiss: mock(),
                    }),
                )
                expect(html).toContain(`shared.transfer.${direction}${suffix}`)
                expect(html).toContain('aria-valuenow="50"')
                expect(html).toContain('width:50%')
                expect(html).toContain('Transfer details')
                expect(html.includes('512 B/s')).toBe(status === 'running')
            }
        },
    )

    it.each(['running', 'success', 'error'] as const)(
        'keeps backup %s dismissal and labels consistent',
        (status) => {
            const dismiss = mock()
            const tree = TransferOverlayItem({
                task: { ...base, kind: 'backup', status },
                onDismiss: dismiss,
            })
            const html = renderToStaticMarkup(tree)
            expect(html).toContain(
                `shared.transfer.backup${status === 'running' ? 'Running' : status === 'success' ? 'Done' : 'Failed'}`,
            )
            expect(html.includes('shared.transfer.dismiss')).toBe(
                status !== 'running',
            )
            if (status !== 'running') {
                invoke(
                    findElement(tree, (element) => element.type === 'button'),
                    'onClick',
                )
                expect(dismiss).toHaveBeenCalledWith('transfer-1')
            }
        },
    )

    it.each([-20, 150])(
        'clamps progress %s to the accessible range',
        (progress) => {
            const html = renderToStaticMarkup(
                TransferOverlayItem({
                    task: { ...base, progress },
                    onDismiss: mock(),
                }),
            )
            const expected = progress < 0 ? 0 : 100
            expect(html).toContain(`aria-valuenow="${expected}"`)
            expect(html).toContain(`width:${expected}%`)
        },
    )

    it('omits an exact value during preparation and shows the provided message or fallback', () => {
        for (const message of [undefined, 'Preparing encrypted archive']) {
            const html = renderToStaticMarkup(
                TransferOverlayItem({
                    task: { ...base, indeterminate: true, message },
                    onDismiss: mock(),
                }),
            )
            expect(html).not.toContain('aria-valuenow')
            expect(html).toContain('animate-pulse')
            expect(html).toContain(message ?? 'shared.transfer.preparing')
        }
    })
})
