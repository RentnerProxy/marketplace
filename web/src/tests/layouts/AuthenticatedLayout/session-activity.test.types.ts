import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import type { SessionActivityControllerOptions } from '@/lib/Auth/Session/Types/session-activity.types.ts'

export type ScheduledActivityTestTask = {
    callback: () => void
    due: number
}

export type ActivityTestRegistration = {
    type: string
    options: boolean | AddEventListenerOptions | undefined
}

export type SessionActivityHarnessOptions = Partial<
    Pick<SessionActivityControllerOptions, 'touchSession' | 'readSession'>
> & {
    session?: AuthenticatedSessionQueryData
}

export type ActivityTestServerCallOptions = {
    signal: AbortSignal
}
