import type { MaintenanceCountdownLogicReturn } from '../Types/authenticated-layout-logic.types.ts'
import { useState } from 'react'
import { formatRemainingTime } from '@/lib/Date/date.ts'

const CIRCLE_RADIUS = 18
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS

export default function useMaintenanceCountdownLogic(
    millisecondsUntilMaintenance: number,
): MaintenanceCountdownLogicReturn {
    const currentDuration = Math.max(millisecondsUntilMaintenance, 1)
    const [totalDuration, setTotalDuration] = useState(() => currentDuration)

    if (currentDuration > totalDuration) {
        setTotalDuration(currentDuration)
    }

    const progress = Math.min(
        1,
        Math.max(0, millisecondsUntilMaintenance / totalDuration),
    )

    return {
        state: {
            circleCircumference: CIRCLE_CIRCUMFERENCE,
            circleDashOffset: CIRCLE_CIRCUMFERENCE * (1 - progress),
            formattedTime: formatRemainingTime(millisecondsUntilMaintenance),
        },
    }
}
