import type { vi } from 'bun:test'
export type BackupProcessor = (job: {
    data: Record<string, unknown>
    name: string
    updateData: ReturnType<typeof vi.fn>
    updateProgress: ReturnType<typeof vi.fn>
}) => Promise<unknown>
