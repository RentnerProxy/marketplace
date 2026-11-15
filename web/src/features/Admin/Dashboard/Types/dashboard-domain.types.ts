import type { RuntimeLogServiceId } from '@/lib/RuntimeLogs/Types/runtime-log.types.ts'
import type { CoreRuntimeHealth } from '@/server/Core/Types/core.types.ts'

export type DashboardServiceId = RuntimeLogServiceId

export type DashboardServiceGroup = {
    id: 'application' | 'processing' | 'infrastructure'
    services: readonly DashboardServiceId[]
}

export type DashboardServiceHealth =
    | {
          status: 'running'
          detail: 'coreResponding'
          runtime: CoreRuntimeHealth
      }
    | {
          status: 'running'
          detail:
              | 'responding'
              | 'heartbeatCurrent'
              | 'connectionAvailable'
              | 'websocketResponding'
      }
    | { status: 'starting'; detail: 'workerStarting' }
    | { status: 'connecting'; detail: 'connectionPending' }
    | {
          status: 'down'
          detail:
              | 'heartbeatMissing'
              | 'heartbeatExpired'
              | 'connectionClosed'
              | 'websocketUnavailable'
      }
    | {
          status: 'error'
          detail:
              | 'checkFailed'
              | 'timeout'
              | 'workerUnhealthy'
              | 'heartbeatInvalid'
              | 'rateLimitUnavailable'
      }
    | { status: 'checking'; detail: 'checking' }
    | {
          status: 'unknown'
          detail: 'statusUnavailable' | 'workerStatusUnavailable'
      }

export type DashboardHealthSnapshot = {
    services: Record<DashboardServiceId, DashboardServiceHealth>
}
