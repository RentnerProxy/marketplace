import { realtimeEventSchema } from '@/websockets/Types/events.ts'

export function parseRealtimeEvent(message: string) {
    try {
        const parsed: unknown = JSON.parse(message)
        const result = realtimeEventSchema.safeParse(parsed)

        return result.success ? result.data : null
    } catch {
        return null
    }
}
