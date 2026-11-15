import process from 'node:process'
import { waitForValkeyPasswordFileService } from '@/server/Runtime/valkey-password-file.service.ts'

process.env.NODE_ENV = 'production'
await waitForValkeyPasswordFileService()
await import('@/server/backgroundWorker.ts')
