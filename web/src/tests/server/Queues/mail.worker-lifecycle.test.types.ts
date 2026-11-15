import type { Mock } from 'bun:test'
import type { MailJob } from '@/server/Queues/Types/mail-worker.types.ts'

export type MailWorkerTestProcessor = (job: MailJob) => Promise<void>

export type MailWorkerTestInstance = {
    close: Mock<() => Promise<void>>
    isRunning: Mock<() => boolean>
    name: string
    processor: MailWorkerTestProcessor
    options: unknown
    listeners: Map<string, (...args: unknown[]) => void>
}
