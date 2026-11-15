import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import TransferOverlay from '@/shared/TransferOverlay/index.tsx'
import type { TransferOverlayLogicReturn } from '@/shared/TransferOverlay/Types/types.ts'
import {
    elements,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

const logic: TransferOverlayLogicReturn = {
    state: { tasks: [] },
    handler: { handleDismissTask: mock() },
}
mock.module(
    '@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts',
    () => ({ default: () => logic }),
)
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))

describe('Transfer overlay composition', () => {
    it('hides an empty queue and wires each visible task to dismissal by ID', () => {
        expect(TransferOverlay()).toBeNull()
        logic.state.tasks = [
            {
                id: 'upload-1',
                direction: 'upload',
                kind: 'transfer',
                title: 'report.pdf',
                totalBytes: 100,
                transferredBytes: 50,
                speedBytesPerSecond: 10,
                progress: 50,
                status: 'running',
            },
        ]
        const tree = TransferOverlay()
        expect(renderToStaticMarkup(tree)).toContain('report.pdf')
        const item = elements(tree).find(
            (element) => element.props.task !== undefined,
        )
        expect(item?.props.task).toBe(logic.state.tasks[0])
        if (!item) throw new Error('Missing task view')
        invoke(item, 'onDismiss', 'upload-1')
        expect(logic.handler.handleDismissTask).toHaveBeenCalledWith('upload-1')
    })
})
