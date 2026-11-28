import { defineServerEntry } from 'nitro'
import { PRODUCTION_HTTP_LIMITS } from '@/config/production-server.config.ts'

export default defineServerEntry({
    maxRequestBodySize: PRODUCTION_HTTP_LIMITS.maxRequestBodySize,
    bun: { idleTimeout: PRODUCTION_HTTP_LIMITS.idleTimeout },
})
