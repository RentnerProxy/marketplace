import { z } from 'zod'

export const dashboardLogsInputSchema = z
    .object({
        service: z.enum([
            'webserver',
            'websocket',
            'worker',
            'postgresql',
            'valkey',
            'core',
        ]),
    })
    .strict()
