import { useState } from 'react'
import {
    APP_LIFECYCLE_CONNECTIONS,
    APP_LIFECYCLE_STEPS,
} from '../app-lifecycle.config.ts'
import type {
    AppLifecycleId,
    AppLifecycleLogicReturn,
} from '../Types/app-lifecycle.types.ts'

export default function useAppLifecycleLogic(): AppLifecycleLogicReturn {
    const [activeId, setActiveId] = useState<AppLifecycleId>('template')
    const activeStep =
        APP_LIFECYCLE_STEPS.find((step) => step.id === activeId) ??
        APP_LIFECYCLE_STEPS[0]

    return {
        state: {
            steps: APP_LIFECYCLE_STEPS,
            connections: APP_LIFECYCLE_CONNECTIONS,
            activeStep,
            total: APP_LIFECYCLE_STEPS.length,
        },
        handler: { handleSelectStep: setActiveId },
    }
}
