import type { Worker } from 'bullmq'
import type { LOG_ALLOWED_VALUES } from '@/config/logging.config.ts'

export type RuntimeQueueName = (typeof LOG_ALLOWED_VALUES.queueName)[number]

export type ClosableQueueWorker = Pick<Worker, 'close' | 'disconnect'>
