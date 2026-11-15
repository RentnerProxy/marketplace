import type { Job } from 'bullmq'

export type MailJob = Pick<Job<unknown>, 'data' | 'name'>
